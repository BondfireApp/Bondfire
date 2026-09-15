export function normalizeSiteSlug(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

import { readPublicSiteConfig, writePublicSiteConfig } from './publicSiteConfig.js'

const HOSTNAME_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))+$/i
const STATUS_VALUES = new Set(['pending', 'verified'])

export async function ensurePublicSiteDomainsTable(db) {
  await db
    .prepare(`
      CREATE TABLE IF NOT EXISTS public_site_domains (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope TEXT NOT NULL,
        hostname TEXT NOT NULL,
        verification_status TEXT NOT NULL DEFAULT 'pending',
        verification_token TEXT NOT NULL DEFAULT '',
        is_primary INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        verified_at TEXT,
        UNIQUE(scope, hostname)
      );
    `)
    .run()

  await db
    .prepare(`
      CREATE INDEX IF NOT EXISTS idx_public_site_domains_scope
      ON public_site_domains(scope);
    `)
    .run()

  await db
    .prepare(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_public_site_domains_primary_per_scope
      ON public_site_domains(scope)
      WHERE is_primary = 1;
    `)
    .run()

}

export async function listPublicSiteDomains(db, scope = 'global') {
  await ensurePublicSiteDomainsTable(db)

  const rows = await db
    .prepare(`
      SELECT id, scope, hostname, verification_status, verification_token, is_primary, created_at, updated_at, verified_at
      FROM public_site_domains
      WHERE scope = ?
      ORDER BY is_primary DESC, hostname ASC
    `)
    .bind(scope)
    .all()

  return (rows?.results || []).map(mapDomainRow)
}

export async function getPublicSiteDomainState(db, scope = 'global', requestHost = '') {
  await ensurePublicSiteDomainsTable(db)
  const siteConfig = await readPublicSiteConfig(db, scope)
  const siteSlug = siteConfig?.config?.site?.slug || 'main'
  const domains = await listPublicSiteDomains(db, scope)
  const resolvedDomain = resolveMappedDomain(domains, requestHost)

  return {
    scope,
    siteSlug,
    slugPath: `/p/${siteSlug}`,
    domains,
    resolvedDomain,
  }
}

export async function updatePublicSiteDomainState(db, input, scope = 'global') {
  await ensurePublicSiteDomainsTable(db)

  const siteConfig = await readPublicSiteConfig(db, scope)
  const nextSlug = normalizeSiteSlug(input?.siteSlug || siteConfig?.config?.site?.slug || 'main') || 'main'
  const mergedConfig = {
    ...siteConfig.config,
    site: {
      ...(siteConfig.config?.site || {}),
      slug: nextSlug,
    },
  }

  await writePublicSiteConfig(db, mergedConfig, scope)

  if (input?.newDomain) {
    await addPublicSiteDomain(db, input.newDomain, scope)
  }

  if (input?.removeHostname) {
    await removePublicSiteDomain(db, input.removeHostname, scope)
  }

  if (input?.setPrimaryHostname) {
    await setPrimaryPublicSiteDomain(db, input.setPrimaryHostname, scope)
  }

  if (input?.setVerifiedHostname) {
    await setPublicSiteDomainVerification(db, input.setVerifiedHostname, input?.verificationStatus || 'verified', scope)
  }

  return await getPublicSiteDomainState(db, scope)
}

export async function addPublicSiteDomain(db, rawInput, scope = 'global') {
  await ensurePublicSiteDomainsTable(db)

  const parsed = parseDomainInput(rawInput)
  if (!parsed.ok) {
    throw new Error(parsed.error)
  }

  const existing = await db
    .prepare(`
      SELECT id, scope, hostname, verification_status, verification_token, is_primary, created_at, updated_at, verified_at
      FROM public_site_domains
      WHERE scope = ? AND hostname = ?
      LIMIT 1
    `)
    .bind(scope, parsed.hostname)
    .first()

  if (existing) {
    return mapDomainRow(existing)
  }

  const token = createVerificationToken(parsed.hostname, scope)

  await db
    .prepare(`
      INSERT INTO public_site_domains (scope, hostname, verification_status, verification_token, is_primary)
      VALUES (?, ?, 'pending', ?, 0)
    `)
    .bind(scope, parsed.hostname, token)
    .run()

  let domains = await listPublicSiteDomains(db, scope)
  if (domains.length === 1) {
    await setPrimaryPublicSiteDomain(db, parsed.hostname, scope)
    domains = await listPublicSiteDomains(db, scope)
  }

  return domains.find((domain) => domain.hostname === parsed.hostname) || null
}

export async function removePublicSiteDomain(db, rawInput, scope = 'global') {
  await ensurePublicSiteDomainsTable(db)
  const parsed = parseDomainInput(rawInput)
  if (!parsed.ok) {
    throw new Error(parsed.error)
  }

  await db
    .prepare(`
      DELETE FROM public_site_domains
      WHERE scope = ? AND hostname = ?
    `)
    .bind(scope, parsed.hostname)
    .run()

  const domains = await listPublicSiteDomains(db, scope)
  if (domains.length && !domains.some((domain) => domain.isPrimary)) {
    await setPrimaryPublicSiteDomain(db, domains[0].hostname, scope)
  }
}

export async function setPrimaryPublicSiteDomain(db, rawInput, scope = 'global') {
  await ensurePublicSiteDomainsTable(db)
  const parsed = parseDomainInput(rawInput)
  if (!parsed.ok) {
    throw new Error(parsed.error)
  }

  await db
    .prepare(`
      UPDATE public_site_domains
      SET is_primary = CASE WHEN hostname = ? THEN 1 ELSE 0 END,
          updated_at = CURRENT_TIMESTAMP
      WHERE scope = ?
    `)
    .bind(parsed.hostname, scope)
    .run()
}

export async function setPublicSiteDomainVerification(db, rawInput, status = 'verified', scope = 'global') {
  await ensurePublicSiteDomainsTable(db)
  const parsed = parseDomainInput(rawInput)
  if (!parsed.ok) {
    throw new Error(parsed.error)
  }

  const normalizedStatus = STATUS_VALUES.has(String(status || '').trim().toLowerCase())
    ? String(status).trim().toLowerCase()
    : 'pending'

  await db
    .prepare(`
      UPDATE public_site_domains
      SET verification_status = ?,
          updated_at = CURRENT_TIMESTAMP,
          verified_at = CASE WHEN ? = 'verified' THEN CURRENT_TIMESTAMP ELSE NULL END
      WHERE scope = ? AND hostname = ?
    `)
    .bind(normalizedStatus, normalizedStatus, scope, parsed.hostname)
    .run()
}

export function resolveMappedDomain(domains, requestHost = '') {
  const normalizedHost = normalizeHostname(requestHost)
  if (!normalizedHost) return null
  return (domains || []).find((domain) => domain.hostname === normalizedHost) || null
}

export function parseDomainInput(rawInput) {
  const hostname = normalizeHostname(rawInput)
  if (!hostname) {
    return { ok: false, error: 'invalid hostname' }
  }

  if (!HOSTNAME_RE.test(hostname)) {
    return { ok: false, error: 'invalid hostname' }
  }

  return { ok: true, hostname }
}

export function normalizeHostname(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .replace(/^www\./, '')
}

function createVerificationToken(hostname, scope) {
  return `verify-${scope}-${hostname.replace(/[^a-z0-9]/g, '-')}-${Date.now()}`
}

function mapDomainRow(row) {
  return {
    id: Number(row.id),
    scope: row.scope,
    hostname: row.hostname,
    verificationStatus: row.verification_status || 'pending',
    verificationToken: row.verification_token || '',
    isPrimary: Number(row.is_primary || 0) === 1,
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
    verifiedAt: row.verified_at || '',
  }
}
