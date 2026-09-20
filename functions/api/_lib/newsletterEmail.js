import { getDB } from "../_bf.js";
import { getPublicCfg } from "./publicPageStore.js";
import { listPublicSiteDomains, publicDomainScope } from "./publicSiteDomains.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64UrlEncode(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function htmlEscape(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function signingSecret(env) {
  return String(env?.NEWSLETTER_UNSUBSCRIBE_SECRET || env?.JWT_SECRET || "").trim();
}

async function hmacKey(env) {
  const secret = signingSecret(env);
  if (!secret) {
    const error = new Error("NEWSLETTER_UNSUBSCRIBE_SECRET_NOT_CONFIGURED");
    error.code = "NEWSLETTER_UNSUBSCRIBE_SECRET_NOT_CONFIGURED";
    throw error;
  }
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

function validSenderEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!email || email.length > 254) return "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function configuredFromAddress(value, name) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.includes("<") && raw.includes(">")) return raw;
  const email = validSenderEmail(raw);
  return email ? `${String(name || "Bondfire organization").trim()} <${email}>` : "";
}

export async function newsletterIdentity(env, orgId, requestUrl = "") {
  const id = String(orgId || "").trim();
  if (!id) {
    const error = new Error("NEWSLETTER_ORG_REQUIRED");
    error.code = "NEWSLETTER_ORG_REQUIRED";
    throw error;
  }

  const cfg = await getPublicCfg(env, id).catch(() => ({}));
  const db = getDB(env);

  let settings = null;
  if (db?.prepare) {
    try {
      settings = await db.prepare(
        "SELECT sender_name, sender_email, reply_to FROM newsletter_settings WHERE org_id = ? LIMIT 1"
      ).bind(id).first();
    } catch {
      settings = null;
    }
  }

  let primaryDomain = null;
  if (db?.prepare) {
    try {
      const domains = await listPublicSiteDomains(db, publicDomainScope(id, "organization"));
      primaryDomain =
        domains.find((domain) => domain.isPrimary && domain.verificationStatus === "verified") ||
        domains.find((domain) => domain.verificationStatus === "verified") ||
        null;
    } catch {
      primaryDomain = null;
    }
  }

  let requestOrigin = "";
  try {
    requestOrigin = new URL(requestUrl).origin;
  } catch {
    requestOrigin = "";
  }

  const name = String(
    settings?.sender_name ||
    cfg?.title ||
    cfg?.branch_label ||
    "Bondfire organization"
  ).trim().slice(0, 160);

  const senderEmail =
    validSenderEmail(settings?.sender_email) ||
    (primaryDomain?.hostname ? `newsletter@${primaryDomain.hostname}` : "");

  let from = senderEmail ? `${name} <${senderEmail}>` : "";
  if (!from) {
    from = configuredFromAddress(env?.NEWSLETTER_FROM || env?.RESEND_FROM, name);
  }
  if (!from) {
    const error = new Error("NEWSLETTER_FROM_NOT_CONFIGURED");
    error.code = "NEWSLETTER_FROM_NOT_CONFIGURED";
    throw error;
  }

  const publicOrigin = primaryDomain?.hostname
    ? `https://${primaryDomain.hostname}`
    : requestOrigin;

  let signupOrigin = primaryDomain?.hostname || "";
  if (!signupOrigin && publicOrigin) {
    try {
      signupOrigin = new URL(publicOrigin).hostname;
    } catch {
      signupOrigin = "";
    }
  }
  if (!signupOrigin) signupOrigin = String(cfg?.slug || "this organization").trim();

  return {
    name,
    from,
    senderEmail,
    replyTo: validSenderEmail(settings?.reply_to),
    publicOrigin,
    signupOrigin,
  };
}

export async function newsletterRecipientHash(env, { orgId, email }) {
  const normalizedOrgId = String(orgId || "").trim();
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedOrgId || !normalizedEmail) return "";
  const key = await hmacKey(env);
  const data = "newsletter-recipient:v1:" + normalizedOrgId + ":" + normalizedEmail;
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return base64UrlEncode(digest);
}

