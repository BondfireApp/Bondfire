import { ok, err } from "../../_lib/http.js";
import { requireOrgRole, getUserIdFromRequest } from "../../_lib/auth.js";
import { getDB } from "../../_bf.js";
import { newsletterIdentity } from "../../_lib/newsletterEmail.js";

function validEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!email) return "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

async function ensureNewsletterSettingsTable(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS newsletter_settings (
      org_id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 0,
      list_address TEXT,
      blurb TEXT,
      sender_name TEXT,
      sender_email TEXT,
      reply_to TEXT,
      updated_at INTEGER NOT NULL DEFAULT 0
    )
  `).run();

  const info = await db.prepare("PRAGMA table_info(newsletter_settings)").all();
  const columns = new Set((info?.results || []).map((row) => String(row?.name || "").toLowerCase()));
  for (const [name, type] of [
    ["sender_name", "TEXT"],
    ["sender_email", "TEXT"],
    ["reply_to", "TEXT"],
  ]) {
    if (columns.has(name)) continue;
    try {
      await db.prepare(`ALTER TABLE newsletter_settings ADD COLUMN ${name} ${type}`).run();
    } catch {
      // Another request may have completed the migration first.
    }
  }
}

export async function onRequest(ctx) {
  const { params, env, request } = ctx;

  const db = getDB(env);
  if (!db) return err(500, "DB_NOT_CONFIGURED");

  const orgId = String(params?.orgId || "").trim();
  if (!orgId) return err(400, "BAD_ORG_ID");

  const method = (request.method || "GET").toUpperCase();
  await ensureNewsletterSettingsTable(db);

  if (method === "GET") {
    const auth = await requireOrgRole({ env, request, orgId, minRole: "member" });
    if (!auth.ok) return auth.resp;

    const row = await db.prepare(
      "SELECT enabled, list_address, blurb, sender_name, sender_email, reply_to FROM newsletter_settings WHERE org_id = ? LIMIT 1"
    ).bind(orgId).first();

    let identity = null;
    try {
      identity = await newsletterIdentity(env, orgId, request.url);
    } catch {
      identity = null;
    }

    return ok({
      newsletter: {
        enabled: !!(row?.enabled ?? 0),
        list_address: row?.list_address || "",
        blurb: row?.blurb || "",
        sender_name: row?.sender_name || "",
        sender_email: row?.sender_email || "",
        reply_to: row?.reply_to || "",
        delivery: "resend",
        resend_configured: !!String(env?.RESEND_API_KEY || "").trim(),
        effective_from: identity?.from || "",
        effective_sender_email: identity?.senderEmail || "",
      },
    });
  }

  if (method === "PUT") {
    const auth = await requireOrgRole({ env, request, orgId, minRole: "admin" });
    if (!auth.ok) return auth.resp;

    const body = await request.json().catch(() => ({}));
    const enabled = !!body.enabled;
    const listAddress = String(body.list_address || "").trim().slice(0, 320);
    const blurb = String(body.blurb || "").trim().slice(0, 5000);
    const senderName = String(body.sender_name || "").trim().slice(0, 160);
    const senderEmail = validEmail(body.sender_email);
    const replyTo = validEmail(body.reply_to);
    if (senderEmail === null) return err(400, "INVALID_NEWSLETTER_SENDER_EMAIL");
    if (replyTo === null) return err(400, "INVALID_NEWSLETTER_REPLY_TO");

    const updatedAt = Date.now();
    const updatedBy = getUserIdFromRequest(request) || "";

    await db.prepare(
      `INSERT INTO newsletter_settings
        (org_id, enabled, list_address, blurb, sender_name, sender_email, reply_to, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(org_id) DO UPDATE SET
         enabled = excluded.enabled,
         list_address = excluded.list_address,
         blurb = excluded.blurb,
         sender_name = excluded.sender_name,
         sender_email = excluded.sender_email,
         reply_to = excluded.reply_to,
         updated_at = excluded.updated_at`
    ).bind(
      orgId,
      enabled ? 1 : 0,
      listAddress,
      blurb,
      senderName,
      senderEmail || "",
      replyTo || "",
      updatedAt
    ).run();

    let identity = null;
    try {
      identity = await newsletterIdentity(env, orgId, request.url);
    } catch {
      identity = null;
    }

    return ok({
      newsletter: {
        enabled,
        list_address: listAddress,
        blurb,
        sender_name: senderName,
        sender_email: senderEmail || "",
        reply_to: replyTo || "",
        delivery: "resend",
        resend_configured: !!String(env?.RESEND_API_KEY || "").trim(),
        effective_from: identity?.from || "",
        effective_sender_email: identity?.senderEmail || "",
      },
      updated_by: updatedBy,
    });
  }

  return err(405, "METHOD_NOT_ALLOWED");
}
