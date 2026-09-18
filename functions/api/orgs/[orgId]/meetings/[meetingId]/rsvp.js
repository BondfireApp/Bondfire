import { ok, bad, readJSON, now } from "../../../../_lib/http.js";
import { getDb, requireOrgRole } from "../../../../_lib/auth.js";

function normStatus(s) {
  const v = String(s || "").trim().toLowerCase();
  if (v === "yes" || v === "going" || v === "y") return "yes";
  if (v === "no" || v === "not going" || v === "n") return "no";
  if (v === "maybe" || v === "m") return "maybe";
  return "yes";
}

async function ensureRsvpTable(db) {
  // Best-effort create for fresh installs. Existing installs may already have a table
  // with a different schema; we handle that by introspecting columns and avoiding
  // assumptions (no hard dependency on an `id` column or PK/UNIQUE constraints).
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS meeting_rsvps (
        org_id TEXT NOT NULL,
        meeting_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        status TEXT NOT NULL,
        note TEXT,
        created_at INTEGER,
        updated_at INTEGER
      )`
    )
    .run();

  // Best-effort index (won't fix legacy tables without a constraint, but helps new installs)
  await db
    .prepare(
      "CREATE INDEX IF NOT EXISTS idx_meeting_rsvps_lookup ON meeting_rsvps(org_id, meeting_id, user_id)"
    )
    .run();
}

async function getColumns(db) {
  const info = await db.prepare("PRAGMA table_info(meeting_rsvps)").all();
  const cols = new Set();
  for (const r of info?.results || []) cols.add(String(r?.name || ""));
  return cols;
}

function has(cols, name) {
  return cols.has(name);
}

export async function onRequest(ctx) {
  const { request, env, params } = ctx || {};
  const orgId = String(params?.orgId || "");
  const meetingId = String(params?.meetingId || "");
  if (!orgId || !meetingId) return bad(400, "MISSING_PARAMS");

  const db = getDb(env);
  if (!db) return bad(500, "NO_DB_BINDING");

  await ensureRsvpTable(db);
  const cols = await getColumns(db);

  // Any org member can RSVP / read their own RSVP.
  const gate = await requireOrgRole({ env, request, orgId, minRole: "member" });
  if (!gate.ok) return gate.resp;

  const role = String(gate.role || "");
  const isAdmin = role === "admin" || role === "owner";
  const userId = String(gate.user?.sub || gate.user?.id || "");
  if (!userId) return bad(401, "UNAUTHORIZED");

  if (request.method === "GET") {
    // Members can read *their own* RSVP; admins can read the full list.
    const my = await db
      .prepare(
        "SELECT status, note, created_at, updated_at FROM meeting_rsvps WHERE org_id=? AND meeting_id=? AND user_id=? LIMIT 1"
      )
      .bind(orgId, meetingId, userId)
      .first();

    if (!isAdmin) return ok({ my_rsvp: my || null });

    const rows = await db
      .prepare(
        "SELECT user_id, status, note, created_at, updated_at FROM meeting_rsvps WHERE org_id=? AND meeting_id=? ORDER BY (CASE WHEN updated_at IS NULL THEN created_at ELSE updated_at END) DESC"
      )
      .bind(orgId, meetingId)
      .all();

    return ok({ my_rsvp: my || null, rsvps: rows?.results || [] });
  }

  if (request.method !== "POST") return bad(405, "METHOD_NOT_ALLOWED");

  const body = await readJSON(request);
  const status = normStatus(body?.status);
  const note = String(body?.note || "").slice(0, 2000);
  const ts = now();

  // Legacy-tolerant "upsert":
  // 1) UPDATE existing rows (works even without UNIQUE/PK)
  // 2) If nothing updated, INSERT a new row
  // We only reference columns that actually exist.
  const setParts = [];
  const setVals = [];
  if (has(cols, "status")) {
    setParts.push("status=?");
    setVals.push(status);
  }
  if (has(cols, "note")) {
    setParts.push("note=?");
    setVals.push(note);
  }
  if (has(cols, "updated_at")) {
    setParts.push("updated_at=?");
    setVals.push(ts);
  }

  if (setParts.length === 0) {
    // Table exists but somehow missing the fields we need. Bail loudly.
    return bad(500, "RSVP_SCHEMA_INVALID");
  }

  const updateRes = await db
    .prepare(
      `UPDATE meeting_rsvps SET ${setParts.join(", ")} WHERE org_id=? AND meeting_id=? AND user_id=?`
    )
    .bind(...setVals, orgId, meetingId, userId)
    .run();

  const updated = Number(updateRes?.meta?.changes || 0);

  if (updated === 0) {
    const insertCols = [];
    const insertQs = [];
    const insertVals = [];

    if (has(cols, "org_id")) {
      insertCols.push("org_id");
      insertQs.push("?");
      insertVals.push(orgId);
    }
    if (has(cols, "meeting_id")) {
      insertCols.push("meeting_id");
      insertQs.push("?");
      insertVals.push(meetingId);
    }
    if (has(cols, "user_id")) {
      insertCols.push("user_id");
      insertQs.push("?");
      insertVals.push(userId);
    }
    if (has(cols, "status")) {
      insertCols.push("status");
      insertQs.push("?");
      insertVals.push(status);
    }
    if (has(cols, "note")) {
      insertCols.push("note");
      insertQs.push("?");
      insertVals.push(note);
    }
    if (has(cols, "created_at")) {
      insertCols.push("created_at");
      insertQs.push("?");
      insertVals.push(ts);
    }
    if (has(cols, "updated_at")) {
      insertCols.push("updated_at");
      insertQs.push("?");
      insertVals.push(ts);
    }
    if (has(cols, "id")) {
      // Some legacy schemas used an id column. Fill it if present.
      const id = (globalThis.crypto?.randomUUID?.() || `${ts}-${Math.random()}`).toString();
      insertCols.push("id");
      insertQs.push("?");
      insertVals.push(id);
    }

    await db
      .prepare(
        `INSERT INTO meeting_rsvps (${insertCols.join(", ")}) VALUES (${insertQs.join(", ")})`
      )
      .bind(...insertVals)
      .run();
  }

  return ok({ meeting_id: meetingId, status });
}