export async function makeNewsletterSignupReceipt(env, { orgId, subscriberId }) {
  const payload = base64UrlEncode(
    encoder.encode(JSON.stringify({
      v: 1,
      orgId: String(orgId || "").trim(),
      subscriberId: String(subscriberId || "").trim(),
      issuedAt: Date.now(),
    }))
  );
  const key = await hmacKey(env);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return payload + "." + base64UrlEncode(signature);
}

export async function verifyNewsletterSignupReceipt(env, receipt, { maxAgeMs = 10 * 60 * 1000 } = {}) {
  const [payload, signature, extra] = String(receipt || "").split(".");
  if (!payload || !signature || extra) return null;

  try {
    const key = await hmacKey(env);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlDecode(signature),
      encoder.encode(payload)
    );
    if (!valid) return null;

    const data = JSON.parse(decoder.decode(base64UrlDecode(payload)));
    if (Number(data?.v) !== 1) return null;

    const orgId = String(data?.orgId || "").trim();
    const subscriberId = String(data?.subscriberId || "").trim();
    const issuedAt = Number(data?.issuedAt || 0);
    if (!orgId || !subscriberId || !Number.isFinite(issuedAt)) return null;
    if (issuedAt > Date.now() + 60 * 1000) return null;
    if (Date.now() - issuedAt > maxAgeMs) return null;

    return { orgId, subscriberId, issuedAt };
  } catch {
    return null;
  }
}

export function renderNewsletterConfirmation({ identity, name, unsubscribeUrl }) {
  const orgName = String(identity?.name || "Organization").trim();
  const greetingName = String(name || "").trim();
  const greeting = greetingName ? `Hi ${greetingName},` : "Hello,";
  const text = [
    greeting,
    "",
    `You're subscribed to ${orgName} updates.`,
    "",
    "We'll send organization updates to this address.",
    "",
    "If you did not sign up, you can unsubscribe here:",
    unsubscribeUrl,
  ].join("\n");

  const html = `<div style="font-family:system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;line-height:1.65;color:#171717;max-width:680px;margin:0 auto">
    <p>${htmlEscape(greeting)}</p>
    <p>You're subscribed to <strong>${htmlEscape(orgName)}</strong> updates.</p>
    <p>We'll send organization updates to this address.</p>
    <hr style="margin:32px 0 18px;border:0;border-top:1px solid #ddd">
    <p style="font-size:12px;line-height:1.5;color:#666">If you did not sign up, <a href="${htmlEscape(unsubscribeUrl)}">unsubscribe here</a>.</p>
  </div>`;

  return { text, html };
}

export async function makeNewsletterUnsubscribeToken(env, { orgId, subscriberId, emailHash }) {
  const payload = base64UrlEncode(
    encoder.encode(JSON.stringify({
      v: 1,
      orgId: String(orgId || "").trim(),
      subscriberId: String(subscriberId || "").trim(),
      emailHash: String(emailHash || "").trim(),
    }))
  );
  const key = await hmacKey(env);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return payload + "." + base64UrlEncode(signature);
}

export async function verifyNewsletterUnsubscribeToken(env, token) {
  const [payload, signature, extra] = String(token || "").split(".");
  if (!payload || !signature || extra) return null;

  try {
    const key = await hmacKey(env);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlDecode(signature),
      encoder.encode(payload)
    );
    if (!valid) return null;

    const data = JSON.parse(decoder.decode(base64UrlDecode(payload)));
    if (Number(data?.v) !== 1) return null;
    const orgId = String(data?.orgId || "").trim();
    const subscriberId = String(data?.subscriberId || "").trim();
    const emailHash = String(data?.emailHash || "").trim();
    if (!orgId || !subscriberId || !/^[A-Za-z0-9_-]{40,}$/.test(emailHash)) return null;
    return { orgId, subscriberId, emailHash };
  } catch {
    return null;
  }
}

export function newsletterUnsubscribeUrl(identity, token) {
  const base = String(identity?.publicOrigin || "").replace(/\/+$/, "");
  return base + "/api/public/newsletter-unsubscribe?token=" + encodeURIComponent(token);
}

