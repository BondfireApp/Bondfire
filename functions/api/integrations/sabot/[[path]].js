import { requireOrgRole, requireUser } from '../../_lib/auth.js'
import { cookieString, getCookie, json } from '../../_lib/http.js'
import { cookieHeadersForAuth, ensureRefreshSchema, issueAccessToken, randomToken, sha256Hex } from '../../_lib/session.js'

const SABOT_ORIGIN = 'https://sabot.media'
const BONDFIRE_ORIGIN = 'https://bondfireapp.org'
const SABOT_ORG_ID = '397ffb25-cf4a-4fa2-b364-e506764a20c4'
const CODE_TTL_MS = 90 * 1000

export async function onRequest(context) {
  const route = Array.isArray(context.params?.path)
    ? context.params.path.join('/')
    : String(context.params?.path || '').replace(/^\/+|\/+$/g, '')

  if (route === 'start' && context.request.method === 'GET') return start(context)
  if (route === 'redeem' && context.request.method === 'POST') return redeem(context)
  if (route === 'consume' && context.request.method === 'GET') return consume(context)
  return json({ ok: false, error: 'NOT_FOUND' }, 404)
}

async function start({ env, request }) {
  if (!sameSiteNavigation(request)) return json({ ok: false, error: 'SAME_SITE_REQUIRED' }, 403)
  const gate = await requireOrgRole({ env, request, orgId: SABOT_ORG_ID, minRole: 'viewer' })
  if (!gate.ok) return gate.resp

  const db = env?.BF_DB
  if (!db) return json({ ok: false, error: 'BF_DB_MISSING' }, 503)
  await ensureSchema(db)

  const user = await db.prepare('SELECT id, email, name FROM users WHERE id = ? LIMIT 1').bind(String(gate.user.sub)).first()
  if (!user?.id || !user?.email) return json({ ok: false, error: 'BONDFIRE_USER_REQUIRED' }, 403)

  const returnTo = safeSabotPath(getCookie(request, 'bf_sabot_return'), '/wp-admin')
  const code = randomCode()
  const codeHash = await sha256Hex(code)
  const now = Date.now()
  await prune(db, now)

  await db.prepare(`
    INSERT INTO bondfire_sabot_sso_codes
      (code_hash, subject, email, display_name, role, return_to, expires_at, consumed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
  `).bind(
    codeHash,
    String(user.id),
    String(user.email).toLowerCase(),
    String(user.name || ''),
    String(gate.role || ''),
    returnTo,
    now + CODE_TTL_MS,
  ).run()

  const target = new URL('/api/bondfire-sso/consume', SABOT_ORIGIN)
  target.searchParams.set('code', code)
  return redirect(target.toString())
}

async function redeem({ env, request }) {
  const db = env?.BF_DB
  if (!db) return json({ ok: false, error: 'BF_DB_MISSING' }, 503)
  await ensureSchema(db)

  const body = await request.json().catch(() => ({}))
  const code = String(body?.code || '').trim()
  if (!code) return json({ ok: false, error: 'CODE_REQUIRED' }, 400)

  const row = await consumeCode(db, code)
  if (!row) return json({ ok: false, error: 'INVALID_OR_EXPIRED_CODE' }, 401)

  return noStoreJson({
    ok: true,
    subject: String(row.subject || ''),
    email: String(row.email || '').toLowerCase(),
    displayName: String(row.display_name || ''),
    orgRole: String(row.role || ''),
    returnTo: safeSabotPath(row.return_to, '/wp-admin'),
    orgId: SABOT_ORG_ID,
    issuer: BONDFIRE_ORIGIN,
  })
}

