import { ok, err } from "../../_lib/http.js";
import { requireOrgRole } from "../../_lib/auth.js";
import { getDB } from "../../_bf.js";

async function ensurePledgesTable(db) {
  // Legacy base table (kept)
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

  // Newer fields that Settings.jsx expects.
  // D1 doesn't support IF NOT EXISTS on ADD COLUMN, so ignore "duplicate column" errors.
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
      if (
        !msg.toLowerCase().includes("duplicate") &&
        !msg.toLowerCase().includes("exists")
      ) {
        throw e;
      }
    }
  }
}

async function bumpNeedToInProgress(db, orgId, needId) {
  if (!needId) return;

  // Only bump open -> in_progress, do not touch other statuses.
  await db
    .prepare(
      `UPDATE needs
       SET status='in_progress', updated_at=?
       WHERE id=? AND org_id=? AND (status IS NULL OR status='open')`
    )
    .bind(Date.now(), needId, orgId)
    .run();
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

function boolToInt(v) {
  return v ? 1 : 0;
}

function normalizeLegacyContact(name, email) {
  const n = toStr(name, 120);
  const e = toStr(email, 160);
  if (n && e) return `${n} ${e}`;
  return n || e || null;
}

async function listPledges(db, orgId) {
  const r = await db
    .prepare(
      `SELECT
         id, org_id, need_id,
         title, description, qty, unit, contact,
         is_public, created_at, updated_at,
         pledger_name, pledger_email, type, amount, note, status
       FROM pledges
       WHERE org_id=?
       ORDER BY created_at DESC`
    )
    .bind(orgId)
    .all();

  const rows = r.results || [];

  // Output in the shape Settings.jsx expects, with fallbacks to legacy columns.
  return rows.map((p) => {
    const pledger_name = p.pledger_name ?? null;
    const pledger_email = p.pledger_email ?? null;

    return {
      id: p.id,
      org_id: p.org_id,
      need_id: p.need_id ?? null,

      pledger_name: pledger_name || "",
      pledger_email: pledger_email || "",

      type: (p.type ?? p.title ?? "") || "",
      amount:
        p.amount != null
          ? p.amount
          : p.qty != null
          ? p.qty
          : "",
      unit: p.unit ?? "",
      note: (p.note ?? p.description ?? "") || "",
      status: (p.status ?? "offered") || "offered",

      is_public: !!p.is_public,
      created_at: p.created_at,
      updated_at: p.updated_at,
    };
  });
}

export async function onRequest(ctx) {
  const { params, env, request } = ctx;
  const orgId = params.orgId;
  const db = getDB(env);
  if (!db) return err(500, "DB_NOT_CONFIGURED");

  await ensurePledgesTable(db);

  const gate = await requireOrgRole({ env, request, orgId, minRole: "member" });
  if (!gate.ok) return gate.resp;

  try {
    if (request.method === "GET") {
      const pledges = await listPledges(db, orgId);
      return ok({ pledges });
    }

    if (request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const id = uuid();
      const t = now();

      // Accept both new and legacy payloads.
      const pledger_name = toStr(body.pledger_name ?? body.name, 120) || null;
      const pledger_email = toStr(body.pledger_email ?? body.email, 160) || null;

      const type = toStr(body.type ?? body.title, 140);
      const amount = toNumOrNull(body.amount ?? body.qty);

      const unit = toStr(body.unit, 64) || null;
      const note = toStr(body.note ?? body.description, 4000) || null;
      const status = toStr(body.status, 32) || "offered";

      // Legacy mirrors for older UI/exports.
      const title = type || "";
      const description = note;
      const qty = amount;
      const contact = toStr(body.contact, 256) || normalizeLegacyContact(pledger_name, pledger_email);

      const need_id = body.need_id || null;
      const is_public = boolToInt(body.is_public);

      await db
        .prepare(
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
          is_public,
          t,
          t,
          pledger_name,
          pledger_email,
          type || null,
          amount,
          note,
          status
        )
        .run();

      const pledges = await listPledges(db, orgId);
      return ok({ pledge: { id }, pledges });
    }

    if (request.method === "PUT") {
      const body = await request.json().catch(() => ({}));
      const id = body.id;
      if (!id) return err(400, "MISSING_ID");

      const t = now();

      // Partial updates: keep old values when omitted.
      // We'll update both new and legacy fields for compatibility.
      const pledger_name = body.pledger_name !== undefined ? toStr(body.pledger_name, 120) : undefined;
      const pledger_email = body.pledger_email !== undefined ? toStr(body.pledger_email, 160) : undefined;
      const type = body.type !== undefined ? toStr(body.type, 140) : undefined;
      const amount = body.amount !== undefined ? toNumOrNull(body.amount) : undefined;
      const unit = body.unit !== undefined ? (toStr(body.unit, 64) || null) : undefined;
      const note = body.note !== undefined ? (toStr(body.note, 4000) || null) : undefined;
      const status = body.status !== undefined ? (toStr(body.status, 32) || "offered") : undefined;
      const need_id =
        (body.need_id !== undefined || body.needId !== undefined)
          ? (toStr(body.need_id ?? body.needId, 128) || null)
          : undefined;      const is_public = body.is_public !== undefined ? boolToInt(body.is_public) : undefined;

      // Legacy mirrors
      const title = type !== undefined ? type : undefined;
      const description = note !== undefined ? note : undefined;
      const qty = amount !== undefined ? amount : undefined;
      const contact =
        body.contact !== undefined
          ? (toStr(body.contact, 256) || null)
          : undefined;

      // Build dynamic SQL for provided fields only.
      const sets = [];
      const vals = [];

      const add = (col, val) => {
        sets.push(`${col}=?`);
        vals.push(val);
      };

      if (need_id !== undefined) add("need_id", need_id);
      if (unit !== undefined) add("unit", unit);
      if (is_public !== undefined) add("is_public", is_public);

      if (pledger_name !== undefined) add("pledger_name", pledger_name || null);
      if (pledger_email !== undefined) add("pledger_email", pledger_email || null);
      if (type !== undefined) add("type", type || null);
      if (amount !== undefined) add("amount", amount);
      if (note !== undefined) add("note", note);
      if (status !== undefined) add("status", status);

      if (title !== undefined) add("title", title || "");
      if (description !== undefined) add("description", description);
      if (qty !== undefined) add("qty", qty);
      if (contact !== undefined) add("contact", contact);

      add("updated_at", t);

      if (sets.length === 0) return ok({ pledges: await listPledges(db, orgId) });

      await db
        .prepare(
          `UPDATE pledges SET ${sets.join(", ")} WHERE id=? AND org_id=?`
        )
        .bind(...vals, id, orgId)
        .run();

      // If pledge got accepted and it’s linked to a need, auto-bump the need to in_progress.
      // IMPORTANT: do not reference any undefined "fields" object. Use the parsed vars/body.
      const nextStatus =
        status !== undefined ? String(status || "") : String(body.status || "");
      const isAccepted = nextStatus.toLowerCase() === "accepted";

      if (isAccepted) {
        // Prefer the PUT payload, but if it omitted need_id, fetch it.
        let resolvedNeedId =
          need_id !== undefined ? need_id : (body.need_id || null);

        if (!resolvedNeedId) {
          const r = await db
            .prepare("SELECT need_id FROM pledges WHERE id=? AND org_id=?")
            .bind(id, orgId)
            .first();
          resolvedNeedId = r?.need_id || null;
        }

        await bumpNeedToInProgress(db, orgId, resolvedNeedId);
      }

      const pledges = await listPledges(db, orgId);
      return ok({ pledges });    }

    if (request.method === "DELETE") {
      // Support both JSON body and query param.
      let id = null;
      try {
        const body = await request.json();
        id = body?.id || null;
      } catch {
        id = null;
      }
      if (!id) {
        const url = new URL(request.url);
        id = url.searchParams.get("id");
      }
      if (!id) return err(400, "MISSING_ID");

      await db.prepare("DELETE FROM pledges WHERE id=? AND org_id=?").bind(id, orgId).run();
      const pledges = await listPledges(db, orgId);
      return ok({ pledges });
    }

    return err(405, "METHOD_NOT_ALLOWED");
  } catch (e) {
    return err(500, "SERVER_ERROR", { message: String(e?.message || e) });
  }
}
