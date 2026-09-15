export const PUBLIC_CONFIG_SCHEMA_VERSION = 3

const SITE_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function normalizePublicConfig(input) {
  const raw = input || {}

  return {
    version: PUBLIC_CONFIG_SCHEMA_VERSION,
    site: sanitizeSiteConfig(raw.site || {}),
    text: {},
    styles: {},
    blocks: {},
  }
}

export function sanitizeSiteConfig(input) {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const slug = normalizeSiteSlug(raw.slug)

  return {
    slug: slug || 'main',
  }
}

export function sanitizeTextMap() {
  return {}
}

export function sanitizeStyleMap() {
  return {}
}

export function sanitizeBlocks() {
  return {}
}

export function mergePublicConfig(base, patch) {
  const normalizedBase = normalizePublicConfig(base)
  const normalizedPatch = normalizePublicConfig(patch)

  return {
    version: PUBLIC_CONFIG_SCHEMA_VERSION,
    site: {
      ...normalizedBase.site,
      ...normalizedPatch.site,
    },
    text: {},
    styles: {},
    blocks: {},
  }
}

export function validatePublicConfig(input) {
  const raw = input || {}
  const errors = []
  const warnings = []

  if (raw.site && (typeof raw.site !== 'object' || Array.isArray(raw.site))) {
    errors.push('site must be an object')
  }

  if (raw.site?.slug && !normalizeSiteSlug(raw.site.slug)) {
    warnings.push(`invalid site slug skipped: ${raw.site.slug}`)
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    normalized: normalizePublicConfig(raw),
  }
}

export function isValidFieldKey() {
  return false
}

export function normalizeSiteSlug(value) {
  const str = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return SITE_SLUG_RE.test(str) ? str : ''
}
