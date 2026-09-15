function resolvePublicPath(pathname = '') {
  const direct = String(pathname || '').trim()
  if (direct) return direct

  if (typeof window === 'undefined') return ''

  const hashPath = String(window.location?.hash || '').replace(/^#/, '')
  if (hashPath) return hashPath

  return String(window.location?.pathname || '')
}

function normalizePublicSlug(value) {
  const slug = String(value || '').trim()
  return slug ? decodeURIComponent(slug) : ''
}

export function getPublicSiteSlug(pathname = '') {
  const path = resolvePublicPath(pathname)
  const match = path.match(/^\/(?:p|site)\/([^/]+)/)
  return match ? normalizePublicSlug(match[1]) : ''
}

export function getPublicSiteBasePath(pathname = '') {
  const slug = getPublicSiteSlug(pathname)
  return slug ? `/p/${encodeURIComponent(slug)}` : ''
}

export function usePublicSiteBasePath() {
  try {
    return getPublicSiteBasePath(resolvePublicPath())
  } catch {
    return ''
  }
}

export function buildPublicSitePath(basePath = '', path = '/') {
  const base = String(basePath || '').replace(/\/+$/, '')
  const next = String(path || '/')
  if (!base) return next.startsWith('/') ? next : `/${next}`
  if (next === '/' || next === '') return base || '/'
  return `${base}/${next.replace(/^\/+/, '')}`
}

export function isPublicSiteRoute(pathname = '') {
  const path = resolvePublicPath(pathname)
  return /^\/(?:p|site)\//.test(path)
}

export function buildPublicSitePreviewPath(slug = '') {
  const cleanSlug = normalizePublicSlug(slug)
  if (!cleanSlug) return ''
  return `/p/${encodeURIComponent(cleanSlug)}`
}

export function buildPublicSitePreviewUrl(slug = '', origin) {
  const path = buildPublicSitePreviewPath(slug)
  if (!path) return ''

  const baseOrigin = String(origin || (typeof window !== 'undefined' ? window.location.origin : '')).trim()
  if (!baseOrigin) return `/#${path}`

  try {
    const url = new URL(baseOrigin)
    const sanitizedPath = url.pathname.replace(/\/+$/, '')
    return `${url.origin}${sanitizedPath}/#${path}`.replace(/([^:]\/)\/+/g, '$1')
  } catch {
    return `${baseOrigin.replace(/\/+$/, '')}/#${path}`
  }
}
