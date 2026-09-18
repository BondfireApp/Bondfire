import { jsonOk, withApiHandler, ensureDb, hasDb } from './_lib/api.js'
import { getSchemaState, APP_SCHEMA_VERSION } from './_lib/migrations.js'

export async function onRequestGet(context) {
  return withApiHandler(async () => {
    if (!hasDb(context)) {
      return jsonOk({
        mode: 'scaffold',
        schemaVersion: APP_SCHEMA_VERSION,
        data: {
          currentVersion: 0,
          updatedAt: null,
          applied: [],
        },
      })
    }

    const db = await ensureDb(context)
    const state = await getSchemaState(db)

    return jsonOk({
      mode: 'd1',
      schemaVersion: APP_SCHEMA_VERSION,
      data: state,
      currentVersion: state.currentVersion,
      updatedAt: state.updatedAt,
      applied: state.applied,
    })
  })
}
