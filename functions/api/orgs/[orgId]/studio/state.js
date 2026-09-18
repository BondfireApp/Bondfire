import { json, now } from "../../../_lib/http.js";
import { requireOrgRole } from "../../../_lib/auth.js";
import { runAppMigrations } from '../../../_lib/migrations.js'

async function ensureStudioTables(db) {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS studio_docs (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      encrypted_blob TEXT,
      key_version INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`
  ).run();
  await db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_studio_docs_org_updated
     ON studio_docs(org_id, updated_at DESC)`
  ).run();
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS studio_blocks (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      encrypted_blob TEXT,
      key_version INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`
  ).run();
  await db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_studio_blocks_org_updated
     ON studio_blocks(org_id, updated_at DESC)`
  ).run();
}

async function getOrgCryptoKeyVersion(db, orgId) {
  try {
    const row = await db.prepare("SELECT key_version FROM org_crypto WHERE org_id = ?").bind(orgId).first();
    return Number(row?.key_version) || 1;
  } catch (e) {
    const msg = String(e?.message || "");
    if (!msg.includes("no such column: key_version")) throw e;
    const row = await db.prepare("SELECT version AS key_version FROM org_crypto WHERE org_id = ?").bind(orgId).first();
    return Number(row?.key_version) || 1;
  }
}

export async function onRequestGet({ env, request, params }) {
  const orgId = params.orgId;
  const auth = await requireOrgRole({ env, request, orgId, minRole: "viewer" });
  if (!auth.ok) return auth.resp;
  await ensureStudioTables(env.BF_DB);

  const docsRes = await env.BF_DB.prepare(
    `SELECT id, name, encrypted_blob, key_version, created_at, updated_at
     FROM studio_docs
     WHERE org_id = ?
     ORDER BY updated_at DESC`
  ).bind(orgId).all();

  const blocksRes = await env.BF_DB.prepare(
    `SELECT id, name, encrypted_blob, key_version, created_at, updated_at
     FROM studio_blocks
     WHERE org_id = ?
     ORDER BY updated_at DESC`
  ).bind(orgId).all();

  return json({ ok: true, docs: docsRes.results || [], blocks: blocksRes.results || [] });
}

export async function onRequestPost({ env, request, params }) {
  const orgId = params.orgId;
  const auth = await requireOrgRole({ env, request, orgId, minRole: "member" });
  if (!auth.ok) return auth.resp;
  await ensureStudioTables(env.BF_DB);

  const body = await request.json().catch(() => ({}));
  const docs = Array.isArray(body?.docs) ? body.docs : [];
  const blocks = Array.isArray(body?.blocks) ? body.blocks : [];
  const t = now();
  const keyVersion = await getOrgCryptoKeyVersion(env.BF_DB, orgId);

  const keepDocIds = docs.map((item) => String(item?.id || "")).filter(Boolean);
  const keepBlockIds = blocks.map((item) => String(item?.id || "")).filter(Boolean);

  for (const item of docs) {
    const id = String(item?.id || "");
    if (!id) continue;
    const exists = await env.BF_DB.prepare(
      "SELECT id FROM studio_docs WHERE id = ? AND org_id = ?"
    ).bind(id, orgId).first();

    if (exists?.id) {
      await env.BF_DB.prepare(
        `UPDATE studio_docs
         SET name = ?, encrypted_blob = ?, key_version = ?, updated_at = ?
         WHERE id = ? AND org_id = ?`
      ).bind(
        String(item?.name || "__encrypted__"),
        item?.encrypted_blob ?? null,
        keyVersion,
        t,
        id,
        orgId
      ).run();
    } else {
      await env.BF_DB.prepare(
        `INSERT INTO studio_docs (id, org_id, name, encrypted_blob, key_version, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?)`
      ).bind(
        id,
        orgId,
        String(item?.name || "__encrypted__"),
        item?.encrypted_blob ?? null,
        keyVersion,
        t,
        t
      ).run();
    }
  }

  for (const item of blocks) {
    const id = String(item?.id || "");
    if (!id) continue;
    const exists = await env.BF_DB.prepare(
      "SELECT id FROM studio_blocks WHERE id = ? AND org_id = ?"
    ).bind(id, orgId).first();

    if (exists?.id) {
      await env.BF_DB.prepare(
        `UPDATE studio_blocks
         SET name = ?, encrypted_blob = ?, key_version = ?, updated_at = ?
         WHERE id = ? AND org_id = ?`
      ).bind(
        String(item?.name || "__encrypted__"),
        item?.encrypted_blob ?? null,
        keyVersion,
        t,
        id,
        orgId
      ).run();
    } else {
      await env.BF_DB.prepare(
        `INSERT INTO studio_blocks (id, org_id, name, encrypted_blob, key_version, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?)`
      ).bind(
        id,
        orgId,
        String(item?.name || "__encrypted__"),
        item?.encrypted_blob ?? null,
        keyVersion,
        t,
        t
      ).run();
    }
  }

  if (keepDocIds.length) {
    const placeholders = keepDocIds.map(() => "?").join(",");
    await env.BF_DB.prepare(
      `DELETE FROM studio_docs WHERE org_id = ? AND id NOT IN (${placeholders})`
    ).bind(orgId, ...keepDocIds).run();
  } else {
    await env.BF_DB.prepare("DELETE FROM studio_docs WHERE org_id = ?").bind(orgId).run();
  }

  if (keepBlockIds.length) {
    const placeholders = keepBlockIds.map(() => "?").join(",");
    await env.BF_DB.prepare(
      `DELETE FROM studio_blocks WHERE org_id = ? AND id NOT IN (${placeholders})`
    ).bind(orgId, ...keepBlockIds).run();
  } else {
    await env.BF_DB.prepare("DELETE FROM studio_blocks WHERE org_id = ?").bind(orgId).run();
  }

  return json({ ok: true, docs_saved: keepDocIds.length, blocks_saved: keepBlockIds.length });
}