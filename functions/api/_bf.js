import { runAppMigrations } from './_lib/migrations.js'
export function getDB(env) {
  return env.DB || env.BF_DB || null;
}

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

export function text(body, status = 200, extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      ...extraHeaders,
    },
  });
}

export function bad(msg, code = 400) {
  return json({ ok: false, error: msg }, code);
}

export async function readJson(req) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

/*
  Auth strategy placeholder.

  If your project already attaches ctx.data.user in middleware, use that and delete this.
  Otherwise this tries to read a user id from a token.

  Expected token payload formats:
  - {"userId":"..."}
  - {"sub":"..."}
*/
export function getUserIdFromRequest(request) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : "";

  if (!token) return null;

  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;

    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.userId || payload.sub || null;
  } catch {
    return null;
  }
}

export async function requireMemberRole(db, orgId, userId, minRole) {
  if (!userId) return { ok: false, error: "UNAUTHENTICATED", status: 401 };

  // You likely already have this table. If your columns differ, edit this query.
  const row = await db
    .prepare(
      `SELECT role FROM org_members WHERE org_id = ? AND user_id = ? LIMIT 1`
    )
    .bind(orgId, userId)
    .first();

  if (!row?.role) return { ok: false, error: "NOT_A_MEMBER", status: 403 };

  const order = { viewer: 1, member: 2, admin: 3, owner: 4 };
  const have = order[String(row.role || "").toLowerCase()] || 0;
  const need = order[String(minRole || "").toLowerCase()] || 0;

  if (have < need) return { ok: false, error: "INSUFFICIENT_ROLE", status: 403 };

  return { ok: true, role: String(row.role || "").toLowerCase() };
}

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function csvEscape(v) {
  const s = String(v ?? "");
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}