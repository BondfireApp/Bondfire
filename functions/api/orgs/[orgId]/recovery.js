import { json, bad, readJSON, requireMethod } from "../../_lib/http.js";
import { getDb, requireUser, requireOrgRole } from "../../_lib/auth.js";
import { ensureZkSchema } from "../../_lib/zk.js";

async function tryRun(db, sql) {
  try {
    await db.prepare(sql).run();
  } catch (e) {
    const msg = String(e?.message || "");
    if (msg.includes("duplicate") || msg.includes("already exists") || msg.includes("SQLITE_ERROR")) return;
    throw e;
  }
}

async function ensureRecoverySchema(db) {
  // Base tables
  await tryRun(db, "CREATE TABLE IF NOT EXISTS org_keys (org_id TEXT PRIMARY KEY, encrypted_org_metadata TEXT)");
  await ensureZkSchema(db);
  // Defensive in case older env skipped ensureZkSchema additions
  await tryRun(
    db,
    "CREATE TABLE IF NOT EXISTS org_key_recovery (" +
      "org_id TEXT NOT NULL," +
      "user_id TEXT NOT NULL," +
      "wrapped_key TEXT NOT NULL," +
      "salt TEXT NOT NULL," +
      "kdf TEXT NOT NULL," +
      "updated_at INTEGER NOT NULL," +
      "PRIMARY KEY (org_id, user_id)" +
    ")"
  );
  await tryRun(db, "CREATE INDEX IF NOT EXISTS idx_org_key_recovery_org ON org_key_recovery(org_id)");
}

export async function onRequestGet({ env, request, params }) {
  const u = await requireUser({ env, request });
  if (!u.ok) return u.resp;

  const orgId = String(params?.orgId || "");
  if (!orgId) return bad(400, "MISSING_ORG_ID");

  const db = getDb(env);
  if (!db) return bad(500, "NO_DB_BINDING");
  await ensureRecoverySchema(db);

  // Any org member can read their own recovery blob
  const role = await requireOrgRole({ env, request, orgId, minRole: "member", bypassWriteLockdown: true });
  if (!role.ok) return role.resp;

  const userId = String(u.user?.sub || "");
  const row = await db
    .prepare("SELECT wrapped_key, salt, kdf, updated_at FROM org_key_recovery WHERE org_id = ? AND user_id = ?")
    .bind(orgId, userId)
    .first();

  return json({
    ok: true,
    has_recovery: !!row,
    wrapped_key: row?.wrapped_key || null,
    salt: row?.salt || null,
    kdf: row?.kdf || null,
    updated_at: row?.updated_at || null,
  });
}

export async function onRequestPost({ env, request, params }) {
  const m = requireMethod(request, "POST");
  if (m) return m;

  const u = await requireUser({ env, request });
  if (!u.ok) return u.resp;

  const orgId = String(params?.orgId || "");
  if (!orgId) return bad(400, "MISSING_ORG_ID");

  const db = getDb(env);
  if (!db) return bad(500, "NO_DB_BINDING");
  await ensureRecoverySchema(db);

  // Any org member can write their own recovery blob
  const role = await requireOrgRole({ env, request, orgId, minRole: "member", bypassWriteLockdown: true });
  if (!role.ok) return role.resp;

  const body = await readJSON(request);
  const wrappedKey = body?.wrapped_key ? String(body.wrapped_key) : "";
  const salt = body?.salt ? String(body.salt) : "";
  const kdf = body?.kdf ? String(body.kdf) : "";

  if (!wrappedKey || !salt || !kdf) return bad(400, "MISSING_FIELDS");

  const userId = String(u.user?.sub || "");
  const now = Date.now();

  await db
    .prepare(
      "INSERT INTO org_key_recovery (org_id, user_id, wrapped_key, salt, kdf, updated_at) VALUES (?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(org_id, user_id) DO UPDATE SET " +
        "wrapped_key = excluded.wrapped_key, salt = excluded.salt, kdf = excluded.kdf, updated_at = excluded.updated_at"
    )
    .bind(orgId, userId, wrappedKey, salt, kdf, now)
    .run();

  return json({ ok: true, updated_at: now });
}

export async function onRequestDelete({ env, request, params }) {
  const m = requireMethod(request, "DELETE");
  if (m) return m;

  const u = await requireUser({ env, request });
  if (!u.ok) return u.resp;

  const orgId = String(params?.orgId || "");
  if (!orgId) return bad(400, "MISSING_ORG_ID");

  const db = getDb(env);
  if (!db) return bad(500, "NO_DB_BINDING");
  await ensureRecoverySchema(db);

  const role = await requireOrgRole({ env, request, orgId, minRole: "member", bypassWriteLockdown: true });
  if (!role.ok) return role.resp;

  const userId = String(u.user?.sub || "");
  await db.prepare("DELETE FROM org_key_recovery WHERE org_id = ? AND user_id = ?").bind(orgId, userId).run();

  return json({ ok: true });
}