async function consume({ env, request }) {
  const db = env?.BF_DB
  if (!db) return errorPage('Bondfire sign-in unavailable', 'Bondfire storage is unavailable.', 503)
  await ensureSchema(db)

  const requestUrl = new URL(request.url)
  const code = String(requestUrl.searchParams.get('code') || '').trim()
  if (!code) return errorPage('Sabot link expired', 'No one-time sign-in code was supplied.', 400)

  let handoff
  try {
    const response = await fetch(`${SABOT_ORIGIN}/api/bondfire-sso/redeem`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ code }),
    })
    handoff = await response.json().catch(() => null)
    if (!response.ok || !handoff?.ok) {
      return errorPage('Sabot link expired', 'The one-time Sabot sign-in could not be verified. Open Bondfire from Sabot again.', 401)
    }
  } catch {
    return errorPage('Sabot unavailable', 'Bondfire could not verify the Sabot editor session.', 502)
  }

  if (String(handoff.orgId || '') !== SABOT_ORG_ID || !handoff.subject) {
    return errorPage('Sabot link rejected', 'The handoff was not issued for the Sabot Media workspace.', 403)
  }

  let user = null
  const linked = await db.prepare('SELECT bondfire_user_id FROM bondfire_sabot_identity_links WHERE sabot_user_id = ? LIMIT 1')
    .bind(String(handoff.subject)).first()
  if (linked?.bondfire_user_id) {
    user = await db.prepare('SELECT id, email, name FROM users WHERE id = ? LIMIT 1').bind(String(linked.bondfire_user_id)).first()
  }

  if (!user && handoff.email) {
    user = await db.prepare('SELECT id, email, name FROM users WHERE lower(email) = ? LIMIT 1')
      .bind(String(handoff.email).toLowerCase()).first()
  }

  if (!user) {
    const current = await requireUser({ env, request })
    if (current.ok && current.user?.sub) {
      user = await db.prepare('SELECT id, email, name FROM users WHERE id = ? LIMIT 1').bind(String(current.user.sub)).first()
    }
  }

  if (!user?.id) {
    return errorPage(
      'Bondfire account not linked',
      'Sign in to Bondfire once with the account that belongs to the Sabot Media organization, then open Bondfire from Sabot again.',
      403,
    )
  }

  const membership = await db.prepare('SELECT role FROM org_memberships WHERE org_id = ? AND user_id = ? LIMIT 1')
    .bind(SABOT_ORG_ID, String(user.id)).first()
  if (!membership?.role) {
    return errorPage('Bondfire access denied', 'This Bondfire account is not a member of the Sabot Media organization.', 403)
  }

  await db.prepare(`
    INSERT INTO bondfire_sabot_identity_links (sabot_user_id, bondfire_user_id, created_at)
    VALUES (?, ?, ?)
    ON CONFLICT(sabot_user_id) DO UPDATE SET bondfire_user_id = excluded.bondfire_user_id
  `).bind(String(handoff.subject), String(user.id), Date.now()).run()

  await ensureRefreshSchema(db)
  const oldRefresh = getCookie(request, 'bf_rt')
  if (oldRefresh) {
    try {
      const oldHash = await sha256Hex(oldRefresh)
      await db.prepare('DELETE FROM refresh_tokens WHERE token_hash = ?').bind(oldHash).run()
    } catch {}
  }

  const accessToken = await issueAccessToken(env, user, 60 * 15)
  const refreshToken = randomToken(32)
  const refreshHash = await sha256Hex(refreshToken)
  const refreshExpires = Date.now() + 1000 * 60 * 60 * 24 * 30
  await db.prepare(
    'INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), String(user.id), refreshHash, refreshExpires).run()

  const isProd = String(env?.ENV || env?.NODE_ENV || '').toLowerCase() === 'production'
  const headers = new Headers()
  for (const value of cookieHeadersForAuth({ accessToken, refreshToken, isProd })) headers.append('set-cookie', value)
  headers.append('set-cookie', cookieString('bf_sabot_return', safeSabotPath(handoff.returnTo, '/wp-admin'), {
    httpOnly: true,
    secure: isProd,
    sameSite: 'Lax',
    path: '/',
    maxAge: 60 * 60 * 12,
  }))

  return redirect(`${BONDFIRE_ORIGIN}/#/org/${encodeURIComponent(SABOT_ORG_ID)}/overview`, headers)
}

async function ensureSchema(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS bondfire_sabot_sso_codes (
      code_hash TEXT PRIMARY KEY,
      subject TEXT NOT NULL,
      email TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT '',
      return_to TEXT NOT NULL DEFAULT '/wp-admin',
      expires_at INTEGER NOT NULL,
      consumed_at INTEGER
    )
  `).run()
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS bondfire_sabot_identity_links (
      sabot_user_id TEXT PRIMARY KEY,
      bondfire_user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `).run()
}

async function consumeCode(db, code) {
  const codeHash = await sha256Hex(code)
  const now = Date.now()
  const updated = await db.prepare(`
    UPDATE bondfire_sabot_sso_codes
    SET consumed_at = ?
    WHERE code_hash = ? AND consumed_at IS NULL AND expires_at >= ?
  `).bind(now, codeHash, now).run()
  if (Number(updated?.meta?.changes || 0) !== 1) return null
  return db.prepare('SELECT * FROM bondfire_sabot_sso_codes WHERE code_hash = ? LIMIT 1').bind(codeHash).first()
}

async function prune(db, now) {
  await db.prepare('DELETE FROM bondfire_sabot_sso_codes WHERE expires_at < ? OR (consumed_at IS NOT NULL AND consumed_at < ?)')
    .bind(now - 60_000, now - 10 * 60_000).run()
}

function sameSiteNavigation(request) {
  const site = String(request.headers.get('sec-fetch-site') || '').toLowerCase()
  return !site || site === 'same-origin' || site === 'same-site' || site === 'none'
}

function safeSabotPath(value, fallback = '/wp-admin') {
  const candidate = String(value || '').trim()
  if (!candidate.startsWith('/') || candidate.startsWith('//')) return fallback
  if (/^\/api(?:\/|$)/i.test(candidate)) return fallback
  return candidate.slice(0, 2048)
}

function randomCode() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function redirect(location, headersInput = {}) {
  const headers = headersInput instanceof Headers ? new Headers(headersInput) : new Headers(headersInput)
  headers.set('location', location)
  headers.set('cache-control', 'no-store')
  headers.set('referrer-policy', 'no-referrer')
  return new Response(null, { status: 302, headers })
}

function noStoreJson(data, status = 200) {
  return json(data, {
    status,
    headers: {
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    },
  })
}

function errorPage(title, message, status = 400) {
  const body = `<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>${escapeHtml(title)}</title><main style="font:16px/1.5 system-ui;max-width:680px;margin:10vh auto;padding:24px"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><p><a href="/#/org/${encodeURIComponent(SABOT_ORG_ID)}/overview">Return to Sabot Media in Bondfire</a></p></main>`
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    },
  })
}

function escapeHtml(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
