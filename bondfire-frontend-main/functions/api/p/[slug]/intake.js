import { bad, ok, readJSON, now } from "../../_lib/http.js";
import { getDB } from "../../_bf.js";

async function getOrgIdBySlug(env, slug) {
  const s = String(slug || "").trim();
  if (!s) return null;
  const orgId = await env.BF_PUBLIC.get(`slug:${s}`);
  return orgId || null;
}

function clean(v, max = 2000) {
  return String(v || "").trim().slice(0, max);
}

function normKind(v) {
  const s = String(v || "").trim().toLowerCase();
  if (["get_help", "volunteer", "offer_resources", "inventory_request"].includes(s)) return s;
  return "";
}

async function ensureTable(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS public_inbox (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'intake',
      source_kind TEXT,
      name TEXT,
      contact TEXT,
      details TEXT,
      extra TEXT,
      review_status TEXT NOT NULL DEFAULT 'new',
      admin_note TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `).run();

  await db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_public_inbox_org_created
    ON public_inbox(org_id, created_at DESC)
  `).run();

  const info = await db.prepare(`PRAGMA table_info(public_inbox)`).all();
  const cols = new Set((info?.results || []).map((r) => String(r.name || "").toLowerCase()));

  const addCol = async (sql) => {
    try {
      await db.prepare(sql).run();
    } catch {
      // ignore duplicate/unsupported alter noise
    }
  };

  if (!cols.has("type")) {
    await addCol(`ALTER TABLE public_inbox ADD COLUMN type TEXT NOT NULL DEFAULT 'intake'`);
  }
  if (!cols.has("source_kind")) {
    await addCol(`ALTER TABLE public_inbox ADD COLUMN source_kind TEXT`);
  }
  if (!cols.has("review_status")) {
    await addCol(`ALTER TABLE public_inbox ADD COLUMN review_status TEXT NOT NULL DEFAULT 'new'`);
  }
  if (!cols.has("admin_note")) {
    await addCol(`ALTER TABLE public_inbox ADD COLUMN admin_note TEXT`);
  }
  if (!cols.has("updated_at")) {
    await addCol(`ALTER TABLE public_inbox ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0`);
  }
}

export async function onRequestPost({ env, params, request }) {
  const slug = String(params?.slug || "").trim();
  if (!slug) return bad(400, "MISSING_SLUG");

  const orgId = await getOrgIdBySlug(env, slug);
  if (!orgId) return bad(404, "NOT_FOUND");

  const db = getDB(env);
  if (!db) return bad(500, "DB_NOT_CONFIGURED");
  await ensureTable(db);

  const body = await readJSON(request);
  const kind = normKind(body?.kind);
  if (!kind) return bad(400, "BAD_KIND");

  const id = crypto.randomUUID();
  const created = now();

  await db.prepare(`
    INSERT INTO public_inbox (
      id, org_id, type, source_kind, name, contact, details, extra, review_status, admin_note, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    id,
    orgId,
    "intake",
    kind,
    clean(body?.name, 160),
    clean(body?.contact, 220),
    clean(body?.details, 4000),
    clean(body?.extra, 4000),
    "new",
    "",
    created,
    created
  ).run();

  return ok({ id, kind, saved: true });
}