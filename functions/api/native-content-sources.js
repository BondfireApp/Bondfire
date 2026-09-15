import { ensureNativeContentSourcesTable, listSourcesForNativeContent, upsertSourceRecord, deleteSourceRecord } from './_lib/nativeContentSources.js'
import { jsonOk, withApiHandler, ensureDb, hasDb, parseJsonBody } from './_lib/api.js'
import { badRequest } from './_lib/errors.js'
import { APP_SCHEMA_VERSION } from './_lib/migrations.js'
import { resolvePublicSitePermission, requireCoreSession } from './_lib/publicSiteAuth.js'

export async function onRequestOptions(context) {
  const permission = await resolvePublicSitePermission(context)

  return jsonOk({
    canEdit: permission.canEdit,
    authMode: permission.mode,
    authReason: permission.reason,
    mode: hasDb(context) ? 'd1' : 'scaffold',
    schemaVersion: APP_SCHEMA_VERSION,
  })
}

export async function onRequestGet(context) {
  return withApiHandler(async () => {
    const permission = await requireCoreSession(context)
    const url = new URL(context.request.url)
    const nativeContentId = url.searchParams.get('nativeContentId') || ''

    if (!nativeContentId) {
      throw badRequest('missing nativeContentId')
    }

    if (!hasDb(context)) {
      return jsonOk({
        mode: 'scaffold',
        authMode: permission.mode,
        data: { items: [] },
        items: [],
        schemaVersion: APP_SCHEMA_VERSION,
      })
    }

    const db = await ensureDb(context)
    await ensureNativeContentSourcesTable(db)
    const items = await listSourcesForNativeContent(db, nativeContentId)

    return jsonOk({
      mode: 'd1',
      authMode: permission.mode,
      data: { items },
      items,
      schemaVersion: APP_SCHEMA_VERSION,
    })
  })
}

export async function onRequestPost(context) {
  return withApiHandler(async () => {
    const permission = await requireCoreSession(context)
    const body = await parseJsonBody(context.request)
    const record = body?.record || body || {}

    if (!hasDb(context)) {
      return jsonOk({
        mode: 'scaffold',
        authMode: permission.mode,
        data: { record },
        record,
        schemaVersion: APP_SCHEMA_VERSION,
      })
    }

    const db = await ensureDb(context)
    const saved = await upsertSourceRecord(db, record)

    return jsonOk({
      mode: 'd1',
      authMode: permission.mode,
      data: { record: saved },
      record: saved,
      schemaVersion: APP_SCHEMA_VERSION,
    })
  }, { status: 400 })
}

export async function onRequestDelete(context) {
  return withApiHandler(async () => {
    const permission = await requireCoreSession(context)
    const url = new URL(context.request.url)
    const id = url.searchParams.get('id') || ''

    if (!id) {
      throw badRequest('missing id')
    }

    if (!hasDb(context)) {
      return jsonOk({
        mode: 'scaffold',
        authMode: permission.mode,
        data: { deleted: id },
        deleted: id,
        schemaVersion: APP_SCHEMA_VERSION,
      })
    }

    const db = await ensureDb(context)
    const result = await deleteSourceRecord(db, id)

    return jsonOk({
      mode: 'd1',
      authMode: permission.mode,
      data: result,
      ...result,
      schemaVersion: APP_SCHEMA_VERSION,
    })
  })
}
