import { getDB, json, bad, readJson, normalizeEmail } from "../../../_bf.js";
import { enforceOrgWriteLockdown } from "../../../_lib/orgLockdown.js";

export async function onRequest(context) {
  const { request, env, params } = context;
  const db = getDB(env);
  if (!db) return bad("DB_NOT_CONFIGURED", 500);

  const orgId = String(params.orgId || "");

  if (request.method !== "POST") return bad("METHOD_NOT_ALLOWED", 405);
  const lockdown = await enforceOrgWriteLockdown({ env, orgId });
  if (!lockdown.ok) return lockdown.resp;

  const body = await readJson(request);
  if (!body) return bad("BAD_JSON", 400);

  const email = normalizeEmail(body.email);
  const name = String(body.name || "").trim();

  if (!email || !email.includes("@")) return bad("INVALID_EMAIL", 400);

  const now = Date.now();
  const id = crypto.randomUUID();

  await db
    .prepare(
      `INSERT INTO newsletter_subscribers (id, org_id, email, name, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(org_id, email) DO UPDATE SET
         name = CASE
           WHEN excluded.name IS NOT NULL AND excluded.name != ''
           THEN excluded.name
           ELSE newsletter_subscribers.name
         END`
    )
    .bind(id, orgId, email, name, now)
    .run();

  return json({ ok: true });
}
