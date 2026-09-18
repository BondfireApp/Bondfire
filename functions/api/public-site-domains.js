import { bad, ok } from './_lib/http.js'

const MESSAGE = 'Custom domains are organization-scoped. Use /api/orgs/:orgId/public/domains.'

export async function onRequestOptions() {
  return ok({ deprecated: true, canEdit: false, message: MESSAGE })
}

export async function onRequestGet() {
  return bad(410, 'ORG_SCOPED_DOMAIN_API_REQUIRED', { message: MESSAGE })
}

export async function onRequestPut() {
  return bad(410, 'ORG_SCOPED_DOMAIN_API_REQUIRED', { message: MESSAGE })
}
