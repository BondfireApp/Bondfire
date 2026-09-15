import { json } from "../../../_lib/http.js";
import { requireOrgRole } from "../../../_lib/auth.js";

function asText(value) {
  return String(value ?? "");
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

function eventSubtitle(row) {
  const startsAt = row?.starts_at;
  let dateText = "Date pending";
  if (startsAt != null && startsAt !== "") {
    const n = Number(startsAt);
    const d = Number.isFinite(n) ? new Date(n) : new Date(startsAt);
    if (!Number.isNaN(d.getTime())) dateText = d.toISOString();
  }

  const location = asText(row?.location).trim();
  return location ? `${dateText} • ${location}` : dateText;
}

function witnessSubtitle(row) {
  const summary = asText(row?.summary).trim();
  if (summary) return summary;
  return asText(row?.happened_at).trim() || "Witness record";
}

async function queryEvents(db, orgId, likeNeedle) {
  try {
    const rows = await db
      .prepare(
        `SELECT id, title, description, location, starts_at, tags_json
         FROM events
         WHERE org_id = ?
           AND (
             LOWER(COALESCE(title, '')) LIKE ?
             OR LOWER(COALESCE(description, '')) LIKE ?
             OR LOWER(COALESCE(location, '')) LIKE ?
             OR LOWER(COALESCE(tags_json, '')) LIKE ?
           )
         ORDER BY starts_at DESC, created_at DESC
         LIMIT 25`
      )
      .bind(orgId, likeNeedle, likeNeedle, likeNeedle, likeNeedle)
      .all();

    return (rows?.results || []).map((row) => ({
      type: "event",
      id: row.id,
      title: asText(row.title).trim() || "Untitled event",
      subtitle: eventSubtitle(row),
      href: `/org/${encodeURIComponent(orgId)}/events/${encodeURIComponent(row.id || "")}`,
      tags: normalizeTags(row.tags_json),
    }));
  } catch (e) {
    const msg = asText(e?.message).toLowerCase();
    if (msg.includes("no such table") || msg.includes("no such column")) return [];
    throw e;
  }
}

async function queryWitness(db, orgId, likeNeedle) {
  try {
    const rows = await db
      .prepare(
        `SELECT id, title, summary, happened_at, tags_json
         FROM witness_records
         WHERE org_id = ?
           AND (
             LOWER(COALESCE(title, '')) LIKE ?
             OR LOWER(COALESCE(summary, '')) LIKE ?
             OR LOWER(COALESCE(tags_json, '')) LIKE ?
           )
         ORDER BY updated_at DESC, created_at DESC
         LIMIT 25`
      )
      .bind(orgId, likeNeedle, likeNeedle, likeNeedle)
      .all();

    return (rows?.results || []).map((row) => ({
      type: "witness",
      id: row.id,
      title: asText(row.title).trim() || "Untitled witness record",
      subtitle: witnessSubtitle(row),
      href: `/org/${encodeURIComponent(orgId)}/witness`,
      tags: normalizeTags(row.tags_json),
    }));
  } catch (e) {
    const msg = asText(e?.message).toLowerCase();
    if (msg.includes("no such table") || msg.includes("no such column")) return [];
    throw e;
  }
}

export async function onRequestGet({ env, request, params }) {
  const orgId = params.orgId;
  const auth = await requireOrgRole({ env, request, orgId, minRole: "viewer" });
  if (!auth.ok) return auth.resp;

  const url = new URL(request.url);
  const q = asText(url.searchParams.get("q")).trim().toLowerCase();
  if (!q) return json({ ok: true, items: [], results: [] });

  const likeNeedle = `%${q}%`;
  let eventItems = [];
  let witnessItems = [];
  try {
    eventItems = await queryEvents(env.BF_DB, orgId, likeNeedle);
  } catch {}
  try {
    witnessItems = await queryWitness(env.BF_DB, orgId, likeNeedle);
  } catch {}
  const items = [...eventItems, ...witnessItems];

  return json({ ok: true, items, results: items });
}
