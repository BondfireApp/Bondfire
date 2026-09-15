import { getPublicSiteDomainState, normalizeSiteSlug, updatePublicSiteDomainState } from './_lib/publicSiteDomains.js'
import { resolvePublicSitePermission } from './_lib/publicSiteAuth.js'
import { jsonOk, jsonError, parseJsonBody } from './_lib/api.js'
import { forbidden, badRequest } from './_lib/errors.js'

export async function onRequestOptions(context) {
  const permission = await resolvePublicSitePermission(context)
  const d1Status = getD1Status(context)

  return jsonOk({
    canEdit: permission.canEdit,
    authMode: permission.mode,
    authReason: permission.reason,
    mode: d1Status.bound ? 'd1' : 'scaffold',
    note: d1Status.bound
      ? 'D1-backed public site domain route available.'
      : d1Status.reason,
  })
}

export async function onRequestGet(context) {
  try {
    const permission = await resolvePublicSitePermission(context)

    const d1Status = getD1Status(context)
    if (!d1Status.bound) {
      return jsonOk({
        mode: 'scaffold',
        canEdit: permission.canEdit,
        authMode: permission.mode,
        authReason: permission.reason,
        note: d1Status.reason,
        state: {
          scope: 'global',
          siteSlug: 'main',
          slugPath: '/p/main',
          domains: [],
          resolvedDomain: null,
        },
      })
    }

    const requestHost = context.request.headers.get('x-forwarded-host') || context.request.headers.get('host') || ''
    const state = await getPublicSiteDomainState(context.env.BF_DB, 'global', requestHost)

    return jsonOk({
      mode: 'd1',
      canEdit: permission.canEdit,
      authMode: permission.mode,
      authReason: permission.reason,
      state,
    })
  } catch (error) {
    return jsonError(error)
  }
}

export async function onRequestPut(context) {
  try {
    const permission = await resolvePublicSitePermission(context)

    if (!permission.canEdit) {
      throw forbidden(permission.reason, {
        details: { canEdit: false, authMode: permission.mode },
      })
    }

    const body = await parseJsonBody(context.request)

    const d1Status = getD1Status(context)
    if (!d1Status.bound) {
      return jsonOk({
        mode: 'scaffold',
        saved: true,
        canEdit: true,
        authMode: permission.mode,
        authReason: permission.reason,
        state: {
          scope: 'global',
          siteSlug: normalizeSiteSlug(body?.siteSlug || 'main') || 'main',
          slugPath: `/p/${normalizeSiteSlug(body?.siteSlug || 'main') || 'main'}`,
          domains: [],
          resolvedDomain: null,
        },
        note: d1Status.reason,
      })
    }

    const state = await updatePublicSiteDomainState(context.env.BF_DB, body || {}, 'global')

    return jsonOk({
      mode: 'd1',
      saved: true,
      canEdit: true,
      authMode: permission.mode,
      authReason: permission.reason,
      state,
    })
  } catch (error) {
    const message = String(error?.message || '')
    if (message.toUpperCase().includes('JSON')) {
      return jsonError(badRequest('Invalid JSON payload'))
    }
    return jsonError(error, { status: 400 })
  }
}

function getD1Status(context) {
  const binding = context?.env?.BF_DB
  if (!binding) return { bound: false, reason: 'No BF_DB binding detected. Using scaffold mode.' }
  if (typeof binding.prepare === 'function' || typeof binding.exec === 'function') {
    return { bound: true, reason: '' }
  }
  return { bound: false, reason: 'BF_DB binding exists but does not expose D1 methods (prepare/exec).' }
}
