import { getDB, json, bad, readJson, normalizeEmail } from "../../../_bf.js";
import { enforceOrgWriteLockdown } from "../../../_lib/orgLockdown.js";
import { getPublicCfg } from "../../../_lib/publicPageStore.js";
import { rateLimit } from "../../../_lib/rateLimit.js";
import { makeNewsletterSignupReceipt } from "../../../_lib/newsletterEmail.js";

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

  const info = await db.prepare("PRAGMA table_info(newsletter_subscribers)").all();
  const columns = new Set((info?.results || []).map((row) => String(row.name || "").toLowerCase()));
  if (!columns.has("source")) {
    try {
      await db.prepare("ALTER TABLE newsletter_subscribers ADD COLUMN source TEXT NULL").run();
    } catch {
      // Another request may have added it first.
    }
  }

  // Older installs may already contain duplicate test rows, so a unique-index
  // migration must not be allowed to break public signup. The write path below
  // performs its own idempotent lookup/update.
  try {
    await db.prepare(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_newsletter_subscribers_org_email
      ON newsletter_subscribers(org_id, email)
    `).run();
  } catch {
    await db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_newsletter_subscribers_org_email_lookup
      ON newsletter_subscribers(org_id, email)
    `).run();
  }
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

  const existing = await db
    .prepare(
      `SELECT id, name
         FROM newsletter_subscribers
        WHERE org_id = ? AND lower(email) = lower(?)
        ORDER BY created_at DESC
        LIMIT 1`
    )
    .bind(orgId, email)
    .first();

  if (existing?.id) {
    await db
      .prepare(
        `UPDATE newsletter_subscribers
            SET name = CASE WHEN ? != '' THEN ? ELSE name END,
                source = COALESCE(NULLIF(source, ''), 'public-site')
          WHERE org_id = ? AND id = ?`
      )
      .bind(name, name, orgId, existing.id)
      .run();

    const confirmationReceipt = await makeNewsletterSignupReceipt(env, { orgId, subscriberId: existing.id });
    return json({ ok: true, saved: true, existing: true, id: existing.id, confirmationReceipt });
  }

  const now = Date.now();
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO newsletter_subscribers (id, org_id, email, name, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(id, orgId, email, name, "public-site", now)
    .run();

  const confirmationReceipt = await makeNewsletterSignupReceipt(env, { orgId, subscriberId: id });
  return json({ ok: true, saved: true, id, confirmationReceipt });
}