export function renderNewsletterMessage({ identity, body, unsubscribeUrl }) {
  const textBody = String(body || "").trim();
  const name = String(identity?.name || "Organization").trim();
  const signupOrigin = String(identity?.signupOrigin || "the organization website").trim();

  const footerText = [
    "",
    "---",
    "You are receiving this because you signed up for " + name + " updates at " + signupOrigin + ".",
    "Unsubscribe: " + unsubscribeUrl,
  ].join("\n");

  const htmlBody = htmlEscape(textBody).replace(/\r?\n/g, "<br>");
  const html = `<div style="font-family:system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;line-height:1.65;color:#171717;max-width:680px;margin:0 auto">
    <div>${htmlBody}</div>
    <hr style="margin:32px 0 18px;border:0;border-top:1px solid #ddd">
    <div style="font-size:12px;line-height:1.5;color:#666">
      <p>You are receiving this because you signed up for ${htmlEscape(name)} updates at ${htmlEscape(signupOrigin)}.</p>
      <p><a href="${htmlEscape(unsubscribeUrl)}">Unsubscribe from these emails</a></p>
    </div>
  </div>`;

  return {
    text: textBody + footerText,
    html,
  };
}

export async function sendNewsletterEmail(env, { from, to, subject, text, html, unsubscribeUrl, idempotencyKey }) {
  const key = String(env?.RESEND_API_KEY || "").trim();
  if (!key) {
    const error = new Error("RESEND_NOT_CONFIGURED");
    error.code = "RESEND_NOT_CONFIGURED";
    throw error;
  }

  const sender = String(from || "").trim();
  const recipient = String(to || "").trim();
  if (!sender) {
    const error = new Error("NEWSLETTER_FROM_NOT_CONFIGURED");
    error.code = "NEWSLETTER_FROM_NOT_CONFIGURED";
    throw error;
  }
  if (!recipient) {
    const error = new Error("NEWSLETTER_TO_REQUIRED");
    error.code = "NEWSLETTER_TO_REQUIRED";
    throw error;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": String(idempotencyKey).slice(0, 256) } : {}),
    },
    body: JSON.stringify({
      from: sender,
      to: [recipient],
      subject: String(subject || "").trim(),
      text: String(text || ""),
      html: String(html || ""),
      ...(unsubscribeUrl ? {
        headers: {
          "List-Unsubscribe": "<" + String(unsubscribeUrl) + ">",
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      } : {}),
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = String(
      data?.name ||
      data?.message ||
      data?.error?.message ||
      ("RESEND_HTTP_" + response.status)
    ).slice(0, 300);
    const error = new Error(code);
    error.code = code;
    error.status = response.status;
    throw error;
  }

  return { id: String(data?.id || data?.data?.id || "") };
}

export async function sendNewsletterBatch(env, { from, messages, idempotencyKey }) {
  const key = String(env?.RESEND_API_KEY || "").trim();
  if (!key) {
    const error = new Error("RESEND_NOT_CONFIGURED");
    error.code = "RESEND_NOT_CONFIGURED";
    throw error;
  }

  const list = Array.isArray(messages) ? messages.filter(Boolean) : [];
  if (!list.length) return { ids: [] };
  if (list.length > 100) {
    const error = new Error("NEWSLETTER_BATCH_TOO_LARGE");
    error.code = "NEWSLETTER_BATCH_TOO_LARGE";
    throw error;
  }

  const sender = String(from || "").trim();
  if (!sender) {
    const error = new Error("NEWSLETTER_FROM_NOT_CONFIGURED");
    error.code = "NEWSLETTER_FROM_NOT_CONFIGURED";
    throw error;
  }

  const response = await fetch("https://api.resend.com/emails/batch", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": String(idempotencyKey).slice(0, 256) } : {}),
    },
    body: JSON.stringify(list.map((message) => ({
      from: sender,
      to: [String(message?.to || "").trim()],
      subject: String(message?.subject || "").trim(),
      text: String(message?.text || ""),
      html: String(message?.html || ""),
      ...(message?.unsubscribeUrl ? {
        headers: {
          "List-Unsubscribe": "<" + String(message.unsubscribeUrl) + ">",
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      } : {}),
    }))),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = String(data?.name || data?.message || ("RESEND_HTTP_" + response.status)).slice(0, 300);
    const error = new Error(code);
    error.code = code;
    throw error;
  }

  const rows = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
  return { ids: rows.map((row) => String(row?.id || "")).filter(Boolean) };
}
