import { getDB, json, bad, readJson, normalizeEmail } from "../../../_bf.js";
import { enforceOrgWriteLockdown } from "../../../_lib/orgLockdown.js";
import { getPublicCfg } from "../../../_lib/publicPageStore.js";
import { rateLimit } from "../../../_lib/rateLimit.js";

function validEmail(value) {
  const email = normalizeEmail(value);
  if (!email || email.length > 254) return "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "";
  return email;
}

async function ensureSubscriberTable(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS newsletter_subscribers (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      email TEXT NOT NULL,
      name TEXT NULL,
      source TEXT NULL,
      created_at INTEGER NOT NULL
    )
  `).run();

  await db.prepare(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_newsletter_subscribers_org_email
    ON newsletter_subscribers(org_id, email)
  `).run();
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const db = getDB(env);
  if (!db) return bad("DB_NOT_CONFIGURED", 500);

  const orgId = String(params.orgId || "").trim();
  if (!orgId) return bad("BAD_ORG_ID", 400);
  if (request.method !== "POST") return bad("METHOD_NOT_ALLOWED", 405);

  const cfg = await getPublicCfg(env, orgId);
  if (!cfg?.enabled || !cfg?.newsletter_enabled) return bad("NEWSLETTER_SIGNUP_DISABLED", 404);

  const lockdown = await enforceOrgWriteLockdown({ env, orgId });
  if (!lockdown.ok) return lockdown.resp;

  const body = await readJson(request);
  if (!body) return bad("BAD_JSON", 400);

  // Cheap honeypot for generic form bots. Real clients never send this field.
  if (String(body.website || "").trim()) return json({ ok: true });

  const email = validEmail(body.email);
  const name = String(body.name || "").trim().slice(0, 160);
  if (!email) return bad("INVALID_EMAIL", 400);

  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "";
  const rl = await rateLimit({
    env,
    key: `newsletter-signup:${orgId}:${ip}:${email}`,
    limit: 6,
    windowSec: 60 * 60,
  });
  if (!rl.ok) return bad("RATE_LIMIT", 429);

  await ensureSubscriberTable(db);

  const now = Date.now();
  const id = crypto.randomUUID();

  await db
    .prepare(
      `INSERT INTO newsletter_subscribers (id, org_id, email, name, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(org_id, email) DO UPDATE SET
         name = CASE
           WHEN excluded.name IS NOT NULL AND excluded.name != ''
           THEN excluded.name
           ELSE newsletter_subscribers.name
         END`
    )
    .bind(id, orgId, email, name, "public-site", now)
    .run();

  return json({ ok: true, saved: true });
}
