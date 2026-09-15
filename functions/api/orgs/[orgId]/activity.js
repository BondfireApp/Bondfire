import { json, bad, now, uuid } from "../../_lib/http.js";
import { requireOrgRole } from "../../_lib/auth.js";
import { runAppMigrations } from '../../_lib/migrations.js'

// Simple recent activity feed.
// Columns expected:
// id, org_id, kind, message, actor_user_id, created_at, meta_json

export async function onRequestGet({ env, request, params }) {
  const orgId = params.orgId;
  const a = await requireOrgRole({ env, request, orgId, minRole: "viewer" });
  if (!a.ok) return a.resp;

  const url = new URL(request.url);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 20)));

  const res = await env.BF_DB.prepare(
    "SELECT id, kind, message, actor_user_id, created_at, meta_json FROM activity WHERE org_id = ? ORDER BY created_at DESC LIMIT ?"
  )
    .bind(orgId, limit)
    .all();

  return json({ ok: true, activity: res.results || [] });
}

// Optional: allow members/admins to post activity entries.
export async function onRequestPost({ env, request, params }) {
  const orgId = params.orgId;
  const a = await requireOrgRole({ env, request, orgId, minRole: "member" });
  if (!a.ok) return a.resp;

  const body = await request.json().catch(() => ({}));
  const kind = String(body.kind || "note").trim() || "note";
  const message = String(body.message || "").trim();
  if (!message) return bad(400, "MISSING_MESSAGE");

  const id = uuid();
  const t = now();
  const actorUserId = a.user?.id || null;
  const metaJson = body.meta ? JSON.stringify(body.meta) : null;

  await env.BF_DB.prepare(
    "INSERT INTO activity (id, org_id, kind, message, actor_user_id, created_at, meta_json) VALUES (?,?,?,?,?,?,?)"
  )
    .bind(id, orgId, kind, message, actorUserId, t, metaJson)
    .run();

  return json({ ok: true, id });
}