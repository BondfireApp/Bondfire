const RED_HARBOR_ORG_ID = "73bdf68b-d67a-4d70-8ae8-7c3bf9c934b0";
const RED_HARBOR_FROM = "Red Harbor IWW <newsletter@redharbor.org>";
const RED_HARBOR_ORIGIN = "https://redharbor.org";

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

export function newsletterIdentity(env, orgId, requestUrl = "") {
  const id = String(orgId || "").trim();
  if (id === RED_HARBOR_ORG_ID) {
    return {
      name: "Red Harbor IWW",
      from: RED_HARBOR_FROM,
      publicOrigin: RED_HARBOR_ORIGIN,
      signupOrigin: "redharbor.org",
    };
  }

  const from = String(env?.NEWSLETTER_FROM || env?.RESEND_FROM || "").trim();
  if (!from) {
    const error = new Error("NEWSLETTER_FROM_NOT_CONFIGURED");
    error.code = "NEWSLETTER_FROM_NOT_CONFIGURED";
    throw error;
  }

  let publicOrigin = "";
  try {
    publicOrigin = new URL(requestUrl).origin;
  } catch {
    publicOrigin = "";
  }

  return {
    name: "Bondfire organization",
    from,
    publicOrigin,
    signupOrigin: publicOrigin ? new URL(publicOrigin).hostname : "this organization",
  };
}

export async function makeNewsletterUnsubscribeToken(env, { orgId, subscriberId }) {
  const payload = base64UrlEncode(
    encoder.encode(JSON.stringify({
      v: 1,
      orgId: String(orgId || "").trim(),
      subscriberId: String(subscriberId || "").trim(),
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
    if (!orgId || !subscriberId) return null;
    return { orgId, subscriberId };
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
