import { getDb, requireOrgRole } from '../../../_lib/auth.js'
import { bad, ok } from '../../../_lib/http.js'
import { getPublicCfg } from '../../../_lib/publicPageStore.js'
import {
  addPublicSiteDomain,
  listPublicSiteDomains,
  normalizePublicSurface,
  publicDomainScope,
  removePublicSiteDomain,
  setPrimaryPublicSiteDomain,
  setPublicSiteDomainVerification,
} from '../../../_lib/publicSiteDomains.js'
import {
  getCustomDomainProviderConfig,
  getManagedHostnameState,
  provisionManagedHostname,
  removeManagedHostname,
} from '../../../_lib/customDomainProvider.js'

function getSurface(request) {
  try {
    return normalizePublicSurface(new URL(request.url).searchParams.get('surface') || 'organization')
  } catch {
    return 'organization'
  }
}

async function syncDomainState(env, db, scope, domain) {
  let provider
  try {
    provider = await getManagedHostnameState(env, domain.hostname)
  } catch (error) {
    provider = {
      configured: true,
      provider: 'cloudflare-saas',
      found: false,
      active: false,
      status: 'error',
      sslStatus: 'error',
      errors: [String(error?.message || error)],
    }
  }

  const nextStatus = provider?.active ? 'verified' : provider?.status === 'error' ? 'error' : 'pending'
  if (nextStatus !== domain.verificationStatus) {
    await setPublicSiteDomainVerification(db, domain.hostname, nextStatus, scope)
  }

  return {
    ...domain,
    verificationStatus: nextStatus,
    provider,
  }
}

async function readState(env, db, orgId, surface) {
  const scope = publicDomainScope(orgId, surface)
  const localDomains = await listPublicSiteDomains(db, scope)
  const domains = await Promise.all(localDomains.map((domain) => syncDomainState(env, db, scope, domain)))
  const cfg = surface === 'organization' ? await getPublicCfg(env, orgId) : null
  const provider = getCustomDomainProviderConfig(env)

  return {
    orgId,
    surface,
    scope,
    siteSlug: surface === 'organization' ? String(cfg?.slug || '') : '',
    slugPath: surface === 'organization' && cfg?.slug ? `/p/${cfg.slug}` : '',
    provider: {
      name: provider.provider,
      configured: provider.configured,
      cnameTarget: provider.cnameTarget,
    },
    domains,
  }
}

export async function onRequestGet({ env, request, params }) {
  const orgId = String(params?.orgId || '').trim()
  if (!orgId) return bad(400, 'MISSING_ORG_ID')

  const auth = await requireOrgRole({ env, request, orgId, minRole: 'admin' })
  if (!auth.ok) return auth.resp

  const db = getDb(env)
  if (!db) return bad(500, 'NO_DB_BINDING')

  const surface = getSurface(request)
  try {
    return ok({ state: await readState(env, db, orgId, surface) })
  } catch (error) {
    return bad(500, 'DOMAIN_STATE_FAILED', { detail: String(error?.message || error) })
  }
}

export async function onRequestPut({ env, request, params }) {
  const orgId = String(params?.orgId || '').trim()
  if (!orgId) return bad(400, 'MISSING_ORG_ID')

  const auth = await requireOrgRole({ env, request, orgId, minRole: 'admin' })
  if (!auth.ok) return auth.resp

  const db = getDb(env)
  if (!db) return bad(500, 'NO_DB_BINDING')

  const surface = getSurface(request)
  const scope = publicDomainScope(orgId, surface)
  const body = await request.json().catch(() => ({}))

  try {
    if (body?.newDomain) {
      const domain = await addPublicSiteDomain(db, body.newDomain, scope)
      try {
        await provisionManagedHostname(env, domain.hostname)
      } catch (error) {
        if (error?.code !== 'CUSTOM_DOMAIN_PROVIDER_NOT_CONFIGURED') throw error
      }
    }

    if (body?.verifyHostname) {
      const provider = await getManagedHostnameState(env, body.verifyHostname)
      await setPublicSiteDomainVerification(
        db,
        body.verifyHostname,
        provider?.active ? 'verified' : provider?.status === 'error' ? 'error' : 'pending',
        scope,
      )
    }

    if (body?.setPrimaryHostname) {
      await setPrimaryPublicSiteDomain(db, body.setPrimaryHostname, scope)
    }

    if (body?.removeHostname) {
      await removeManagedHostname(env, body.removeHostname)
      await removePublicSiteDomain(db, body.removeHostname, scope)
    }

    return ok({ saved: true, state: await readState(env, db, orgId, surface) })
  } catch (error) {
    const code = String(error?.code || error?.message || 'DOMAIN_UPDATE_FAILED')
    const status = code === 'DOMAIN_IN_USE' ? 409 : 400
    return bad(status, code, { detail: String(error?.message || error) })
  }
}
