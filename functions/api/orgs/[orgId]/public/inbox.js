import { getDB } from "../../../_bf.js";
import { enforceOrgWriteLockdown } from "../../../_lib/orgLockdown.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
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
      // ignore if already added or unsupported duplicate
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

function mapInboxItem(row) {
  const sourceKind = String(row?.source_kind || "").trim().toLowerCase();
  const type = String(row?.type || "intake").trim().toLowerCase();

  let title = "Public intake";
  if (sourceKind === "get_help") title = "Get Help";
  else if (sourceKind === "volunteer") title = "Volunteer";
  else if (sourceKind === "offer_resources") title = "Offer Resources";
  else if (sourceKind === "inventory_request") title = "Inventory Request";
  else if (type === "rsvp") title = "Meeting RSVP";

  let details = String(row?.details || "").trim();
  let extra = String(row?.extra || "").trim();

  if (sourceKind === "inventory_request" && extra) {
    try {
      const parsed = JSON.parse(extra);
      if (parsed?.note) extra = String(parsed.note || "").trim();
      if (Array.isArray(parsed?.items) && parsed.items.length) {
        details = parsed.items
          .map(
            (item) =>
              `${String(item?.name || "item").trim()} x ${Math.max(
                1,
                Math.floor(Number(item?.qty_requested || 1) || 1)
              )}${item?.unit ? ` ${String(item.unit).trim()}` : ""}`
          )
          .join("\n");
      }
    } catch {
      // keep raw values
    }
  }

  return { ...row, title, details, extra };
}

export async function onRequestGet(context) {
  const { env, params } = context;
  try {
    const orgId = String(params?.orgId || "").trim();
    if (!orgId) return json({ ok: false, error: "BAD_ORG" }, 400);

    const db = getDB(env);
    if (!db) return json({ ok: false, error: "DB_NOT_CONFIGURED" }, 500);

    await ensureTable(db);

    const rows = await db
      .prepare(`
        SELECT id, org_id, type, source_kind, name, contact, details, extra, review_status, admin_note, created_at, updated_at
        FROM public_inbox
        WHERE org_id = ?
        ORDER BY COALESCE(updated_at, created_at) DESC, created_at DESC
      `)
      .bind(orgId)
      .all();

    return json({
      ok: true,
      items: (Array.isArray(rows?.results) ? rows.results : []).map(mapInboxItem),
    });
  } catch (err) {
    return json(
      { ok: false, error: "INTERNAL", detail: String(err?.message || err || "") },
      500
    );
  }
}

export async function onRequestPut(context) {
  const { env, params, request } = context;
  try {
    const orgId = String(params?.orgId || "").trim();
    if (!orgId) return json({ ok: false, error: "BAD_ORG" }, 400);
    const lockdown = await enforceOrgWriteLockdown({ env, orgId });
    if (!lockdown.ok) return lockdown.resp;

    const body = await request.json().catch(() => ({}));
    const id = body?.id != null ? String(body.id) : "";
    if (!id) return json({ ok: false, error: "BAD_ID" }, 400);

    const status = String(body?.review_status || "new").trim().toLowerCase();
    const adminNote = String(body?.admin_note || "");

    const db = getDB(env);
    if (!db) return json({ ok: false, error: "DB_NOT_CONFIGURED" }, 500);

    await ensureTable(db);

    await db
      .prepare(`
        UPDATE public_inbox
        SET review_status = ?, admin_note = ?, updated_at = unixepoch('now') * 1000
        WHERE org_id = ? AND id = ?
      `)
      .bind(status, adminNote, orgId, id)
      .run();

    const rows = await db
      .prepare(`
        SELECT id, org_id, type, source_kind, name, contact, details, extra, review_status, admin_note, created_at, updated_at
        FROM public_inbox
        WHERE org_id = ?
        ORDER BY COALESCE(updated_at, created_at) DESC, created_at DESC
      `)
      .bind(orgId)
      .all();

    return json({
      ok: true,
      items: (Array.isArray(rows?.results) ? rows.results : []).map(mapInboxItem),
    });
  } catch (err) {
    return json(
      { ok: false, error: "INTERNAL", detail: String(err?.message || err || "") },
      500
    );
  }
}
