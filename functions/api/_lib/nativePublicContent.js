import { runAppMigrations } from './migrations.js'

const NATIVE_CONTENT_SCHEMA_VERSION = 2

export async function ensureNativePublicContentTable(db) {
  await runAppMigrations(db)
}

export async function ensureNativeRevisionTable(db) {
  await runAppMigrations(db)
}

export function createNativeId() {
  return `native-${Math.random().toString(36).slice(2, 10)}`
}

export function createRevisionId() {
  return `rev-${Math.random().toString(36).slice(2, 10)}`
}

export function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function normalizeNativeEntry(input) {
  const raw = input || {}
  const now = new Date().toISOString()

  const status = normalizeEnum(raw.status, ['draft', 'published', 'archived']) || 'draft'
  const workflowState =
    normalizeEnum(raw.workflowState || raw.workflow_state, [
      'draft',
      'in_review',
      'needs_revision',
      'ready',
      'scheduled',
      'published',
      'archived',
    ]) || inferWorkflowState(raw, status)

  const scheduledFor = normalizeDateString(raw.scheduledFor || raw.scheduled_for || '')

  return {
    id: String(raw.id || createNativeId()),
    schemaVersion: NATIVE_CONTENT_SCHEMA_VERSION,
    contentType: normalizeEnum(raw.contentType || raw.content_type, ['note', 'publicBlock', 'dispatch']) || 'note',
    status,
    workflowState,
    target: normalizeEnum(raw.target, ['general', 'home', 'press', 'projects']) || 'general',
    title: String(raw.title || ''),
    slug: slugify(raw.slug || raw.title || raw.id || ''),
    excerpt: String(raw.excerpt || ''),
    body: String(raw.body || ''),
    richBody: Array.isArray(raw.richBody) ? raw.richBody : [],
    author: String(raw.author || ''),
    sourceType: String(raw.sourceType || 'manual'),
    sourceLabel: String(raw.sourceLabel || ''),
    sourceUrl: String(raw.sourceUrl || ''),
    sourceExternalId: String(raw.sourceExternalId || ''),
    sourceNotes: String(raw.sourceNotes || ''),
    transcriptionStatus: String(raw.transcriptionStatus || 'none'),
    audioSourceUrl: String(raw.audioSourceUrl || ''),
    fullTranscript: String(raw.fullTranscript || ''),
    transcriptNotes: String(raw.transcriptNotes || ''),
    tags: normalizeTags(raw.tags),
    createdAt: String(raw.createdAt || raw.created_at || now),
    updatedAt: String(raw.updatedAt || raw.updated_at || now),
    publishedAt: String(raw.publishedAt || raw.published_at || ''),
    scheduledFor,
  }
}

export function normalizeNativeCollection(input) {
  const arr = Array.isArray(input) ? input : []
  return arr
    .map(normalizeNativeEntry)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
}

