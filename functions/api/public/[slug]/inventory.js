import { getDB } from "../../_bf.js";

async function getOrgIdBySlug(env, slug) {
  const s = String(slug || "").trim();
  if (!s) return null;
  const orgId = await env.BF_PUBLIC.get(`slug:${s}`);
  return orgId || null;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function ensureInventoryTable(db) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS inventory (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        name TEXT NOT NULL,
        qty REAL NOT NULL DEFAULT 0,
        unit TEXT,
        category TEXT,
        location TEXT,
        notes TEXT,
        is_public INTEGER NOT NULL DEFAULT 0,
        encrypted_blob TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`
    )
    .run();

  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_inventory_org_updated
       ON inventory(org_id, updated_at DESC)`
    )
    .run();
}

export async function onRequestGet({ env, params }) {
  try {
    const slug = String(params?.slug || "").trim();
    if (!slug) return json({ ok: false, error: "MISSING_SLUG" }, 400);

    const db = getDB(env);
    if (!db) return json({ ok: false, error: "DB_NOT_CONFIGURED" }, 500);

    await ensureInventoryTable(db);

    const orgId = await getOrgIdBySlug(env, slug);
    if (!orgId) return json({ ok: false, error: "NOT_FOUND" }, 404);

    const cfgRaw = await env.BF_PUBLIC.get(`org:${orgId}`);
    const cfg = cfgRaw ? JSON.parse(cfgRaw) : null;
    if (!cfg?.enabled) return json({ ok: false, error: "NOT_FOUND" }, 404);

    const r = await db
      .prepare(
        `SELECT id, name, qty, unit, category, location, notes
         FROM inventory
         WHERE org_id = ? AND is_public = 1 AND COALESCE(qty, 0) > 0
         ORDER BY LOWER(COALESCE(category, '')), LOWER(COALESCE(name, '')), updated_at DESC, created_at DESC`
      )
      .bind(orgId)
      .all();

    return json({
      ok: true,
      items: Array.isArray(r?.results) ? r.results : [],
    });
  } catch (err) {
    return json(
      { ok: false, error: "INTERNAL", detail: String(err?.message || err || "") },
      500
    );
  }
}
