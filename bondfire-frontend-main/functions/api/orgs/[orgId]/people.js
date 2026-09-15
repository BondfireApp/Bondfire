import { json, bad, now, uuid } from "../../_lib/http.js";
import { requireOrgRole } from "../../_lib/auth.js";
import { logActivity } from "../../_lib/activity.js";

async function getOrgCryptoKeyVersion(db, orgId) {
  try {
    const r = await db.prepare("SELECT key_version FROM org_crypto WHERE org_id = ?").bind(orgId).first();
    return Number(r?.key_version) || 1;
  } catch (e) {
    if (!String(e?.message || "").includes("no such column: key_version")) throw e;
    const r = await db.prepare("SELECT version AS key_version FROM org_crypto WHERE org_id = ?").bind(orgId).first();
    return Number(r?.key_version) || 1;
  }
}
async function ensurePeopleZkColumns(db) {
  try { await db.prepare("ALTER TABLE people ADD COLUMN encrypted_notes TEXT").run(); } catch {}
  try { await db.prepare("ALTER TABLE people ADD COLUMN encrypted_blob TEXT").run(); } catch {}
  try { await db.prepare("ALTER TABLE people ADD COLUMN key_version INTEGER").run(); } catch {}
}

export async function onRequestGet({ env, request, params }) {
  const orgId = params.orgId;
  const a = await requireOrgRole({ env, request, orgId, minRole: "viewer" });
  if (!a.ok) return a.resp;
  await ensurePeopleZkColumns(env.BF_DB);
  const res = await env.BF_DB.prepare(
    "SELECT id, name, role, phone, skills, notes, encrypted_notes, encrypted_blob, key_version, created_at, updated_at FROM people WHERE org_id = ? ORDER BY created_at DESC"
  ).bind(orgId).all();
  return json({ ok: true, people: res.results || [] });
}

export async function onRequestPost({ env, request, params }) {
  const orgId = params.orgId;
  const a = await requireOrgRole({ env, request, orgId, minRole: "member" });
  if (!a.ok) return a.resp;
  await ensurePeopleZkColumns(env.BF_DB);
  const body = await request.json().catch(() => ({}));
  const ciphertext = String(body.encrypted_blob || "").trim();
  if (!ciphertext) return bad(400, "CIPHERTEXT_REQUIRED");
  const id = uuid();
  const t = now();
  const keyVersion = await getOrgCryptoKeyVersion(env.BF_DB, orgId);
  await env.BF_DB.prepare(
    `INSERT INTO people (id, org_id, name, role, phone, skills, notes, encrypted_notes, encrypted_blob, key_version, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(id, orgId, "__encrypted__", "", "", "", "", null, ciphertext, keyVersion, t, t).run();
  logActivity(env, { orgId, kind: "person.created", message: "encrypted person record added", actorUserId: a?.user?.sub || null }).catch(() => {});
  return json({ ok: true, id });
}

export async function onRequestPut({ env, request, params }) {
  const orgId = params.orgId;
  const a = await requireOrgRole({ env, request, orgId, minRole: "member" });
  if (!a.ok) return a.resp;
  await ensurePeopleZkColumns(env.BF_DB);
  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "").trim();
  if (!id) return bad(400, "MISSING_ID");
  const existing = await env.BF_DB.prepare("SELECT encrypted_blob FROM people WHERE id = ? AND org_id = ?").bind(id, orgId).first();
  if (!existing) return bad(404, "NOT_FOUND");
  const ciphertext = String(body.encrypted_blob || existing.encrypted_blob || "").trim();
  if (!ciphertext) return bad(400, "CIPHERTEXT_REQUIRED");
  const keyVersion = body.encrypted_blob ? await getOrgCryptoKeyVersion(env.BF_DB, orgId) : null;
  await env.BF_DB.prepare(
    `UPDATE people SET name = '__encrypted__', role = '', phone = '', skills = '', notes = '', encrypted_notes = NULL,
     encrypted_blob = ?, key_version = COALESCE(?, key_version), updated_at = ? WHERE id = ? AND org_id = ?`
  ).bind(ciphertext, keyVersion, now(), id, orgId).run();
  logActivity(env, { orgId, kind: "person.updated", message: `encrypted person record updated: ${id}`, actorUserId: a?.user?.sub || null }).catch(() => {});
  return json({ ok: true });
}

export async function onRequestDelete({ env, request, params }) {
  const orgId = params.orgId;
  const a = await requireOrgRole({ env, request, orgId, minRole: "admin" });
  if (!a.ok) return a.resp;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return bad(400, "MISSING_ID");
  await env.BF_DB.prepare("DELETE FROM people WHERE id = ? AND org_id = ?").bind(id, orgId).run();
  logActivity(env, { orgId, kind: "person.deleted", message: `encrypted person record deleted: ${id}`, actorUserId: a?.user?.sub || a?.user?.id || null }).catch(() => {});
  return json({ ok: true });
}
