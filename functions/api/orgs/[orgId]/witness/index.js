import { bad, json, now, uuid } from "../../../_lib/http.js";
import { requireOrgRole } from "../../../_lib/auth.js";

async function ensureWitnessTable(db) {
  await db
    .prepare(`CREATE TABLE IF NOT EXISTS witness_records (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT,
      happened_at TEXT,
      visibility TEXT,
      tags_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`)
    .run();

  try {
    await db.prepare("ALTER TABLE witness_records ADD COLUMN tags_json TEXT").run();
  } catch {}

  await db
    .prepare(
      "CREATE INDEX IF NOT EXISTS idx_witness_records_org_updated ON witness_records(org_id, updated_at DESC, created_at DESC)"
    )
    .run();
}

function asText(value, fallback = "") {
  if (value == null) return fallback;
  const text = String(value).trim();
  return text || fallback;
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

function witnessWithTags(row) {
  const tags = normalizeTags(row?.tags ?? row?.tags_json);
  return { ...row, tags };
}

export async function onRequestGet({ env, request, params }) {
  const orgId = params.orgId;
  const auth = await requireOrgRole({ env, request, orgId, minRole: "viewer" });
  if (!auth.ok) return auth.resp;

  await ensureWitnessTable(env.BF_DB);

  const rows = await env.BF_DB
    .prepare(
      `SELECT id, title, summary, happened_at, visibility, tags_json, created_at, updated_at
       FROM witness_records
       WHERE org_id = ?
       ORDER BY updated_at DESC, created_at DESC`
    )
    .bind(orgId)
    .all();

  const items = (rows?.results || []).map(witnessWithTags);
  return json({ ok: true, items, records: items });
}

export async function onRequestPost({ env, request, params }) {
  const orgId = params.orgId;
  const auth = await requireOrgRole({ env, request, orgId, minRole: "member" });
  if (!auth.ok) return auth.resp;

  await ensureWitnessTable(env.BF_DB);

  const body = await request.json().catch(() => ({}));

  const title = asText(body.title);
  if (!title) return bad(400, "MISSING_TITLE");

  const summary = asText(body.summary);
  const happenedAt = asText(body.happened_at, null);
  const visibility = asText(body.visibility, "private");
  const tagsJson = toTagsJson(body);
  const timestamp = now();
  const id = uuid();

  await env.BF_DB
    .prepare(
      `INSERT INTO witness_records (id, org_id, title, summary, happened_at, visibility, tags_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, orgId, title, summary, happenedAt, visibility, tagsJson, timestamp, timestamp)
    .run();

  return json({ ok: true, id });
}
