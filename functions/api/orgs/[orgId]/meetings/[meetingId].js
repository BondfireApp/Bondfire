import { json, bad, now } from "../../../_lib/http.js";
import { requireOrgRole } from "../../../_lib/auth.js";
import { runAppMigrations } from '../../../_lib/migrations.js'

async function ensureMeetingsPublicColumn(db) {
  try {
    await db
      .prepare("ALTER TABLE meetings ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0")
      .run();
  } catch {
    // ignore (already exists)
  }
}

async function ensurePublicMeetingRsvpsTable(db) {
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

async function getRsvpCounts(db, orgId, meetingId) {
  const [memberRows, publicRows] = await Promise.all([
    db.prepare(`SELECT status, COUNT(*) AS c
      FROM meeting_rsvps
      WHERE org_id = ? AND meeting_id = ?
      GROUP BY status`).bind(orgId, meetingId).all().catch(() => ({ results: [] })),
    db.prepare(`SELECT status, COUNT(*) AS c
      FROM public_meeting_rsvps
      WHERE org_id = ? AND meeting_id = ?
      GROUP BY status`).bind(orgId, meetingId).all().catch(() => ({ results: [] })),
  ]);

  const blank = { yes: 0, maybe: 0, no: 0, total: 0 };
  const member = { ...blank };
  const pub = { ...blank };

  for (const row of memberRows?.results || []) {
    const status = String(row?.status || '').toLowerCase();
    const count = Number(row?.c || 0);
    if (status === 'yes' || status === 'maybe' || status === 'no') member[status] += count;
  }
  for (const row of publicRows?.results || []) {
    const status = String(row?.status || '').toLowerCase();
    const count = Number(row?.c || 0);
    if (status === 'yes' || status === 'maybe' || status === 'no') pub[status] += count;
  }

  member.total = member.yes + member.maybe + member.no;
  pub.total = pub.yes + pub.maybe + pub.no;

  return {
    member,
    public: pub,
    combined: {
      yes: member.yes + pub.yes,
      maybe: member.maybe + pub.maybe,
      no: member.no + pub.no,
      total: member.total + pub.total,
    },
  };
}

export async function onRequestGet({ env, request, params }) {
  const orgId = params.orgId;
  const meetingId = params.meetingId;

  const a = await requireOrgRole({ env, request, orgId, minRole: "viewer" });
  if (!a.ok) return a.resp;

  await ensureMeetingsPublicColumn(env.BF_DB);
  await ensurePublicMeetingRsvpsTable(env.BF_DB);

  const row = await env.BF_DB.prepare(
    `SELECT id, title, starts_at, ends_at, location, agenda, notes, is_public, created_at, updated_at
     FROM meetings
     WHERE id = ? AND org_id = ?`
  ).bind(meetingId, orgId).first();

  if (!row) return bad(404, "NOT_FOUND");
  const rsvp_counts = await getRsvpCounts(env.BF_DB, orgId, meetingId);
  return json({ ok: true, meeting: { ...row, rsvp_counts } });
}

export async function onRequestPut({ env, request, params }) {
  const orgId = params.orgId;
  const meetingId = params.meetingId;

  const a = await requireOrgRole({ env, request, orgId, minRole: "member" });
  if (!a.ok) return a.resp;

  await ensureMeetingsPublicColumn(env.BF_DB);

  const body = await request.json().catch(() => ({}));

  await env.BF_DB.prepare(
    `UPDATE meetings
     SET title = COALESCE(?, title),
         starts_at = COALESCE(?, starts_at),
         ends_at = COALESCE(?, ends_at),
         location = COALESCE(?, location),
         agenda = COALESCE(?, agenda),
         notes = COALESCE(?, notes),
         is_public = COALESCE(?, is_public),
         updated_at = ?
     WHERE id = ? AND org_id = ?`
  ).bind(
    body.title ?? null,
    body.starts_at ?? null,
    body.ends_at ?? null,
    body.location ?? null,
    body.agenda ?? null,
    body.notes ?? null,
    body.is_public === undefined ? null : (body.is_public ? 1 : 0),
    now(),
    meetingId,
    orgId
  ).run();

  return json({ ok: true });
}

export async function onRequestDelete({ env, request, params }) {
  const orgId = params.orgId;
  const meetingId = params.meetingId;

  const a = await requireOrgRole({ env, request, orgId, minRole: "admin" });
  if (!a.ok) return a.resp;

  await env.BF_DB.prepare("DELETE FROM meetings WHERE id = ? AND org_id = ?")
    .bind(meetingId, orgId)
    .run();

  return json({ ok: true });
}