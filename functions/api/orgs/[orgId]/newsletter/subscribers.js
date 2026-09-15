import { ok, err } from "../../../_lib/http.js";
import { requireOrgRole } from "../../../_lib/auth.js";
import { getDB } from "../../../_bf.js";
import { ensureZkSchema } from "../../../_lib/zk.js";



// D1 table expected:
// - newsletter_subscribers(id TEXT PRIMARY KEY, org_id TEXT, email TEXT, name TEXT, created_at INTEGER)

function csvEscape(v) {
  const s = String(v ?? "");
  if (s.includes("\n") || s.includes("\r") || s.includes(",") || s.includes('"')) {
    return '"' + s.replaceAll('"', '""') + '"';
  }
  return s;
}

export async function onRequestGet(ctx) {
  const { params, env, request } = ctx;
  const orgId = String(params.orgId || "");
  if (!orgId) return err(400, "BAD_ORG_ID");

  const db = getDB(env);
  if (!db) return err(500, "DB_NOT_CONFIGURED");

  // Ensure ZK columns exist (safe/no-op if already applied).
  await ensureZkSchema(db);

  // Ensure table exists (older deployments may not have run migrations).
  await db
    .prepare(`CREATE TABLE IF NOT EXISTS newsletter_subscribers (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      email TEXT NOT NULL,
      name TEXT NULL,
      source TEXT NULL,
      created_at INTEGER NOT NULL
    )`)
    .run();

  await db
    .prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_newsletter_subscribers_org_email
      ON newsletter_subscribers(org_id, email)`)
    .run();

  // Subscriber list and exports are an admin function.
  const auth = await requireOrgRole({ env, request, orgId: orgId, minRole: "admin" });
  if (!auth.ok) return auth.resp;
  const url = new URL(request.url);
  const wantCsv = (url.searchParams.get("format") || "").toLowerCase() === "csv";
  // Admin-only endpoint: OK to return plaintext so the Settings UI can render.
  const allowPlaintext = true;

  const r = await db.prepare(
    `SELECT id, email, name, created_at, encrypted_blob, key_version
       FROM newsletter_subscribers
      WHERE org_id = ?
      ORDER BY created_at DESC
      LIMIT 5000`
  ).bind(orgId).all();

  const rows = Array.isArray(r?.results) ? r.results : [];

  if (!wantCsv) {
    // Admin-only endpoint: return plaintext + encrypted blob (for ZK clients).
    const safe = rows.map((s) => {
      const hasEnc = !!s.encrypted_blob;
      return {
        id: s.id,
        // If plaintext columns are blank but encrypted data exists, return a
        // placeholder so the client can decrypt and display.
        email: allowPlaintext ? (s.email || (hasEnc ? "__encrypted__" : "")) : (hasEnc ? "__encrypted__" : ""),
        name: allowPlaintext ? (s.name || (hasEnc ? "__encrypted__" : "")) : (hasEnc ? "__encrypted__" : ""),
        created_at: s.created_at ?? null,
        encrypted_blob: s.encrypted_blob || null,
        key_version: s.key_version ?? null,
        needs_encryption: !hasEnc,
      };
    });
    return ok({ subscribers: safe });
  }

  const header = ["email", "name", "joined"].join(",");
  const lines = rows.map((s) => {
    const joined = s.created_at ? new Date(Number(s.created_at)).toISOString() : "";
    return [csvEscape(s.email), csvEscape(s.name), csvEscape(joined)].join(",");
  });
  const csv = [header, ...lines].join("\n");

  return new Response(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="subscribers-${orgId}.csv"`,
    },
  });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

// ZK backfill endpoint: store ciphertext for existing subscriber rows.
// Only org admins can do this.
export async function onRequestPost(ctx) {
  const { params, env, request } = ctx;
  const orgId = String(params.orgId || "");
  if (!orgId) return err(400, "BAD_ORG_ID");

  const db = getDB(env);
  if (!db) return err(500, "DB_NOT_CONFIGURED");

  await ensureZkSchema(db);

  // Ensure table exists (older deployments may not have run migrations).
  await db
    .prepare(`CREATE TABLE IF NOT EXISTS newsletter_subscribers (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      email TEXT NOT NULL,
      name TEXT NULL,
      source TEXT NULL,
      created_at INTEGER NOT NULL
    )`)
    .run();

  await db
    .prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_newsletter_subscribers_org_email
      ON newsletter_subscribers(org_id, email)`)
    .run();

  const auth = await requireOrgRole({ env, request, orgId: orgId, minRole: "admin" });
  if (!auth.ok) return auth.resp;

  const body = await readJson(request);
  const updates = Array.isArray(body.updates) ? body.updates : body.id ? [body] : [];
  if (updates.length === 0) return err(400, "MISSING_UPDATES");

  let changed = 0;
  for (const u of updates) {
    const id = String(u?.id || "").trim();
    const enc = u?.encrypted_blob ? String(u.encrypted_blob) : "";
    const kv = u?.key_version != null ? Number(u.key_version) : null;
    if (!id || !enc) continue;

    await db
      .prepare(
        "UPDATE newsletter_subscribers SET encrypted_blob = ?, key_version = COALESCE(?, key_version) WHERE org_id = ? AND id = ?"
      )
      .bind(enc, kv, orgId, id)
      .run();
    changed++;
  }

  return ok({ updated: true, changed });
}

// Delete a subscriber row (admin only).
// Called by Settings UI to remove test subscribers.
export async function onRequestDelete(ctx) {
  const { params, env, request } = ctx;
  const orgId = String(params.orgId || "");
  if (!orgId) return err(400, "BAD_ORG_ID");

  const db = getDB(env);
  if (!db) return err(500, "DB_NOT_CONFIGURED");

  await ensureZkSchema(db);

  // Ensure table exists (older deployments may not have run migrations).
  await db
    .prepare(`CREATE TABLE IF NOT EXISTS newsletter_subscribers (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      email TEXT NOT NULL,
      name TEXT NULL,
      source TEXT NULL,
      created_at INTEGER NOT NULL
    )`)
    .run();

  await db
    .prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_newsletter_subscribers_org_email
      ON newsletter_subscribers(org_id, email)`)
    .run();

  const auth = await requireOrgRole({ env, request, orgId: orgId, minRole: "admin" });
  if (!auth.ok) return auth.resp;

  const body = await readJson(request);
  const id = String(body?.id || "").trim();
  if (!id) return err(400, "MISSING_ID");

  await db
    .prepare("DELETE FROM newsletter_subscribers WHERE org_id = ? AND id = ?")
    .bind(orgId, id)
    .run();

  return ok({ deleted: true });
}