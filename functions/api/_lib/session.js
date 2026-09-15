import { cookieString } from "./http.js";
import { signJwt, verifyJwt } from "./jwt.js";

export async function sha256Hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(str)));
  const b = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < b.length; i++) out += b[i].toString(16).padStart(2, "0");
  return out;
}

export async function ensureRefreshSchema(db) {
  // D1 is fine with IF NOT EXISTS.
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS refresh_tokens (\n" +
      "id TEXT PRIMARY KEY,\n" +
      "user_id TEXT NOT NULL,\n" +
      "token_hash TEXT NOT NULL,\n" +
      "expires_at INTEGER NOT NULL,\n" +
      "created_at INTEGER DEFAULT (strftime('%s','now')*1000)\n" +
    ")"
  ).run();
  await db.prepare(
    "CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id)"
  ).run();
  await db.prepare(
    "CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash)"
  ).run();
}

export function randomToken(bytes = 32) {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
}

export function cookieHeadersForAuth({ accessToken, refreshToken, isProd }) {
  const secure = !!isProd;
  const sameSite = "Lax";
  const headers = [];

  // Access token cookie: short-lived. HttpOnly so JS can't steal it.
  headers.push(cookieString("bf_at", accessToken, {
    httpOnly: true,
    secure,
    sameSite,
    path: "/",
    maxAge: 60 * 15, // 15 min
  }));

  // Refresh token cookie: httpOnly, scoped to auth endpoints.
  headers.push(cookieString("bf_rt", refreshToken, {
    httpOnly: true,
    secure,
    sameSite,
    path: "/api/auth",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  }));

  // CSRF token (double-submit). Not HttpOnly so the SPA can echo it.
  const csrf = randomToken(16);
  headers.push(cookieString("bf_csrf", csrf, {
    httpOnly: false,
    secure,
    sameSite,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  }));

  return headers;
}

export function clearAuthCookieHeaders({ isProd }) {
  const secure = !!isProd;
  const sameSite = "Lax";
  const headers = [];
  headers.push(cookieString("bf_at", "", {
    httpOnly: true,
    secure,
    sameSite,
    path: "/",
    maxAge: 0,
  }));
  headers.push(cookieString("bf_rt", "", {
    httpOnly: true,
    secure,
    sameSite,
    path: "/api/auth",
    maxAge: 0,
  }));
  headers.push(cookieString("bf_csrf", "", {
    httpOnly: false,
    secure,
    sameSite,
    path: "/",
    maxAge: 0,
  }));
  return headers;
}

export async function issueAccessToken(env, user, ttlSec = 60 * 15) {
  return signJwt(env.JWT_SECRET, { sub: user.id, email: user.email, name: user.name }, ttlSec);
}

export async function readAccessTokenFromCookie(env, request) {
  const cookie = request.headers.get("cookie") || "";
  const m = cookie.match(/(?:^|;\s*)bf_at=([^;]+)/);
  if (!m) return null;
  let tok = "";
  try { tok = decodeURIComponent(m[1]); } catch { tok = m[1]; }
  const payload = await verifyJwt(env.JWT_SECRET, tok);
  return payload || null;
}
