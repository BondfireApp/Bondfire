import {
  fetchNativeEntries,
  saveNativeEntry,
  removeNativeEntry,
} from './nativePublicContentApi'

const FALLBACK_STORAGE_KEY = 'sabot-native-public-content-v1'

export const NATIVE_CONTENT_SCHEMA_VERSION = 2

export function createEmptyNativeEntry() {
  const now = new Date().toISOString()
  return {
    id: `native-${Math.random().toString(36).slice(2, 10)}`,
    schemaVersion: NATIVE_CONTENT_SCHEMA_VERSION,
    contentType: 'note',
    status: 'draft',
    workflowState: 'draft',
    target: 'general',
    title: '',
    slug: '',
    excerpt: '',
    body: '',
    richBody: [],
    author: '',
    tags: [],
    createdAt: now,
    updatedAt: now,
    publishedAt: '',
    scheduledFor: '',
  }
}

export function normalizeNativeEntry(input) {
  const raw = input || {}
  const status = normalizeEnum(raw.status, ['draft', 'published', 'archived']) || 'draft'
  const workflowState =
    normalizeEnum(raw.workflowState, ['draft', 'in_review', 'needs_revision', 'ready', 'scheduled', 'published', 'archived']) ||
    inferWorkflowState(raw, status)

  return {
    id: String(raw.id || `native-${Math.random().toString(36).slice(2, 10)}`),
    schemaVersion: NATIVE_CONTENT_SCHEMA_VERSION,
    contentType: normalizeEnum(raw.contentType, ['note', 'publicBlock', 'dispatch']) || 'note',
    status,
    workflowState,
    target: normalizeEnum(raw.target, ['general', 'home', 'press', 'projects']) || 'general',
    title: String(raw.title || ''),
    slug: slugify(raw.slug || raw.title || ''),
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
    createdAt: String(raw.createdAt || new Date().toISOString()),
    updatedAt: String(raw.updatedAt || new Date().toISOString()),
    publishedAt: String(raw.publishedAt || ''),
    scheduledFor: normalizeDateString(raw.scheduledFor || ''),
  }
}

export function normalizeNativeCollection(input) {
  const arr = Array.isArray(input) ? input : []
  return arr.map(normalizeNativeEntry).sort((a, b) => {
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  })
}

export async function loadNativeCollectionResult(params = {}) {
  try {
    const response = await fetchNativeEntries(params)
    const items = normalizeNativeCollection(response?.items || response?.payload?.items || [])
    return {
      items,
      source: 'remote',
      error: '',
    }
  } catch (error) {
    try {
      const raw = window.localStorage.getItem(FALLBACK_STORAGE_KEY)
      if (!raw) {
        return {
          items: [],
          source: 'empty',
          error: String(error?.message || error || ''),
        }
      }

      return {
        items: normalizeNativeCollection(JSON.parse(raw)),
        source: 'local',
        error: String(error?.message || error || ''),
      }
    } catch (storageError) {
      return {
        items: [],
        source: 'empty',
        error: String(storageError?.message || error?.message || storageError || error || ''),
      }
    }
  }
}

export async function loadNativeCollection(params = {}) {
  const result = await loadNativeCollectionResult(params)
  return result.items
}

export function saveNativeCollection(items) {
  const normalized = normalizeNativeCollection(items)
  try {
    window.localStorage.setItem(FALLBACK_STORAGE_KEY, JSON.stringify(normalized))
  } catch {
    // ignore
  }
  return normalized
}

export async function upsertNativeEntry(items, entry, revisionNote = 'save') {
  const normalizedEntry = normalizeNativeEntry({
    ...entry,
    updatedAt: new Date().toISOString(),
  })

  try {
    const response = await saveNativeEntry(normalizedEntry, revisionNote)
    const saved = normalizeNativeEntry(response?.item || response?.payload?.item || normalizedEntry)
    const refreshed = await loadNativeCollection({ includeFuture: 1 })

    return normalizeNativeCollection(
      refreshed.some((item) => item.id === saved.id)
        ? refreshed.map((item) => (item.id === saved.id ? saved : item))
        : [saved, ...refreshed]
    )
  } catch {
    const next = [...(items || [])]
    const index = next.findIndex((item) => item.id === normalizedEntry.id)

    if (index >= 0) {
      next[index] = normalizedEntry
    } else {
      next.unshift(normalizedEntry)
    }

    return saveNativeCollection(next)
  }
}

export async function deleteNativeEntry(items, id) {
  try {
    await removeNativeEntry(id)
    return normalizeNativeCollection((items || []).filter((item) => item.id !== id && item.slug !== id))
  } catch {
    return saveNativeCollection((items || []).filter((item) => item.id !== id))
  }
}

export function exportNativeCollection(items) {
  return JSON.stringify(
    {
      schemaVersion: NATIVE_CONTENT_SCHEMA_VERSION,
      items: normalizeNativeCollection(items),
    },
    null,
    2
  )
}

export function importNativeCollection(raw) {
  const payload = raw?.items && Array.isArray(raw.items) ? raw.items : Array.isArray(raw) ? raw : []
  return saveNativeCollection(payload)
}

export function getPublishedNativeEntries(items) {
  return normalizeNativeCollection(items).filter((item) => item.status === 'published' && isScheduledVisible(item))
}

export function getLatestPublishedNativeEntry(items, target = '') {
  const published = getPublishedNativeEntries(items)
  return published.find((item) => !target || item.target === target) || null
}

export function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function isScheduledVisible(item) {
  if (!item?.scheduledFor) return true
  const ms = new Date(item.scheduledFor).getTime()
  return !Number.isFinite(ms) || ms <= Date.now()
}

function inferWorkflowState(raw, status) {
  if (status === 'archived') return 'archived'
  if (status === 'published') {
    const scheduled = normalizeDateString(raw?.scheduledFor || '')
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
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  }
  return []
}
