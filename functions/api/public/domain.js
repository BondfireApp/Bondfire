import { getPublicCfg } from '../_lib/publicPageStore.js'
import { getPublicSiteDomainByHostname, normalizeHostname, parsePublicDomainScope, setPublicSiteDomainVerification } from '../_lib/publicSiteDomains.js'
import { projectOrganizationPageConfig } from '../_lib/publicSurface.js'

export async function onRequestGet({ env, request }) {
  const db = env?.BF_DB
  if (!db || typeof db.prepare !== 'function') {
    return Response.json({ ok: true, mapped: false })
  }

  const requestUrl = new URL(request.url)
  const host = normalizeHostname(requestUrl.hostname || request.headers.get('host') || '')
  if (!host) return Response.json({ ok: true, mapped: false })

  try {
    const domain = await getPublicSiteDomainByHostname(db, host)
    if (!domain) return Response.json({ ok: true, mapped: false })

    // Reaching this Function on the exact configured hostname proves the DNS/TLS
    // route is live. Heal stale local verification state that may have been
    // downgraded by optional provider introspection (for example SaaS quota).
    if (domain.verificationStatus !== 'verified') {
      await setPublicSiteDomainVerification(db, host, 'verified', domain.scope)
      domain.verificationStatus = 'verified'
    }

    const scope = parsePublicDomainScope(domain.scope)
    if (!scope.orgId || !scope.surface) {
      return Response.json({ ok: true, mapped: false })
    }

    if (scope.surface === 'organization') {
      const cfg = await getPublicCfg(env, scope.orgId)
      const projected = projectOrganizationPageConfig(cfg || {})
      if (!projected.enabled || !projected.slug) {
        return Response.json({ ok: true, mapped: false })
      }
      return Response.json({
        ok: true,
        mapped: true,
        surface: 'organization',
        orgId: scope.orgId,
        slug: projected.slug,
        path: `/p/${projected.slug}`,
      })
    }

    const cfg = await getPublicCfg(env, scope.orgId)
    const publication = projectOrganizationPageConfig(cfg || {})?.connected_publication || null
    return Response.json({
      ok: true,
      mapped: true,
      surface: 'publication',
      orgId: scope.orgId,
      publicationUrl: publication?.url || '',
    })
  } catch (error) {
    console.error('custom domain resolve failed', error)
    return Response.json({ ok: true, mapped: false })
  }
}
