import { bad } from "./http.js";
import { verifyJwt } from "./jwt.js";
import { enforceOrgIsolationAccess, enforceOrgWriteLockdown, isWriteMethod } from "./orgLockdown.js";

// Bindings can be named differently across environments.
// Try a few common ones so we don't explode into a Cloudflare 500 HTML page.
export function getDb(env) {
  return env?.BF_DB || env?.DB || env?.db || null;
}

export async function requireUser({ env, request }) {
  const h = request.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/);
  // Support both Bearer auth AND cookie sessions (httpOnly).
  // Never accept session credentials in a URL: query strings can leak through
  // browser history, referrers, request logs, analytics, and copied links.
  const cookieHeader = request.headers.get("cookie") || "";
  const cookies = {};
  for (const part of cookieHeader.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (!k) continue;
    cookies[k] = decodeURIComponent(rest.join("=") || "");
  }

  const token = (m && m[1]) || cookies.bf_at || cookies.bf_auth_token || cookies.bf_token || "";
  if (!token) return { ok: false, resp: bad(401, "UNAUTHORIZED") };

  const payload = await verifyJwt(env.JWT_SECRET, token);
  if (!payload) return { ok: false, resp: bad(401, "UNAUTHORIZED") };

  const db = getDb(env);
  if (!db) return { ok: false, resp: bad(503, "AUTH_STATE_UNAVAILABLE") };
  const account = await db.prepare("SELECT id FROM users WHERE id = ?").bind(payload.sub || '').first();
  if (!account) return { ok: false, resp: bad(401, "UNAUTHORIZED") };
  return { ok: true, user: payload };
}

export async function requireOrgRole({ env, request, orgId, minRole, bypassWriteLockdown = false }) {
  const u = await requireUser({ env, request });
  if (!u.ok) return u;

  const roleRank = { viewer: 1, member: 2, admin: 3, owner: 4 };
  const need = roleRank[minRole || "member"] || 2;

  const db = getDb(env);
  if (!db) return { ok: false, resp: bad(500, "NO_DB_BINDING") };

  const row = await db.prepare(
    "SELECT role FROM org_memberships WHERE org_id = ? AND user_id = ?"
  ).bind(orgId, u.user.sub).first();

  if (!row) return { ok: false, resp: bad(403, "NOT_A_MEMBER") };
  if ((roleRank[row.role] || 0) < need) return { ok: false, resp: bad(403, "INSUFFICIENT_ROLE") };

  if (String(row.role || '').toLowerCase() !== 'owner') {
    const isolation = await enforceOrgIsolationAccess({ env, orgId });
    if (!isolation.ok) return isolation;
  }

  if (!bypassWriteLockdown && isWriteMethod(request?.method)) {
    const lockdown = await enforceOrgWriteLockdown({ env, orgId });
    if (!lockdown.ok) return lockdown;
  }

  return { ok: true, user: u.user, role: row.role };
}

// Back-compat alias: earlier endpoints used `requireAuth`.
// Pages Functions bundling fails if an imported name is missing.
export async function requireAuth(arg1, arg2) {
  // Support both:
  //   requireAuth({ env, request })
  //   requireAuth(request, env)
  if (arg2 && arg1?.headers) {
    return requireUser({ request: arg1, env: arg2 });
  }
  return requireUser(arg1);
}

// Convenience helper used by some endpoints.
// Returns a user id string or null.
export async function getUserIdFromRequest(request, env) {
  const u = await requireUser({ env, request });
  if (!u.ok) return null;
  const id = u.user?.sub || u.user?.userId || u.user?.uid || null;
  return id ? String(id) : null;
}
