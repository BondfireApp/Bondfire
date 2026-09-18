import { bad, ok, readJSON, now } from "../../../../_lib/http.js";
import { getOrgIdBySlug } from "../../../../_lib/publicPageStore.js";
import { getDB } from "../../../../_bf.js";

function clean(v, max = 2000) {
  return String(v || "").trim().slice(0, max);
}

function normStatus(v) {
  const s = String(v || "").trim().toLowerCase();
  if (s === "no") return "no";
  if (s === "maybe") return "maybe";
  return "yes";
}

async function ensureTable(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS public_meeting_rsvps (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    meeting_id TEXT NOT NULL,
    name TEXT,
    contact TEXT,
    status TEXT NOT NULL,
    note TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_public_meeting_rsvps_lookup ON public_meeting_rsvps(org_id, meeting_id, created_at DESC)`).run();
}

export async function onRequestPost({ env, params, request }) {
  const slug = String(params?.slug || "").trim();
  const meetingId = String(params?.meetingId || "").trim();
  if (!slug || !meetingId) return bad(400, "MISSING_PARAMS");

  const orgId = await getOrgIdBySlug(env, slug);
  if (!orgId) return bad(404, "NOT_FOUND");

  const db = getDB(env);
  if (!db) return bad(500, "DB_NOT_CONFIGURED");
  await ensureTable(db);

  const meeting = await db.prepare(`SELECT id FROM meetings WHERE org_id=? AND id=? AND is_public=1 LIMIT 1`).bind(orgId, meetingId).first();
  if (!meeting?.id) return bad(404, "MEETING_NOT_FOUND");

  const body = await readJSON(request);
  const id = crypto.randomUUID();
  const created = now();
  await db.prepare(`INSERT INTO public_meeting_rsvps (
    id, org_id, meeting_id, name, contact, status, note, created_at, updated_at
  ) VALUES (?,?,?,?,?,?,?,?,?)`).bind(
    id,
    orgId,
    meetingId,
    clean(body?.name, 160),
    clean(body?.contact, 220),
    normStatus(body?.status),
    clean(body?.note, 4000),
    created,
    created,
  ).run();

  return ok({ id, meeting_id: meetingId, saved: true });
}
