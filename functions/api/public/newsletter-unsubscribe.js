import { getDB } from "../_bf.js";
import { verifyNewsletterUnsubscribeToken } from "../_lib/newsletterEmail.js";
import { ensureSubmissions } from "../_lib/privateSubmissions.js";

const RED_HARBOR_ORG_ID = "73bdf68b-d67a-4d70-8ae8-7c3bf9c934b0";

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

function page({ title, body, homeUrl, homeLabel }) {
  return new Response(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;background:#f6f1e7;color:#1f1a17;font-family:system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif">
  <main style="max-width:680px;margin:0 auto;padding:64px 20px">
    <h1 style="font-size:32px;margin:0 0 16px">${escapeHtml(title)}</h1>
    <p style="font-size:18px;line-height:1.6">${escapeHtml(body)}</p>
    <p><a href="${escapeHtml(homeUrl)}" style="color:#8a1e1e">${escapeHtml(homeLabel)}</a></p>
  </main>
</body>
</html>`, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function unsubscribe({ env, request }) {
  const token = String(new URL(request.url).searchParams.get("token") || "").trim();
  const decoded = token ? await verifyNewsletterUnsubscribeToken(env, token) : null;

  if (!decoded) {
    return page({
      title: "Unsubscribe link is invalid",
      body: "No subscription was changed.",
      homeUrl: "/",
      homeLabel: "Return to the site",
    });
  }

  const db = getDB(env);
  if (!db) {
    return page({
      title: "Could not unsubscribe",
      body: "The subscription could not be changed right now. Please try the link again.",
      homeUrl: "/",
      homeLabel: "Return to the site",
    });
  }

  await ensureSubscriberTable(db);
  await ensureSubmissions(db);

  const { orgId, subscriberId } = decoded;
  const isRedHarbor = orgId === RED_HARBOR_ORG_ID;
  const homeUrl = isRedHarbor ? "https://redharbor.org/" : "/";
  const homeLabel = isRedHarbor ? "Return to Red Harbor" : "Return to the site";
  const orgName = isRedHarbor ? "Red Harbor" : "this organization";

  try {
    await db.batch([
      db.prepare("DELETE FROM newsletter_subscribers WHERE org_id = ? AND id = ?")
        .bind(orgId, subscriberId),
      db.prepare("DELETE FROM org_private_submissions WHERE org_id = ? AND id = ? AND type = 'newsletter'")
        .bind(orgId, subscriberId),
    ]);

    if (request.method === "POST") {
      return new Response(null, {
        status: 204,
        headers: { "cache-control": "no-store" },
      });
    }

    return page({
      title: "Unsubscribed",
      body: "You will no longer receive " + orgName + " newsletter emails.",
      homeUrl,
      homeLabel,
    });
  } catch (error) {
    console.error("NEWSLETTER_UNSUBSCRIBE_FAILED", error);
    return page({
      title: "Could not unsubscribe",
      body: "The subscription could not be changed right now. Please try the link again.",
      homeUrl,
      homeLabel,
    });
  }
}

export async function onRequestGet(context) {
  return unsubscribe(context);
}

export async function onRequestPost(context) {
  return unsubscribe(context);
}
