import { getPublicCfg } from '../_lib/publicPageStore.js'
import { getPublicSiteDomainByHostname, normalizeHostname, parsePublicDomainScope } from '../_lib/publicSiteDomains.js'
import { projectOrganizationPageConfig } from '../_lib/publicSurface.js'

export async function onRequestGet({ env, request }) {
  const db = env?.BF_DB
  if (!db || typeof db.prepare !== 'function') {
    return Response.json({ ok: true, mapped: false })
  }

  const host = normalizeHostname(
    request.headers.get('x-forwarded-host') || request.headers.get('host') || '',
  )
  if (!host) return Response.json({ ok: true, mapped: false })

  try {
    const domain = await getPublicSiteDomainByHostname(db, host)
    if (!domain || domain.verificationStatus !== 'verified') {
      return Response.json({ ok: true, mapped: false })
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
