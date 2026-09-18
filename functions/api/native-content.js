import {
  ensureNativePublicContentTable,
  ensureNativeRevisionTable,
  listNativeEntries,
  getNativeEntry,
  getExistingNativeEntry,
  upsertNativeEntry,
  deleteNativeEntry,
  saveRevisionSnapshot,
} from './_lib/nativePublicContent.js'
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
    const permission = await resolvePublicSitePermission(context)
    const url = new URL(context.request.url)
    const id = url.searchParams.get('id') || ''
    const slug = url.searchParams.get('slug') || ''
    const status = url.searchParams.get('status') || ''
    const target = url.searchParams.get('target') || ''
    const workflowState = url.searchParams.get('workflowState') || ''
    const includeFutureRequested = url.searchParams.get('includeFuture') === '1'

    if (includeFutureRequested || status || workflowState) {
      await requireCoreSession(context)
    }

    const includeFuture = permission.canEdit || includeFutureRequested

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
    await ensureNativePublicContentTable(db)
    await ensureNativeRevisionTable(db)

    if (id || slug) {
      const item = await getNativeEntry(db, id || slug, { includeFuture })
      return jsonOk({
        mode: 'd1',
        authMode: permission.mode,
        data: { item },
        item,
        schemaVersion: APP_SCHEMA_VERSION,
      })
    }

    const items = await listNativeEntries(db, {
      status: status || undefined,
      target: target || undefined,
      workflowState: workflowState || undefined,
      includeFuture,
    })

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
  return handleWrite(context)
}

export async function onRequestPut(context) {
  return handleWrite(context)
}

export async function onRequestDelete(context) {
  return withApiHandler(async () => {
    const permission = await requireCoreSession(context)
    const url = new URL(context.request.url)
    const id = url.searchParams.get('id') || url.searchParams.get('slug') || ''

    if (!id) {
      throw badRequest('missing id or slug')
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
    const existing = await getExistingNativeEntry(db, id)
    if (existing) {
      await saveRevisionSnapshot(db, existing, 'delete:before')
    }

    const result = await deleteNativeEntry(db, id)

    return jsonOk({
      mode: 'd1',
      authMode: permission.mode,
      data: result,
      ...result,
      schemaVersion: APP_SCHEMA_VERSION,
    })
  })
}

async function handleWrite(context) {
  return withApiHandler(async () => {
    const permission = await requireCoreSession(context)
    const body = await parseJsonBody(context.request)
    const item = body?.item || body || {}
    const revisionNote = String(body?.revisionNote || item?.revisionNote || 'save')

    if (!hasDb(context)) {
      return jsonOk({
        mode: 'scaffold',
        authMode: permission.mode,
        data: { item },
        item,
        schemaVersion: APP_SCHEMA_VERSION,
      })
    }

    const db = await ensureDb(context)
    await ensureNativePublicContentTable(db)
    await ensureNativeRevisionTable(db)

    const existing = item?.id ? await getExistingNativeEntry(db, item.id) : null
    if (existing) {
      await saveRevisionSnapshot(db, existing, `before:${revisionNote}`)
    }

    const saved = await upsertNativeEntry(db, item)
    await saveRevisionSnapshot(db, saved, revisionNote)

    return jsonOk({
      mode: 'd1',
      authMode: permission.mode,
      data: { item: saved },
      item: saved,
      schemaVersion: APP_SCHEMA_VERSION,
    })
  }, { status: 400 })
}
