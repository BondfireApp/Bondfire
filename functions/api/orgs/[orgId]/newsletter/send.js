import { ok, err } from "../../../_lib/http.js";
import { requireOrgRole } from "../../../_lib/auth.js";
import { getDB } from "../../../_bf.js";
import { ensureSubmissions } from "../../../_lib/privateSubmissions.js";
import {
  makeNewsletterUnsubscribeToken,
  newsletterIdentity,
  newsletterRecipientHash,
  newsletterUnsubscribeUrl,
  renderNewsletterMessage,
  sendNewsletterBatch,
} from "../../../_lib/newsletterEmail.js";

function clean(value, max) {
  return String(value || "").trim().slice(0, max);
}

function validEmail(value) {
  const email = clean(value, 254).toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "";
  return email;
}

async function ensureNewsletterTables(db) {
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
  await ensureSubmissions(db);
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS newsletter_suppressions (
      org_id TEXT NOT NULL,
      email_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (org_id, email_hash)
    )
  `).run();
}

async function subscriberRows(db, orgId) {
  await ensureNewsletterTables(db);

  const legacy = await db.prepare(
    "SELECT id, created_at FROM newsletter_subscribers WHERE org_id = ?"
  ).bind(orgId).all();
  const encrypted = await db.prepare(
    "SELECT id, created_at FROM org_private_submissions WHERE org_id = ? AND type = 'newsletter'"
  ).bind(orgId).all();

  const rows = new Map();
  for (const row of [...(legacy?.results || []), ...(encrypted?.results || [])]) {
    const id = String(row?.id || "").trim();
    if (!id) continue;
    rows.set(id, { id, createdAt: Number(row?.created_at || 0) });
  }
  return rows;
}

export async function onRequestPost({ env, request, params }) {
  const orgId = clean(params?.orgId, 200);
  if (!orgId) return err(400, "BAD_ORG_ID");

  const gate = await requireOrgRole({ env, request, orgId, minRole: "admin" });
  if (!gate.ok) return gate.resp;

  if (!String(env?.RESEND_API_KEY || "").trim()) {
    return err(503, "RESEND_NOT_CONFIGURED");
  }

  const db = getDB(env);
  if (!db) return err(500, "DB_NOT_CONFIGURED");

  const body = await request.json().catch(() => ({}));
  const subject = clean(body?.subject, 200);
  const messageBody = clean(body?.body, 50000);
  const campaignId = clean(body?.campaignId, 120) || crypto.randomUUID();
  const requested = Array.isArray(body?.recipients) ? body.recipients : [];

  if (!subject) return err(400, "NEWSLETTER_SUBJECT_REQUIRED");
  if (!messageBody) return err(400, "NEWSLETTER_BODY_REQUIRED");
  if (!requested.length) return err(400, "NO_NEWSLETTER_SUBSCRIBERS");
  if (requested.length > 5000) return err(400, "TOO_MANY_NEWSLETTER_RECIPIENTS");

  const allowedRows = await subscriberRows(db, orgId);
  const newestByEmail = new Map();

  for (const row of requested) {
    const id = clean(row?.id, 200);
    const email = validEmail(row?.email);
    const stored = allowedRows.get(id);
    if (!id || !email || !stored) {
      return err(400, "INVALID_NEWSLETTER_RECIPIENT");
    }

    const current = newestByEmail.get(email);
    if (!current || stored.createdAt > current.createdAt) {
      newestByEmail.set(email, { id, email, createdAt: stored.createdAt });
    }
  }

  const suppressionResult = await db.prepare(
    "SELECT email_hash, created_at FROM newsletter_suppressions WHERE org_id = ?"
  ).bind(orgId).all();
  const suppressions = new Map(
    (suppressionResult?.results || []).map((row) => [
      String(row?.email_hash || ""),
      Number(row?.created_at || 0),
    ])
  );

  const recipients = [];
  const clearSuppressions = [];
  let suppressed = 0;

  for (const candidate of newestByEmail.values()) {
    const emailHash = await newsletterRecipientHash(env, {
      orgId,
      email: candidate.email,
    });
    const suppressedAt = Number(suppressions.get(emailHash) || 0);

    if (suppressedAt && candidate.createdAt <= suppressedAt) {
      suppressed += 1;
      continue;
    }

    if (suppressedAt && candidate.createdAt > suppressedAt) {
      clearSuppressions.push(
        db.prepare("DELETE FROM newsletter_suppressions WHERE org_id = ? AND email_hash = ?")
          .bind(orgId, emailHash)
      );
    }

    recipients.push({ ...candidate, emailHash });
  }

  if (clearSuppressions.length) await db.batch(clearSuppressions);

  let identity;
  try {
    identity = await newsletterIdentity(env, orgId, request.url);
  } catch (error) {
    return err(503, clean(error?.code || error?.message || "NEWSLETTER_FROM_NOT_CONFIGURED", 300));
  }

  if (!recipients.length) {
    return ok({
      sent: 0,
      subscriberCount: newestByEmail.size,
      suppressed,
      campaignId,
      providerIds: [],
    });
  }

  let sent = 0;
  const providerIds = [];

  for (let offset = 0, batchIndex = 0; offset < recipients.length; offset += 100, batchIndex += 1) {
    const chunk = recipients.slice(offset, offset + 100);
    const messages = [];

    for (const recipient of chunk) {
      const token = await makeNewsletterUnsubscribeToken(env, {
        orgId,
        subscriberId: recipient.id,
        emailHash: recipient.emailHash,
      });
      const unsubscribeUrl = newsletterUnsubscribeUrl(identity, token);
      const rendered = renderNewsletterMessage({
        identity,
        body: messageBody,
        unsubscribeUrl,
      });
      messages.push({
        to: recipient.email,
        subject,
        text: rendered.text,
        html: rendered.html,
        unsubscribeUrl,
      });
    }

    try {
      const result = await sendNewsletterBatch(env, {
        from: identity.from,
        messages,
        replyTo: identity.replyTo,
        idempotencyKey: `newsletter/${orgId}/${campaignId}/${batchIndex}`,
      });
      sent += chunk.length;
      providerIds.push(...(result?.ids || []));
    } catch (error) {
      const code = clean(error?.code || error?.message || "NEWSLETTER_SEND_FAILED", 300);
      console.error("NEWSLETTER_SEND_FAILED", { orgId, sent, code });
      return err(502, code, {
        sent,
        subscriberCount: newestByEmail.size,
        suppressed,
      });
    }
  }

  return ok({
    sent,
    subscriberCount: newestByEmail.size,
    suppressed,
    campaignId,
    providerIds,
  });
}
