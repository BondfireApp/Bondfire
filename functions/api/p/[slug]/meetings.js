
import { ok, err } from "../../_lib/http.js";
import { getDB } from "../../_bf.js";

async function getOrgIdBySlug(env, slug) {
  const s = String(slug || "").trim();
  if (!s) return null;
  const orgId = await env.BF_PUBLIC.get(`slug:${s}`);
  return orgId || null;
}

async function ensureMeetingsTable(db) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS meetings (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        title TEXT NOT NULL,
        starts_at INTEGER NOT NULL,
        ends_at INTEGER NOT NULL,
        location TEXT NULL,
        notes TEXT NULL,
        is_public INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`
    )
    .run();

  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_meetings_org_starts
       ON meetings(org_id, starts_at DESC)`
    )
    .run();
}

export async function onRequest(ctx) {
  const { env, request, params } = ctx;
  const slug = params.slug;

  if (request.method !== "GET") return err(405, "METHOD_NOT_ALLOWED");

  const db = getDB(env);
  if (!db) return err(500, "DB_NOT_CONFIGURED");

  await ensureMeetingsTable(db);

  const orgId = await getOrgIdBySlug(env, slug);
  if (!orgId) return err(404, "NOT_FOUND");

  try {
    const r = await db
      .prepare(
        `SELECT id, org_id, title, starts_at, ends_at, location, notes, is_public, created_at, updated_at
         FROM meetings
         WHERE org_id=? AND is_public=1
         ORDER BY starts_at DESC`
      )
      .bind(orgId)
      .all();

    return ok({ meetings: r.results || [] });
  } catch (e) {
    return err(500, "SERVER_ERROR", { message: String(e?.message || e) });
  }
}
