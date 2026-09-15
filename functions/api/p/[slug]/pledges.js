import { ok, err } from "../../_lib/http.js";
import { getDB } from "../../_bf.js";


async function ensurePledgesTable(db) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS pledges (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        need_id TEXT NULL,
        title TEXT NOT NULL,
        description TEXT NULL,
        qty REAL NULL,
        unit TEXT NULL,
        contact TEXT NULL,
        is_public INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`
    )
    .run();

  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_pledges_org_created
       ON pledges(org_id, created_at DESC)`
    )
    .run();

  const adds = [
    "ALTER TABLE pledges ADD COLUMN pledger_name TEXT",
    "ALTER TABLE pledges ADD COLUMN pledger_email TEXT",
    "ALTER TABLE pledges ADD COLUMN type TEXT",
    "ALTER TABLE pledges ADD COLUMN amount REAL",
    "ALTER TABLE pledges ADD COLUMN note TEXT",
    "ALTER TABLE pledges ADD COLUMN status TEXT DEFAULT 'offered'",
  ];

  for (const sql of adds) {
    try {
      await db.prepare(sql).run();
    } catch (e) {
      const msg = String(e?.message || e);
      if (!msg.toLowerCase().includes("duplicate") && !msg.toLowerCase().includes("exists")) {
        throw e;
      }
    }
  }
}

function now() {
  return Date.now();
}

function uuid() {
  return crypto.randomUUID();
}

function toStr(v, max) {
  const s = String(v ?? "").trim();
  return max ? s.slice(0, max) : s;
}

function toNumOrNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function normalizeLegacyContact(name, email) {
  const n = toStr(name, 120);
  const e = toStr(email, 160);
  if (n && e) return `${n} ${e}`;
  return n || e || null;
}

async function getOrgIdBySlug(env, slug) {
  const s = String(slug || "").trim();
  if (!s) return null;
  const orgId = await env.BF_PUBLIC.get(`slug:${s}`);
  return orgId || null;
}

export async function onRequest(ctx) {
  const { env, request, params } = ctx;
  const slug = params.slug;

  const db = getDB(env);
  if (!db) return err(500, "DB_NOT_CONFIGURED");

  await ensurePledgesTable(db);

  const orgId = await getOrgIdBySlug(env, slug);
  if (!orgId) return err(404, "NOT_FOUND");

  try {
    if (request.method !== "POST") return err(405, "METHOD_NOT_ALLOWED");

    const body = await request.json().catch(() => ({}));

    const pledger_name = toStr(body.name ?? body.pledger_name, 120) || null;
    const pledger_email = toStr(body.email ?? body.pledger_email, 160) || null;

    const type = toStr(body.type ?? body.title, 140);
    const amount = toNumOrNull(body.amount);
    const unit = toStr(body.unit, 64) || null;
    const note = toStr(body.note, 4000) || null;

    if (!type) return err(400, "MISSING_TYPE");

    const t = now();
    const id = uuid();

    // Legacy mirrors
    const title = type;
    const description = note;
    const qty = amount;
    const contact = normalizeLegacyContact(pledger_name, pledger_email);

    const need_id = toStr(body.needId ?? body.need_id, 128) || null;

    await db.prepare(
      `INSERT INTO pledges(
         id, org_id, need_id,
         title, description, qty, unit, contact,
         is_public, created_at, updated_at,
         pledger_name, pledger_email, type, amount, note, status
       ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .bind(
      id,
      orgId,
      need_id,
      title,
      description,
      qty,
      unit,
      contact,
      1,
      t,
      t,
      pledger_name,
      pledger_email,
      type || null,
      amount,
      note,
      "offered"
    )
    .run();

    return ok({ id });
  } catch (e) {
    return err(500, "SERVER_ERROR", { message: String(e?.message || e) });
  }
}
