import { getPublicCfg } from '../_lib/publicPageStore.js';
import { projectOrganizationPageConfig } from '../_lib/publicSurface.js';
import { createColophonScopedEnv } from '../_lib/colophonScopedRuntime.js';
import { isOrgModuleEnabled } from '../_lib/orgModules.js';
import * as nativeContent from '../../../node_modules/colophon/functions/api/native-content.js';
import * as publicSiteConfig from '../../../node_modules/colophon/functions/api/public-site-config.js';
import { getPrivateMode } from '../_lib/privateStore.js';
import { readColophonPublication } from '../_lib/privateColophonPublication.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=60, stale-while-revalidate=300',
      'x-content-type-options': 'nosniff',
    },
  });
}

function cleanOrgId(value) {
  const id = String(value || '').trim();
  return /^[a-f0-9-]{36}$/i.test(id) ? id : '';
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const orgId = cleanOrgId(url.searchParams.get('org'));
  if (!orgId) return json({ ok: false, error: 'MISSING_ORG_ID' }, 400);

  try {
    if (!(await isOrgModuleEnabled(context.env, orgId, 'publishing-colophon'))) {
      return json({ ok: false, error: 'PUBLICATION_NOT_AVAILABLE' }, 404);
    }

    const privateMode = await getPrivateMode(context.env, orgId);
    if (privateMode?.state === 'enabled') {
      const published = await readColophonPublication(context.env, orgId, String(url.searchParams.get('slug') || '').trim());
      const cfg = published.config || {};
      const site = cfg.site && typeof cfg.site === 'object' ? cfg.site : {};
      const publicationName = String(site.title || cfg.title || 'Publication').trim() || 'Publication';
      return json({
        ok: true,
        surface: 'publication',
        orgId,
        private_source: true,
        publication: {
          name: publicationName,
          description: String(site.description || cfg.description || '').trim(),
          config: cfg,
        },
        item: published.item || null,
        items: Array.isArray(published.items) ? published.items : [],
      });
    }

    const scopedEnv = createColophonScopedEnv(context.env, orgId);
    const publicRequest = new Request(context.request, {
      headers: new Headers({ accept: 'application/json' }),
    });
    const scopedContext = { ...context, env: scopedEnv, request: publicRequest };

    const [contentResponse, siteResponse, orgCfg] = await Promise.all([
      nativeContent.onRequestGet(scopedContext),
      publicSiteConfig.onRequestGet(scopedContext),
      getPublicCfg(context.env, orgId),
    ]);

    const content = await contentResponse.json().catch(() => ({}));
    const site = await siteResponse.json().catch(() => ({}));
    if (!contentResponse.ok || content?.ok === false) {
      return json({ ok: false, error: content?.error || 'PUBLICATION_CONTENT_UNAVAILABLE' }, contentResponse.status || 500);
    }

    const orgPublic = projectOrganizationPageConfig(orgCfg || {});
    const connected = orgPublic?.connected_publication || {};
    const publicationName = String(
      site?.config?.site?.title ||
      site?.config?.title ||
      connected?.publication_name ||
      orgPublic?.title ||
      orgPublic?.branch_label ||
      'Publication'
    ).trim();

    return json({
      ok: true,
      surface: 'publication',
      orgId,
      publication: {
        name: publicationName,
        description: String(site?.config?.site?.description || site?.config?.description || '').trim(),
        config: site?.config || {},
      },
      item: content?.item || null,
      items: Array.isArray(content?.items) ? content.items : [],
    });
  } catch (error) {
    console.error('public publication read failed', error);
    return json({ ok: false, error: 'PUBLICATION_UNAVAILABLE' }, 500);
  }
}
