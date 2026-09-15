import { getDB } from "../../_bf.js";
import { getPublicCfg, getOrgIdBySlug } from "../../_lib/publicPageStore.js";

export async function onRequestGet({ env, params }) {
  const slug = params.slug;
  const db = getDB(env);
  if (!db) return Response.json({ ok: false, error: "DB_NOT_CONFIGURED" }, { status: 500 });

  const orgId = await getOrgIdBySlug(env, slug);
  if (!orgId) return Response.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });

  const pub = await getPublicCfg(env, orgId);
  if (!pub?.enabled) return Response.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });

  const r = await db
    .prepare(
      `SELECT id, title, starts_at, ends_at, location, agenda
       FROM meetings
       WHERE org_id=? AND is_public=1
       ORDER BY COALESCE(starts_at, 0) DESC, updated_at DESC`
    )
    .bind(orgId)
    .all();

  return Response.json({ ok: true, meetings: r.results || [] });
}
