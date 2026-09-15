import { unauthorized, forbidden } from './errors.js'
import { requireUser } from './auth.js'

export async function resolvePublicSitePermission(context) {
  const token = context?.env?.SABOT_ADMIN_TOKEN
  const openEdit = String(context?.env?.PUBLIC_CONFIG_OPEN_EDIT || '').toLowerCase() === 'true'

  const authHeader = context.request.headers.get('authorization') || ''
  const headerToken = context.request.headers.get('x-sabot-admin-token') || ''
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''

  if (token) {
    const canEdit = bearerToken === token || headerToken === token
    return {
      canEdit,
      mode: 'token',
      reason: canEdit ? 'token matched' : 'valid admin token required',
      hasConfiguredAuth: true,
      presentedAuth: Boolean(bearerToken || headerToken),
    }
  }

  if (openEdit) {
    return {
      canEdit: true,
      mode: 'open',
      reason: 'PUBLIC_CONFIG_OPEN_EDIT=true',
      hasConfiguredAuth: true,
      presentedAuth: true,
    }
  }

  const auth = await requireUser({ env: context?.env, request: context?.request })
  if (auth?.ok) {
    return {
      canEdit: true,
      mode: 'session',
      reason: 'authenticated user session',
      hasConfiguredAuth: true,
      presentedAuth: true,
    }
  }

  return {
    canEdit: false,
    mode: 'locked',
    reason: 'editing locked; set SABOT_ADMIN_TOKEN or PUBLIC_CONFIG_OPEN_EDIT=true',
    hasConfiguredAuth: false,
    presentedAuth: false,
  }
}

export async function requireCoreSession(context) {
  const permission = await resolvePublicSitePermission(context)

  if (permission.canEdit) {
    return permission
  }

  if (permission.mode === 'token') {
    throw unauthorized(permission.reason, {
      code: 'AUTH_REQUIRED',
      details: {
        authMode: permission.mode,
        canEdit: false,
        presentedAuth: permission.presentedAuth,
      },
    })
  }

  throw forbidden(permission.reason, {
    code: 'AUTH_FORBIDDEN',
    details: {
      authMode: permission.mode,
      canEdit: false,
      presentedAuth: permission.presentedAuth,
    },
  })
}
