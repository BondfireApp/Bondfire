import { json, bad, uuid } from '../../../_lib/http.js'
import { enforceOrgWriteLockdown } from '../../../_lib/orgLockdown.js'

function safeRoom(row = {}) {
  return {
    id: String(row.id || ''),
    name: String(row.name || 'room'),
    createdAt: row.created_at || row.createdAt || null,
  }
}

async function ensureChatRoomsTable(db) {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS chat_rooms (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`
  ).run()

  await db.prepare(
    'CREATE INDEX IF NOT EXISTS idx_chat_rooms_org_created ON chat_rooms(org_id, created_at DESC)'
  ).run()
}

export async function onRequestGet({ env, params }) {
  try {
    const orgId = String(params?.orgId || '')
    const db = env?.BF_DB || env?.DB || null

    if (!orgId) return bad(400, 'MISSING_ORG')
    if (!db) return json({ ok: true, rooms: [], scaffold: true })

    await ensureChatRoomsTable(db)

    const result = await db.prepare(
      'SELECT id, name, created_at FROM chat_rooms WHERE org_id = ? ORDER BY created_at DESC'
    ).bind(orgId).all()

    return json({
      ok: true,
      rooms: (result.results || []).map(safeRoom),
    })
  } catch (error) {
    return bad(500, 'INTERNAL', { detail: String(error?.message || error || 'Unknown error') })
  }
}

export async function onRequestPost({ request, env, params }) {
  try {
    const orgId = String(params?.orgId || '')
    const db = env?.BF_DB || env?.DB || null
    const payload = await request.json().catch(() => ({}))
    const roomName = String(payload?.name || '').trim()

    if (!orgId) return bad(400, 'MISSING_ORG')
    if (!roomName) return bad(400, 'MISSING_NAME')
    const lockdown = await enforceOrgWriteLockdown({ env, orgId })
    if (!lockdown.ok) return lockdown.resp

    if (!db) {
      return json({
        ok: true,
        scaffold: true,
        room: {
          id: uuid(),
          name: roomName,
          createdAt: Date.now(),
        },
      })
    }

    await ensureChatRoomsTable(db)

    const id = uuid()
    const createdAt = Date.now()

    await db.prepare(
      'INSERT INTO chat_rooms (id, org_id, name, created_at) VALUES (?, ?, ?, ?)'
    ).bind(id, orgId, roomName, createdAt).run()

    return json({
      ok: true,
      room: {
        id,
        name: roomName,
        createdAt,
      },
    })
  } catch (error) {
    return bad(500, 'INTERNAL', { detail: String(error?.message || error || 'Unknown error') })
  }
}
