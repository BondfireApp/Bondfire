import {
  readPublicSiteConfig,
  writePublicSiteConfig,
  normalizePublicConfig,
  PUBLIC_CONFIG_SCHEMA_VERSION,
} from './_lib/publicSiteConfig.js'
import { resolvePublicSitePermission } from './_lib/publicSiteAuth.js'
import { jsonOk, withApiHandler, ensureDb, hasDb, parseJsonBody } from './_lib/api.js'
import { forbidden } from './_lib/errors.js'
import { APP_SCHEMA_VERSION } from './_lib/migrations.js'

export async function onRequestOptions(context) {
  const permission = await resolvePublicSitePermission(context)

  return jsonOk({
    canEdit: permission.canEdit,
    authMode: permission.mode,
    authReason: permission.reason,
    mode: hasDb(context) ? 'd1' : 'scaffold',
    schemaVersion: APP_SCHEMA_VERSION,
    configSchemaVersion: PUBLIC_CONFIG_SCHEMA_VERSION,
    note: hasDb(context)
      ? 'D1-backed public site config route available.'
      : 'No BF_DB binding detected. Using scaffold mode.',
  })
}

export async function onRequestGet(context) {
  return withApiHandler(async () => {
    const permission = await resolvePublicSitePermission(context)

    if (!hasDb(context)) {
      const config = normalizePublicConfig({})
      return jsonOk({
        mode: 'scaffold',
        canEdit: permission.canEdit,
        authMode: permission.mode,
        authReason: permission.reason,
        scope: 'global',
        updatedAt: null,
        version: PUBLIC_CONFIG_SCHEMA_VERSION,
        schemaVersion: APP_SCHEMA_VERSION,
        configSchemaVersion: PUBLIC_CONFIG_SCHEMA_VERSION,
        data: { config, scope: 'global', updatedAt: null },
        config,
      })
    }

    const db = await ensureDb(context)
    const result = await readPublicSiteConfig(db, 'global')

    return jsonOk({
      mode: 'd1',
      scope: result.scope,
      updatedAt: result.updatedAt,
      canEdit: permission.canEdit,
      authMode: permission.mode,
      authReason: permission.reason,
      version: result.version,
      schemaVersion: APP_SCHEMA_VERSION,
      configSchemaVersion: PUBLIC_CONFIG_SCHEMA_VERSION,
      data: {
        config: result.config,
        scope: result.scope,
        updatedAt: result.updatedAt,
      },
      config: result.config,
    })
  })
}

export async function onRequestPut(context) {
  return withApiHandler(async () => {
    const permission = await resolvePublicSitePermission(context)

    if (!permission.canEdit) {
      throw forbidden(permission.reason, { details: { canEdit: false, authMode: permission.mode } })
    }

    const body = await parseJsonBody(context.request)
    const incoming = body?.publicSite || body?.config || body || {}

    if (!hasDb(context)) {
      const normalized = normalizePublicConfig(incoming)
      return jsonOk({
        mode: 'scaffold',
        saved: true,
        canEdit: true,
        authMode: permission.mode,
        authReason: permission.reason,
        updatedAt: new Date().toISOString(),
        version: PUBLIC_CONFIG_SCHEMA_VERSION,
        schemaVersion: APP_SCHEMA_VERSION,
        configSchemaVersion: PUBLIC_CONFIG_SCHEMA_VERSION,
        note: 'BF_DB binding missing. Save accepted in scaffold mode only.',
        data: { config: normalized },
        received: { publicSite: normalized },
      })
    }

    const db = await ensureDb(context)
    const saved = await writePublicSiteConfig(db, incoming, 'global')

    return jsonOk({
      mode: 'd1',
      saved: true,
      canEdit: true,
      authMode: permission.mode,
      authReason: permission.reason,
      updatedAt: saved.updatedAt,
      scope: saved.scope,
      version: saved.version,
      schemaVersion: APP_SCHEMA_VERSION,
      configSchemaVersion: PUBLIC_CONFIG_SCHEMA_VERSION,
      data: { config: saved.config, scope: saved.scope, updatedAt: saved.updatedAt },
      received: { publicSite: saved.config },
      config: saved.config,
    })
  }, { status: 400 })
}
