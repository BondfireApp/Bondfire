import { getDB } from "../_bf.js";

function cleanText(value, max = 160) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
}

export function validNewsletterSenderEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!email) return "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export async function ensureNewsletterDeliveryTable(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS newsletter_delivery_settings (
      org_id TEXT PRIMARY KEY,
      sender_name TEXT,
      sender_email TEXT,
      reply_to TEXT,
      updated_at INTEGER NOT NULL DEFAULT 0
    )
  `).run();
}

export async function readNewsletterDeliverySettings(env, orgId) {
  const db = getDB(env);
  if (!db) return null;
  await ensureNewsletterDeliveryTable(db);
  const row = await db.prepare(
    "SELECT sender_name, sender_email, reply_to, updated_at FROM newsletter_delivery_settings WHERE org_id = ? LIMIT 1"
  ).bind(String(orgId || "").trim()).first();

  return {
    sender_name: String(row?.sender_name || ""),
    sender_email: String(row?.sender_email || ""),
    reply_to: String(row?.reply_to || ""),
    updated_at: Number(row?.updated_at || 0),
  };
}

export async function writeNewsletterDeliverySettings(env, orgId, input = {}) {
  const db = getDB(env);
  if (!db) {
    const error = new Error("DB_NOT_CONFIGURED");
    error.code = "DB_NOT_CONFIGURED";
    throw error;
  }

  const senderName = cleanText(input?.sender_name, 160);
  const senderEmail = validNewsletterSenderEmail(input?.sender_email);
  const replyTo = validNewsletterSenderEmail(input?.reply_to);
  if (senderEmail === null) {
    const error = new Error("INVALID_NEWSLETTER_SENDER_EMAIL");
    error.code = "INVALID_NEWSLETTER_SENDER_EMAIL";
    throw error;
  }
  if (replyTo === null) {
    const error = new Error("INVALID_NEWSLETTER_REPLY_TO");
    error.code = "INVALID_NEWSLETTER_REPLY_TO";
    throw error;
  }

  await ensureNewsletterDeliveryTable(db);
  const updatedAt = Date.now();
  await db.prepare(`
    INSERT INTO newsletter_delivery_settings
      (org_id, sender_name, sender_email, reply_to, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(org_id) DO UPDATE SET
      sender_name = excluded.sender_name,
      sender_email = excluded.sender_email,
      reply_to = excluded.reply_to,
      updated_at = excluded.updated_at
  `).bind(
    String(orgId || "").trim(),
    senderName,
    senderEmail || "",
    replyTo || "",
    updatedAt
  ).run();

  return {
    sender_name: senderName,
    sender_email: senderEmail || "",
    reply_to: replyTo || "",
    updated_at: updatedAt,
  };
}
