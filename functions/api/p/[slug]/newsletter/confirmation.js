import { getDB, normalizeEmail } from "../../../_bf.js";
import { bad, json } from "../../../_lib/http.js";
import { getOrgIdBySlug, getPublicCfg } from "../../../_lib/publicPageStore.js";
import { rateLimit } from "../../../_lib/rateLimit.js";
import { ensureSubmissions } from "../../../_lib/privateSubmissions.js";
import {
  makeNewsletterUnsubscribeToken,
  newsletterIdentity,
  newsletterRecipientHash,
  newsletterUnsubscribeUrl,
  renderNewsletterConfirmation,
  sendNewsletterEmail,
  verifyNewsletterSignupReceipt,
} from "../../../_lib/newsletterEmail.js";

const RED_HARBOR_ORG_ID = "73bdf68b-d67a-4d70-8ae8-7c3bf9c934b0";

function validEmail(value) {
  const email = normalizeEmail(value);
  if (!email || email.length > 254) return "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "";
  return email;
}

async function ensureConfirmationTable(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS newsletter_confirmation_sends (
      org_id TEXT NOT NULL,
      subscriber_id TEXT NOT NULL,
      sent_at INTEGER NOT NULL,
      PRIMARY KEY (org_id, subscriber_id)
    )
  `).run();
}

async function subscriberRecord(db, orgId, subscriberId) {
  const plain = await db.prepare(
    "SELECT id, email FROM newsletter_subscribers WHERE org_id = ? AND id = ? LIMIT 1"
  ).bind(orgId, subscriberId).first().catch(() => null);

  if (plain?.id) {
    return { type: "plain", email: normalizeEmail(plain.email) };
  }

  await ensureSubmissions(db);
  const encrypted = await db.prepare(
    "SELECT id FROM org_private_submissions WHERE org_id = ? AND id = ? AND type = 'newsletter' LIMIT 1"
  ).bind(orgId, subscriberId).first();

  if (encrypted?.id) return { type: "encrypted", email: "" };
  return null;
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const slug = String(context?.params?.slug || "").trim();
  if (!slug) return bad(400, "MISSING_SLUG");

  const orgId = await getOrgIdBySlug(env, slug);
  if (!orgId) return bad(404, "NOT_FOUND");
  if (orgId !== RED_HARBOR_ORG_ID) return bad(404, "NOT_FOUND");

  const cfg = await getPublicCfg(env, orgId);
  if (!cfg?.enabled || !cfg?.newsletter_enabled) return bad(404, "NEWSLETTER_SIGNUP_DISABLED");

  const body = await request.json().catch(() => ({}));
  const email = validEmail(body?.email);
  const name = String(body?.name || "").trim().slice(0, 160);
  const receipt = String(body?.confirmationReceipt || "").trim();
  if (!email) return bad(400, "INVALID_EMAIL");
  if (!receipt) return bad(400, "CONFIRMATION_RECEIPT_REQUIRED");

  const verified = await verifyNewsletterSignupReceipt(env, receipt);
  if (!verified || verified.orgId !== orgId) return bad(400, "INVALID_CONFIRMATION_RECEIPT");

  const db = getDB(env);
  if (!db) return bad(500, "DB_NOT_CONFIGURED");

  const subscriber = await subscriberRecord(db, orgId, verified.subscriberId);
  if (!subscriber) return bad(404, "NEWSLETTER_SIGNUP_NOT_FOUND");
  if (subscriber.type === "plain" && subscriber.email !== email) {
    return bad(400, "CONFIRMATION_EMAIL_MISMATCH");
  }

  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "";
  const rl = await rateLimit({
    env,
    key: `newsletter-confirmation:${orgId}:${ip}:${email}`,
    limit: 4,
    windowSec: 60 * 60,
  });
  if (!rl.ok) return bad(429, "RATE_LIMIT");

  await ensureConfirmationTable(db);

  const claim = await db.prepare(
    "INSERT OR IGNORE INTO newsletter_confirmation_sends (org_id, subscriber_id, sent_at) VALUES (?, ?, ?)"
  ).bind(orgId, verified.subscriberId, Date.now()).run();

  if (Number(claim?.meta?.changes || 0) !== 1) {
    return json({ ok: true, sent: false, alreadySent: true });
  }

  try {
    const identity = newsletterIdentity(env, orgId, request.url);
    const emailHash = await newsletterRecipientHash(env, { orgId, email });
    const unsubscribeToken = await makeNewsletterUnsubscribeToken(env, {
      orgId,
      subscriberId: verified.subscriberId,
      emailHash,
    });
    const unsubscribeUrl = newsletterUnsubscribeUrl(identity, unsubscribeToken);
    const rendered = renderNewsletterConfirmation({
      identity,
      name,
      unsubscribeUrl,
    });

    await sendNewsletterEmail(env, {
      from: identity.from,
      to: email,
      subject: "You're subscribed to Red Harbor IWW updates",
      text: rendered.text,
      html: rendered.html,
      unsubscribeUrl,
      idempotencyKey: `newsletter-confirmation/${orgId}/${verified.subscriberId}`,
    });

    return json({ ok: true, sent: true });
  } catch (error) {
    await db.prepare(
      "DELETE FROM newsletter_confirmation_sends WHERE org_id = ? AND subscriber_id = ?"
    ).bind(orgId, verified.subscriberId).run().catch(() => {});

    const code = String(error?.code || error?.message || "CONFIRMATION_SEND_FAILED").slice(0, 300);
    console.error("NEWSLETTER_CONFIRMATION_SEND_FAILED", { orgId, code });
    return bad(502, code);
  }
}


export async function onRequestGet(context) {
  const slug = String(context?.params?.slug || "").trim();
  const orgId = slug ? await getOrgIdBySlug(context.env, slug) : null;
  const isRedHarbor = orgId === RED_HARBOR_ORG_ID;

  return json({
    ok: true,
    delivery: isRedHarbor ? "resend" : "unknown",
    configured: isRedHarbor ? !!String(context?.env?.RESEND_API_KEY || "").trim() : false,
    sender: isRedHarbor ? "newsletter@redharbor.org" : "",
    domain: isRedHarbor ? "redharbor.org" : "",
  });
}
