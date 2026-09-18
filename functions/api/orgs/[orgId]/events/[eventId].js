import { bad, json, now } from "../../../_lib/http.js";
import { requireOrgRole } from "../../../_lib/auth.js";

async function ensureEventsTable(db) {
  await db
    .prepare(`CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      location TEXT,
      starts_at INTEGER,
      ends_at INTEGER,
      tags_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`)
    .run();

  try {
    await db.prepare("ALTER TABLE events ADD COLUMN tags_json TEXT").run();
  } catch {}

  await db
    .prepare("CREATE INDEX IF NOT EXISTS idx_events_org_time ON events(org_id, starts_at DESC, created_at DESC)")
    .run();
}

function normalizeTags(value) {
  if (Array.isArray(value)) {
    return value
      .map((tag) => String(tag ?? "").trim())
      .filter(Boolean)
      .slice(0, 50);
  }

  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return [];

    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return normalizeTags(parsed);
    } catch {}

    return text
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 50);
  }

  return [];
}

function toTagsJson(body) {
  const tags = normalizeTags(body?.tags ?? body?.tags_json);
  return JSON.stringify(tags);
}

function eventWithTags(row) {
  const tags = normalizeTags(row?.tags ?? row?.tags_json);
  return { ...row, tags };
}

export async function onRequestGet({ env, request, params }) {
  const orgId = params.orgId;
  const eventId = params.eventId;

  const auth = await requireOrgRole({ env, request, orgId, minRole: "viewer" });
  if (!auth.ok) return auth.resp;

  await ensureEventsTable(env.BF_DB);

  const row = await env.BF_DB
    .prepare(
      `SELECT id, title, description, location, starts_at, ends_at, tags_json, created_at, updated_at
       FROM events
       WHERE id = ? AND org_id = ?`
    )
    .bind(eventId, orgId)
    .first();

  if (!row) return bad(404, "NOT_FOUND");
  return json({ ok: true, event: eventWithTags(row) });
}

export async function onRequestPut({ env, request, params }) {
  const orgId = params.orgId;
  const eventId = params.eventId;

  const auth = await requireOrgRole({ env, request, orgId, minRole: "member" });
  if (!auth.ok) return auth.resp;

  await ensureEventsTable(env.BF_DB);

  const body = await request.json().catch(() => ({}));

  const startsAt = body.starts_at === undefined ? null : Number(body.starts_at);
  const endsAt = body.ends_at === undefined ? null : Number(body.ends_at);
  const tagsJson = body.tags === undefined && body.tags_json === undefined ? null : toTagsJson(body);

  await env.BF_DB
    .prepare(
      `UPDATE events
       SET title = COALESCE(?, title),
           description = COALESCE(?, description),
           location = COALESCE(?, location),
           starts_at = COALESCE(?, starts_at),
           ends_at = COALESCE(?, ends_at),
           tags_json = COALESCE(?, tags_json),
           updated_at = ?
       WHERE id = ? AND org_id = ?`
    )
    .bind(
      body.title ?? null,
      body.description ?? null,
      body.location ?? null,
      Number.isFinite(startsAt) ? startsAt : null,
      Number.isFinite(endsAt) ? endsAt : null,
      tagsJson,
      now(),
      eventId,
      orgId
    )
    .run();

  return json({ ok: true });
}

export async function onRequestDelete({ env, request, params }) {
  const orgId = params.orgId;
  const eventId = params.eventId;

  const auth = await requireOrgRole({ env, request, orgId, minRole: "admin" });
  if (!auth.ok) return auth.resp;

  await ensureEventsTable(env.BF_DB);

  await env.BF_DB.prepare("DELETE FROM events WHERE id = ? AND org_id = ?").bind(eventId, orgId).run();

  return json({ ok: true });
}
