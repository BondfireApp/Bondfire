import { bad, json, now, uuid } from "../../_lib/http.js";
import { requireOrgRole } from "../../_lib/auth.js";

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
  const auth = await requireOrgRole({ env, request, orgId, minRole: "viewer" });
  if (!auth.ok) return auth.resp;

  await ensureEventsTable(env.BF_DB);

  const rows = await env.BF_DB
    .prepare(
      `SELECT id, title, description, location, starts_at, ends_at, tags_json, created_at, updated_at
       FROM events
       WHERE org_id = ?
       ORDER BY starts_at DESC, created_at DESC`
    )
    .bind(orgId)
    .all();

  const events = (rows.results || []).map(eventWithTags);
  return json({ ok: true, events });
}

export async function onRequestPost({ env, request, params }) {
  const orgId = params.orgId;
  const auth = await requireOrgRole({ env, request, orgId, minRole: "member" });
  if (!auth.ok) return auth.resp;

  await ensureEventsTable(env.BF_DB);

  const body = await request.json().catch(() => ({}));
  const title = String(body.title || "").trim();
  if (!title) return bad(400, "MISSING_TITLE");

  const startsAt = Number.isFinite(Number(body.starts_at)) ? Number(body.starts_at) : null;
  const endsAt = Number.isFinite(Number(body.ends_at)) ? Number(body.ends_at) : null;
  const tagsJson = toTagsJson(body);
  const t = now();

  const id = uuid();
  await env.BF_DB
    .prepare(
      `INSERT INTO events (id, org_id, title, description, location, starts_at, ends_at, tags_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      orgId,
      title,
      String(body.description || ""),
      String(body.location || ""),
      startsAt,
      endsAt,
      tagsJson,
      t,
      t
    )
    .run();

  return json({ ok: true, id });
}

export async function onRequestPut({ env, request, params }) {
  const orgId = params.orgId;
  const auth = await requireOrgRole({ env, request, orgId, minRole: "member" });
  if (!auth.ok) return auth.resp;

  await ensureEventsTable(env.BF_DB);

  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "").trim();
  if (!id) return bad(400, "MISSING_ID");

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
      id,
      orgId
    )
    .run();

  return json({ ok: true });
}

export async function onRequestDelete({ env, request, params }) {
  const orgId = params.orgId;
  const auth = await requireOrgRole({ env, request, orgId, minRole: "admin" });
  if (!auth.ok) return auth.resp;

  await ensureEventsTable(env.BF_DB);

  const url = new URL(request.url);
  const id = String(url.searchParams.get("id") || "").trim();
  if (!id) return bad(400, "MISSING_ID");

  await env.BF_DB.prepare("DELETE FROM events WHERE id = ? AND org_id = ?").bind(id, orgId).run();

  return json({ ok: true });
}