export async function listNativeEntries(db, options = {}) {
  await ensureNativePublicContentTable(db)

  const clauses = []
  const binds = []

  if (options.status) {
    clauses.push('status = ?')
    binds.push(options.status)
  }

  if (options.target) {
    clauses.push('target = ?')
    binds.push(options.target)
  }

  if (options.workflowState) {
    clauses.push(`json_extract(content_json, '$.workflowState') = ?`)
    binds.push(options.workflowState)
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''

  const stmt = db.prepare(`
    SELECT id, slug, content_json, status, target, content_type, created_at, updated_at, published_at
    FROM native_public_content
    ${where}
    ORDER BY datetime(updated_at) DESC
  `)

  const result = binds.length ? await stmt.bind(...binds).all() : await stmt.all()
  const rows = Array.isArray(result?.results) ? result.results : []

  const items = normalizeNativeCollection(
    rows.map((row) => {
      let parsed = {}
      try {
        parsed = JSON.parse(row.content_json || '{}')
      } catch {
        parsed = {}
      }

      return {
        ...parsed,
        id: row.id,
        slug: row.slug,
        status: row.status,
        target: row.target,
        contentType: row.content_type,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        publishedAt: row.published_at || '',
      }
    })
  )

  return options.includeFuture ? items : items.filter(isPubliclyVisible)
}

export async function getNativeEntry(db, idOrSlug, options = {}) {
  await ensureNativePublicContentTable(db)

  const row = await db
    .prepare(`
      SELECT id, slug, content_json, status, target, content_type, created_at, updated_at, published_at
      FROM native_public_content
      WHERE id = ? OR slug = ?
      LIMIT 1
    `)
    .bind(idOrSlug, idOrSlug)
    .first()

  if (!row) return null

  let parsed = {}
  try {
    parsed = JSON.parse(row.content_json || '{}')
  } catch {
    parsed = {}
  }

  const item = normalizeNativeEntry({
    ...parsed,
    id: row.id,
    slug: row.slug,
    status: row.status,
    target: row.target,
    contentType: row.content_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at || '',
  })

  if (!options.includeFuture && !isPubliclyVisible(item)) {
    return null
  }

  return item
}

export async function getExistingNativeEntry(db, idOrSlug) {
  await ensureNativePublicContentTable(db)

  const row = await db
    .prepare(`
      SELECT id, slug, content_json, status, target, content_type, created_at, updated_at, published_at
      FROM native_public_content
      WHERE id = ? OR slug = ?
      LIMIT 1
    `)
    .bind(idOrSlug, idOrSlug)
    .first()

  if (!row) return null

  let parsed = {}
  try {
    parsed = JSON.parse(row.content_json || '{}')
  } catch {
    parsed = {}
  }

  return normalizeNativeEntry({
    ...parsed,
    id: row.id,
    slug: row.slug,
    status: row.status,
    target: row.target,
    contentType: row.content_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at || '',
  })
}

export async function upsertNativeEntry(db, entry) {
  await ensureNativePublicContentTable(db)

  const normalized = normalizeNativeEntry({
    ...entry,
    updatedAt: new Date().toISOString(),
    publishedAt: computePublishedAt(entry),
  })

  const contentJson = JSON.stringify(normalized)

  await db
    .prepare(`
      INSERT INTO native_public_content (
        id, slug, content_json, status, target, content_type, created_at, updated_at, published_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        slug = excluded.slug,
        content_json = excluded.content_json,
        status = excluded.status,
        target = excluded.target,
        content_type = excluded.content_type,
        updated_at = excluded.updated_at,
        published_at = excluded.published_at
    `)
    .bind(
      normalized.id,
      normalized.slug,
      contentJson,
      normalized.status,
      normalized.target,
      normalized.contentType,
      normalized.createdAt,
      normalized.updatedAt,
      normalized.publishedAt || null
    )
    .run()

  return normalized
}

export async function deleteNativeEntry(db, idOrSlug) {
  await ensureNativePublicContentTable(db)

  await db
    .prepare(`
      DELETE FROM native_public_content
      WHERE id = ? OR slug = ?
    `)
    .bind(idOrSlug, idOrSlug)
    .run()

  return { ok: true, deleted: idOrSlug }
}

export async function saveRevisionSnapshot(db, entry, revisionNote = 'autosave') {
  await ensureNativeRevisionTable(db)
  const normalized = normalizeNativeEntry(entry)

  await db
    .prepare(`
      INSERT INTO native_public_content_revisions (
        id, native_content_id, revision_json, revision_note, created_at
      )
      VALUES (?, ?, ?, ?, ?)
    `)
    .bind(
      createRevisionId(),
      normalized.id,
      JSON.stringify(normalized),
      String(revisionNote || 'autosave'),
      new Date().toISOString()
    )
    .run()

  return { ok: true }
}

export async function listRevisionSnapshots(db, nativeId) {
  await ensureNativeRevisionTable(db)

  const result = await db
    .prepare(`
      SELECT id, native_content_id, revision_json, revision_note, created_at
      FROM native_public_content_revisions
      WHERE native_content_id = ?
      ORDER BY datetime(created_at) DESC
    `)
    .bind(nativeId)
    .all()

  const rows = Array.isArray(result?.results) ? result.results : []

  return rows.map((row) => {
    let parsed = {}
    try {
      parsed = JSON.parse(row.revision_json || '{}')
    } catch {
      parsed = {}
    }

    return {
      id: row.id,
      nativeContentId: row.native_content_id,
      revisionNote: row.revision_note,
      createdAt: row.created_at,
      snapshot: normalizeNativeEntry(parsed),
    }
  })
}

export async function restoreRevisionSnapshot(db, revisionId) {
  await ensureNativeRevisionTable(db)

  const row = await db
    .prepare(`
      SELECT id, native_content_id, revision_json, revision_note, created_at
      FROM native_public_content_revisions
      WHERE id = ?
      LIMIT 1
    `)
    .bind(revisionId)
    .first()

  if (!row) {
    throw new Error('revision not found')
  }

  let parsed = {}
  try {
    parsed = JSON.parse(row.revision_json || '{}')
  } catch {
    parsed = {}
  }

  const restored = await upsertNativeEntry(db, {
    ...parsed,
    updatedAt: new Date().toISOString(),
  })

  await saveRevisionSnapshot(db, restored, `restore:${revisionId}`)

  return restored
}

export function isPubliclyVisible(item) {
  if (!item) return false
  if (item.status !== 'published') return false
  if (item.workflowState === 'archived') return false
  if (item.workflowState && !['published', 'scheduled', 'ready'].includes(item.workflowState)) return false

  const now = Date.now()
  const scheduled = item.scheduledFor ? new Date(item.scheduledFor).getTime() : 0
  if (scheduled && Number.isFinite(scheduled) && scheduled > now) return false

  return true
}

function computePublishedAt(entry) {
  const status = String(entry?.status || '')
  const existing = String(entry?.publishedAt || '')
  const scheduled = normalizeDateString(entry?.scheduledFor || '')

  if (status !== 'published') return existing || ''
  if (scheduled) return scheduled
  return existing || new Date().toISOString()
}

function inferWorkflowState(raw, status) {
  if (status === 'archived') return 'archived'
  if (status === 'published') {
    const scheduled = normalizeDateString(raw?.scheduledFor || raw?.scheduled_for || '')
    if (scheduled && new Date(scheduled).getTime() > Date.now()) return 'scheduled'
    return 'published'
  }
  return 'draft'
}

function normalizeDateString(value) {
  const str = String(value || '').trim()
  if (!str) return ''
  const ms = new Date(str).getTime()
  return Number.isFinite(ms) ? new Date(ms).toISOString() : ''
}

function normalizeEnum(value, allowed) {
  const str = String(value || '').trim()
  return allowed.includes(str) ? str : ''
}

function normalizeTags(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean)
  }
  if (typeof value === 'string') {
    return value.split(',').map((item) => item.trim()).filter(Boolean)
  }
  return []
}
