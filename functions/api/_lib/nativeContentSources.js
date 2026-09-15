import { runAppMigrations } from './migrations.js'

export function createSourceId() {
  return `src-${Math.random().toString(36).slice(2, 10)}`
}

export function normalizeSourceRecord(input) {
  const raw = input || {}
  const now = new Date().toISOString()

  return {
    id: String(raw.id || createSourceId()),
    nativeContentId: String(raw.nativeContentId || raw.native_content_id || ''),
    sourceType: normalizeEnum(raw.sourceType || raw.source_type, ['manual', 'imported', 'note', 'drive', 'podcast_audio', 'transcript']) || 'manual',
    sourceLabel: String(raw.sourceLabel || raw.source_label || ''),
    sourceUrl: String(raw.sourceUrl || raw.source_url || ''),
    sourceExternalId: String(raw.sourceExternalId || raw.source_external_id || ''),
    notes: String(raw.notes || ''),
    createdAt: String(raw.createdAt || raw.created_at || now),
    updatedAt: String(raw.updatedAt || raw.updated_at || now),
  }
}

export async function ensureNativeContentSourcesTable(db) {
  await runAppMigrations(db)
}

export async function listSourcesForNativeContent(db, nativeContentId) {
  await ensureNativeContentSourcesTable(db)

  const result = await db
    .prepare(`
      SELECT id, native_content_id, source_type, source_label, source_url, source_external_id, notes, created_at, updated_at
      FROM native_content_sources
      WHERE native_content_id = ?
      ORDER BY datetime(updated_at) DESC
    `)
    .bind(nativeContentId)
    .all()

  const rows = Array.isArray(result?.results) ? result.results : []
  return rows.map(normalizeSourceRecord)
}

export async function upsertSourceRecord(db, record) {
  await ensureNativeContentSourcesTable(db)
  const normalized = normalizeSourceRecord({
    ...record,
    updatedAt: new Date().toISOString(),
  })

  await db
    .prepare(`
      INSERT INTO native_content_sources (
        id, native_content_id, source_type, source_label, source_url, source_external_id, notes, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        native_content_id = excluded.native_content_id,
        source_type = excluded.source_type,
        source_label = excluded.source_label,
        source_url = excluded.source_url,
        source_external_id = excluded.source_external_id,
        notes = excluded.notes,
        updated_at = excluded.updated_at
    `)
    .bind(
      normalized.id,
      normalized.nativeContentId,
      normalized.sourceType,
      normalized.sourceLabel,
      normalized.sourceUrl,
      normalized.sourceExternalId,
      normalized.notes,
      normalized.createdAt,
      normalized.updatedAt
    )
    .run()

  return normalized
}

export async function deleteSourceRecord(db, id) {
  await ensureNativeContentSourcesTable(db)
  await db.prepare(`DELETE FROM native_content_sources WHERE id = ?`).bind(id).run()
  return { ok: true, deleted: id }
}

function normalizeEnum(value, allowed) {
  const str = String(value || '').trim()
  return allowed.includes(str) ? str : ''
}
