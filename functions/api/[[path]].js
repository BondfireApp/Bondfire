import {
  onRequestGet as orgInvitesGet,
  onRequestPost as orgInvitesPost,
} from "./orgs/[orgId]/invites.js";
import { onRequestPost as redeemInvite } from "./invites/redeem.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
};

function withCors(resp) {
  const h = new Headers(resp.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) h.set(k, v);
  return new Response(resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers: h,
  });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS_HEADERS,
    },
  });
}

export async function onRequest(context) {
  const { request, params } = context;

  const segments = Array.isArray(params?.path)
    ? params.path
    : typeof params?.path === "string"
      ? params.path.split("/").filter(Boolean)
      : [];

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // =====================
  // Local invite routes
  // =====================

  // Route: /api/orgs/:orgId/invites  (GET, POST)
  if (segments.length === 3 && segments[0] === "orgs" && segments[2] === "invites") {
    const orgId = decodeURIComponent(segments[1] || "");
    const ctx2 = { ...context, params: { ...(context.params || {}), orgId } };

    if (request.method === "GET") return withCors(await orgInvitesGet(ctx2));
    if (request.method === "POST") return withCors(await orgInvitesPost(ctx2));

    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  // Route: /api/invites/redeem (POST)
  if (segments.length === 2 && segments[0] === "invites" && segments[1] === "redeem") {
    if (request.method === "POST") return withCors(await redeemInvite(context));
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  // =====================
  // No upstream proxy
  // =====================
  // This project uses Pages Functions on the same origin.
  // If a route isn't handled here, it should be handled by a real function file
  // (or it simply doesn't exist).
  return json(
    { ok: false, error: "Not found", path: "/" + segments.join("/") },
    404
  );
}
