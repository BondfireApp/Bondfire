import { json } from "../../_lib/http.js";

export async function onRequestGet({ env, params }) {
  const slug = params.slug;

  const orgId = await env.BF_PUBLIC.get(`slug:${slug}`);
  if (!orgId) return json({ ok: false, needs: [] }, { status: 404 });

  const cfgRaw = await env.BF_PUBLIC.get(`org:${orgId}`);
  const cfg = cfgRaw ? JSON.parse(cfgRaw) : null;
  if (!cfg || !cfg.enabled) return json({ ok: false, needs: [] }, { status: 404 });

  const res = await env.BF_DB.prepare(
    "SELECT id, title, description, status, priority, created_at FROM needs WHERE org_id = ? AND is_public = 1 ORDER BY created_at DESC"
  ).bind(orgId).all();

  const needs = (res.results || []).map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    created_at: row.created_at,
  }));

  return json({ ok: true, needs });
}
