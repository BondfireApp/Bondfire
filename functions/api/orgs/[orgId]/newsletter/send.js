import { ok, err } from "../../../_lib/http.js";
import { requireOrgRole } from "../../../_lib/auth.js";
import { getDB } from "../../../_bf.js";
import { ensureSubmissions } from "../../../_lib/privateSubmissions.js";
import {
  makeNewsletterUnsubscribeToken,
  newsletterIdentity,
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
}

async function validSubscriberIds(db, orgId) {
  await ensureSubscriberTable(db);
  await ensureSubmissions(db);

  const legacy = await db.prepare(
    "SELECT id FROM newsletter_subscribers WHERE org_id = ?"
  ).bind(orgId).all();
  const encrypted = await db.prepare(
    "SELECT id FROM org_private_submissions WHERE org_id = ? AND type = 'newsletter'"
  ).bind(orgId).all();

  return new Set([
    ...(legacy?.results || []).map((row) => String(row.id || "")),
    ...(encrypted?.results || []).map((row) => String(row.id || "")),
  ].filter(Boolean));
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

  const allowedIds = await validSubscriberIds(db, orgId);
  const recipients = [];
  const seenEmails = new Set();

  for (const row of requested) {
    const id = clean(row?.id, 200);
    const email = validEmail(row?.email);
    if (!id || !email || !allowedIds.has(id)) {
      return err(400, "INVALID_NEWSLETTER_RECIPIENT");
    }
    if (seenEmails.has(email)) continue;
    seenEmails.add(email);
    recipients.push({ id, email });
  }

  if (!recipients.length) return err(400, "NO_NEWSLETTER_SUBSCRIBERS");

  let identity;
  try {
    identity = newsletterIdentity(env, orgId, request.url);
  } catch (error) {
    return err(503, clean(error?.code || error?.message || "NEWSLETTER_FROM_NOT_CONFIGURED", 300));
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
        idempotencyKey: `newsletter/${orgId}/${campaignId}/${batchIndex}`,
      });
      sent += chunk.length;
      providerIds.push(...(result?.ids || []));
    } catch (error) {
      const code = clean(error?.code || error?.message || "NEWSLETTER_SEND_FAILED", 300);
      console.error("NEWSLETTER_SEND_FAILED", { orgId, sent, code });
      return err(502, code, { sent, subscriberCount: recipients.length });
    }
  }

  return ok({
    sent,
    subscriberCount: recipients.length,
    campaignId,
    providerIds,
  });
}
