import { runAppMigrations } from './migrations.js'

export function createMediaId() {
  return `media-${Math.random().toString(36).slice(2, 10)}`
}

export function normalizeMediaAsset(input) {
  const raw = input || {}
  const now = new Date().toISOString()

  return {
    id: String(raw.id || createMediaId()),
    title: String(raw.title || ''),
    url: String(raw.url || ''),
    altText: String(raw.altText || raw.alt_text || ''),
    caption: String(raw.caption || ''),
    credit: String(raw.credit || ''),
    mediaType: normalizeEnum(raw.mediaType || raw.media_type, ['image', 'audio', 'video', 'document']) || 'image',
    createdAt: String(raw.createdAt || raw.created_at || now),
    updatedAt: String(raw.updatedAt || raw.updated_at || now),
  }
}

export async function ensureMediaAssetsTable(db) {
  await runAppMigrations(db)
}

export async function listMediaAssets(db, options = {}) {
  await ensureMediaAssetsTable(db)

  const clauses = []
  const binds = []

  if (options.mediaType) {
    clauses.push('media_type = ?')
    binds.push(options.mediaType)
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''

  const stmt = db.prepare(`
    SELECT id, title, url, alt_text, caption, credit, media_type, created_at, updated_at
    FROM media_assets
    ${where}
    ORDER BY datetime(updated_at) DESC
  `)

  const result = binds.length ? await stmt.bind(...binds).all() : await stmt.all()
  const rows = Array.isArray(result?.results) ? result.results : []

  return rows.map(normalizeMediaAsset)
}

export async function upsertMediaAsset(db, asset) {
  await ensureMediaAssetsTable(db)

  const normalized = normalizeMediaAsset({
    ...asset,
    updatedAt: new Date().toISOString(),
  })

  await db
    .prepare(`
      INSERT INTO media_assets (
        id, title, url, alt_text, caption, credit, media_type, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        url = excluded.url,
        alt_text = excluded.alt_text,
        caption = excluded.caption,
        credit = excluded.credit,
        media_type = excluded.media_type,
        updated_at = excluded.updated_at
    `)
    .bind(
      normalized.id,
      normalized.title,
      normalized.url,
      normalized.altText,
      normalized.caption,
      normalized.credit,
      normalized.mediaType,
      normalized.createdAt,
      normalized.updatedAt
    )
    .run()

  return normalized
}

export async function deleteMediaAsset(db, id) {
  await ensureMediaAssetsTable(db)

  await db
    .prepare(`DELETE FROM media_assets WHERE id = ?`)
    .bind(id)
    .run()

  return { ok: true, deleted: id }
}

function normalizeEnum(value, allowed) {
  const str = String(value || '').trim()
  return allowed.includes(str) ? str : ''
}
