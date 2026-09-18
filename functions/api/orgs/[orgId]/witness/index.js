import { bad, json, now, uuid } from "../../../_lib/http.js";
import { requireOrgRole } from "../../../_lib/auth.js";

const REC_API_BASE = "https://rec.bjgarr.workers.dev";
const LEGACY_REC_CUTOFF_MS = Date.parse("2026-09-16T17:00:00Z");

async function ensureWitnessTable(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS witness_records (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT,
    happened_at TEXT,
    visibility TEXT,
    tags_json TEXT,
    created_by_user_id TEXT,
    encrypted_recovery TEXT,
    rec_archive_id TEXT,
    rec_claimed INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`).run();
  for (const sql of [
    "ALTER TABLE witness_records ADD COLUMN tags_json TEXT",
    "ALTER TABLE witness_records ADD COLUMN created_by_user_id TEXT",
    "ALTER TABLE witness_records ADD COLUMN encrypted_recovery TEXT",
    "ALTER TABLE witness_records ADD COLUMN rec_archive_id TEXT",
    "ALTER TABLE witness_records ADD COLUMN rec_claimed INTEGER NOT NULL DEFAULT 0",
  ]) {
    try { await db.prepare(sql).run(); } catch {}
  }

  await db.prepare(
    "CREATE INDEX IF NOT EXISTS idx_witness_records_org_updated ON witness_records(org_id, updated_at DESC, created_at DESC)"
  ).run();
}

function asText(value, fallback = "") {
  if (value == null) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function normalizeTags(value) {
  if (Array.isArray(value)) return value.map((tag) => String(tag ?? "").trim()).filter(Boolean).slice(0, 50);
  if (typeof value !== "string") return [];
  const text = value.trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return normalizeTags(parsed);
  } catch {}
  return text.split(",").map((tag) => tag.trim()).filter(Boolean).slice(0, 50);
}

function toTagsJson(body) {
  return JSON.stringify(normalizeTags(body?.tags ?? body?.tags_json));
}

function archiveIdFromRow(row) {
  const explicit = asText(row?.rec_archive_id);
  if (explicit) return explicit;
  const tag = normalizeTags(row?.tags_json).find((item) => item.startsWith("archive:"));
  return tag ? tag.slice("archive:".length) : "";
}

function isPrivileged(role) {
  return role === "admin" || role === "owner";
}

function canManageRec(auth, row) {
  const userId = String(auth?.user?.sub || "");
  const creator = String(row?.created_by_user_id || "");
  return Boolean((creator && creator === userId) || isPrivileged(auth?.role));
}
function presentRow(row, auth) {
  const tags = normalizeTags(row?.tags_json);
  const archiveId = archiveIdFromRow(row);
  const manageable = canManageRec(auth, row);
  return {
    ...row,
    tags,
    rec_archive_id: archiveId,
    encrypted_recovery: manageable ? row?.encrypted_recovery || null : null,
    can_manage_rec: manageable,
    legacy_rec: Boolean(archiveId && Number(row?.rec_claimed || 0) !== 1),
  };
}

async function recBridge(env, path, method, body) {
  const secret = String(env?.BONDFIRE_BRIDGE_SECRET || "").trim();
  if (!secret) {
    const error = new Error("REC bridge is not configured");
    error.status = 503;
    throw error;
  }
  const response = await fetch(`${REC_API_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error || `REC bridge request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

export async function onRequestGet({ env, request, params }) {
  const orgId = params.orgId;
  const auth = await requireOrgRole({ env, request, orgId, minRole: "viewer" });
  if (!auth.ok) return auth.resp;

  await ensureWitnessTable(env.BF_DB);
  const rows = await env.BF_DB.prepare(
    `SELECT id, title, summary, happened_at, visibility, tags_json,
            created_by_user_id, encrypted_recovery, rec_archive_id, rec_claimed,
            created_at, updated_at
     FROM witness_records
     WHERE org_id = ?
     ORDER BY updated_at DESC, created_at DESC`
  ).bind(orgId).all();

  const items = (rows?.results || []).map((row) => presentRow(row, auth));
  return json({ ok: true, items, records: items, viewer_role: auth.role, viewer_user_id: auth?.user?.sub || null });
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
  const recArchiveId = asText(body.rec_archive_id);
  const encryptedRecovery = asText(body.encrypted_recovery, null);
  const managementToken = asText(body.rec_management_token);
  if (recArchiveId && !managementToken) return bad(400, "MISSING_REC_MANAGEMENT_TOKEN");

  const timestamp = now();
  const id = uuid();
  const creator = String(auth?.user?.sub || "");
  await env.BF_DB.prepare(
    `INSERT INTO witness_records
      (id, org_id, title, summary, happened_at, visibility, tags_json,
       created_by_user_id, encrypted_recovery, rec_archive_id, rec_claimed, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
  ).bind(
    id, orgId, title, summary, happenedAt, visibility, tagsJson,
    creator || null, encryptedRecovery, recArchiveId || null, timestamp, timestamp
  ).run();

  if (recArchiveId) {
    try {
      await recBridge(env, "/api/integrations/bondfire/claim", "POST", {
        archiveId: recArchiveId,
        orgId,
        witnessId: id,
        ownerUserId: creator,
        managementToken,
      });
      await env.BF_DB.prepare("UPDATE witness_records SET rec_claimed = 1, updated_at = ? WHERE id = ? AND org_id = ?")
        .bind(now(), id, orgId).run();
    } catch (error) {
      await env.BF_DB.prepare("DELETE FROM witness_records WHERE id = ? AND org_id = ?").bind(id, orgId).run();
      return bad(Number(error?.status) || 502, "REC_CLAIM_FAILED");
    }
  }

  return json({ ok: true, id });
}
export async function onRequestDelete({ env, request, params }) {
  const orgId = params.orgId;
  const auth = await requireOrgRole({ env, request, orgId, minRole: "member" });
  if (!auth.ok) return auth.resp;

  await ensureWitnessTable(env.BF_DB);
  const url = new URL(request.url);
  const id = String(url.searchParams.get("id") || "").trim();
  const archiveIdParam = String(url.searchParams.get("archiveId") || "").trim();
  if (!id && !archiveIdParam) return bad(400, "MISSING_ID");

  let row = null;
  if (id) {
    row = await env.BF_DB.prepare(
      `SELECT * FROM witness_records WHERE id = ? AND org_id = ? LIMIT 1`
    ).bind(id, orgId).first();
  } else {
    row = await env.BF_DB.prepare(
      `SELECT * FROM witness_records
       WHERE org_id = ? AND (rec_archive_id = ? OR tags_json LIKE ?)
       ORDER BY created_at DESC LIMIT 1`
    ).bind(orgId, archiveIdParam, `%archive:${archiveIdParam}%`).first();
  }
  if (!row) return bad(404, "NOT_FOUND");
  const archiveId = archiveIdFromRow(row);
  const privileged = isPrivileged(auth.role);
  const creator = String(row?.created_by_user_id || "");
  const currentUserId = String(auth?.user?.sub || "");
  const isCreator = Boolean(creator && creator === currentUserId);
  const legacy = Boolean(
    archiveId &&
    Number(row?.rec_claimed || 0) !== 1 &&
    Number(row?.created_at || 0) < LEGACY_REC_CUTOFF_MS
  );

  if (!isCreator && !privileged) return bad(403, "INSUFFICIENT_ROLE");
  if (legacy && !privileged) return bad(403, "LEGACY_REC_OWNER_REQUIRED");

  if (archiveId) {
    try {
      await recBridge(env, "/api/integrations/bondfire/archive", "DELETE", {
        archiveId,
        orgId,
        witnessId: row.id,
        allowLegacy: Boolean(legacy && privileged),
      });
    } catch (error) {
      if (Number(error?.status) !== 404) {
        return bad(Number(error?.status) || 502, "REC_DELETE_FAILED");
      }
    }
  }
  await env.BF_DB.prepare("DELETE FROM witness_records WHERE id = ? AND org_id = ?")
    .bind(row.id, orgId)
    .run();

  return json({ ok: true, deleted: row.id, archive_id: archiveId || null });
}
