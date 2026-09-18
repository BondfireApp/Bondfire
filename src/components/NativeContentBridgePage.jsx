import { useEffect, useMemo, useState } from 'react'
import { EditableText } from './EditableText'
import { useResolvedConfig } from '../lib/useResolvedConfig'
import { getConfiguredText } from '../lib/publicConfig'
import {
  createEmptyNativeEntry,
  deleteNativeEntry,
  exportNativeCollection,
  importNativeCollection,
  loadNativeCollectionResult,
  upsertNativeEntry,
  slugify,
  getLatestPublishedNativeEntry,
} from '../lib/nativePublicContent'
import { getEditorPermissionsSnapshot } from '../lib/editorPermissions'
import { formatRequestError } from '../lib/apiClient'
import { RichNativeEditor } from './RichNativeEditor'
import { MediaAssetManagerCard } from './MediaAssetManagerCard'
import { NativeSourceBridgeCard } from './NativeSourceBridgeCard'
import { TranscriptBridgeCard } from './TranscriptBridgeCard'
import { fetchNativeRevisions, restoreNativeRevision } from '../lib/nativePublicContentApi'

function NativeEntryEditor({
  value,
  onChange,
  contentTypeLabel,
  statusLabel,
  targetLabel,
  tagsLabel,
}) {
  return (
    <section className="native-content-editor">
      <div className="native-content-editor__grid">
        <label className="archive-control">
          <span>title</span>
          <input
            type="text"
            value={value.title}
            onChange={(e) => onChange({ ...value, title: e.target.value, slug: slugify(value.slug || e.target.value) })}
            placeholder="title"
          />
        </label>

        <label className="archive-control">
          <span>slug</span>
          <input
            type="text"
            value={value.slug}
            onChange={(e) => onChange({ ...value, slug: slugify(e.target.value) })}
            placeholder="slug"
          />
        </label>

        <label className="archive-control">
          <span>{contentTypeLabel}</span>
          <select value={value.contentType} onChange={(e) => onChange({ ...value, contentType: e.target.value })}>
            <option value="note">note</option>
            <option value="publicBlock">publicBlock</option>
            <option value="dispatch">dispatch</option>
          </select>
        </label>

        <label className="archive-control">
          <span>{statusLabel}</span>
          <select value={value.status} onChange={(e) => onChange({ ...value, status: e.target.value })}>
            <option value="draft">draft</option>
            <option value="published">published</option>
            <option value="archived">archived</option>
          </select>
        </label>

        <label className="archive-control">
          <span>workflow state</span>
          <select value={value.workflowState || 'draft'} onChange={(e) => onChange({ ...value, workflowState: e.target.value })}>
            <option value="draft">draft</option>
            <option value="in_review">in_review</option>
            <option value="needs_revision">needs_revision</option>
            <option value="ready">ready</option>
            <option value="scheduled">scheduled</option>
            <option value="published">published</option>
            <option value="archived">archived</option>
          </select>
        </label>

        <label className="archive-control">
          <span>{targetLabel}</span>
          <select value={value.target} onChange={(e) => onChange({ ...value, target: e.target.value })}>
            <option value="general">general</option>
            <option value="home">home</option>
            <option value="press">press</option>
            <option value="projects">projects</option>
          </select>
        </label>

        <label className="archive-control">
          <span>author</span>
          <input
            type="text"
            value={value.author}
            onChange={(e) => onChange({ ...value, author: e.target.value })}
            placeholder="author"
          />
        </label>

        <label className="archive-control">
          <span>scheduled for</span>
          <input
            type="datetime-local"
            value={toLocalDateTime(value.scheduledFor)}
            onChange={(e) => onChange({ ...value, scheduledFor: fromLocalDateTime(e.target.value) })}
          />
        </label>
      </div>

      <label className="archive-control">
        <span>excerpt</span>
        <textarea
          className="native-content-editor__textarea native-content-editor__textarea--sm"
          value={value.excerpt}
          onChange={(e) => onChange({ ...value, excerpt: e.target.value })}
          placeholder="excerpt"
        />
      </label>

      <label className="archive-control">
        <span>{tagsLabel}</span>
        <input
          type="text"
          value={(value.tags || []).join(', ')}
          onChange={(e) => onChange({
            ...value,
            tags: e.target.value.split(',').map((item) => item.trim()).filter(Boolean),
          })}
          placeholder="tag1, tag2"
        />
      </label>

      <label className="archive-control">
        <span>body summary</span>
        <textarea
          className="native-content-editor__textarea native-content-editor__textarea--sm"
          value={value.body}
          onChange={(e) => onChange({ ...value, body: e.target.value })}
          placeholder="plain text fallback body"
        />
      </label>

      <RichNativeEditor
        value={value.richBody || []}
        onChange={(next) => onChange({ ...value, richBody: next })}
        mediaAssetsSlot={({ onPick }) => <MediaAssetManagerCard onPick={onPick} />}
      />
    </section>
  )
}

function NativeEntryCard({ entry, isActive, onSelect }) {
  return (
    <button
      type="button"
      className={`native-entry-card${isActive ? ' native-entry-card--active' : ''}`}
      onClick={onSelect}
    >
      <span className="native-entry-card__meta">{entry.contentType} / {entry.status} / {entry.workflowState} / {entry.target}</span>
      <strong>{entry.title || 'untitled'}</strong>
      <span className="native-entry-card__slug">{entry.slug || 'no-slug'}</span>
      <span className="native-entry-card__date">{entry.updatedAt}</span>
    </button>
  )
}

function RevisionList({ revisions, onRestore, state }) {
  return (
    <section className="review-summary-card">
      <div className="review-summary-card__eyebrow">revisions</div>
      <p className="review-card__excerpt">status: {state}</p>
      <div className="native-revision-list">
        {revisions.map((rev) => (
          <article className="native-revision-item" key={rev.id}>
            <div className="native-revision-item__meta">
              <strong>{rev.revisionNote}</strong>
              <span>{rev.createdAt}</span>
            </div>
            <div className="review-card__actions">
              <button className="button button--primary" type="button" onClick={() => onRestore(rev.id)}>
                restore
              </button>
            </div>
          </article>
        ))}
        {!revisions.length ? <p className="review-card__excerpt">No revisions yet.</p> : null}
      </div>
    </section>
  )
}

export function NativeContentBridgePage() {
  const resolvedConfig = useResolvedConfig()

  const eyebrow = getConfiguredText(resolvedConfig, 'nativeBridge.eyebrow', 'native / publish / bridge')
  const title = getConfiguredText(resolvedConfig, 'nativeBridge.title', 'Native Publishing Bridge')
  const description = getConfiguredText(
    resolvedConfig,
    'nativeBridge.description',
    'Define the first native public content objects inside Sabot so publishing can move from imported archive toward a real internal system.'
  )
  const contentTypeLabel = getConfiguredText(resolvedConfig, 'nativeBridge.contentTypeLabel', 'content type')
  const statusLabel = getConfiguredText(resolvedConfig, 'nativeBridge.statusLabel', 'status')
  const targetLabel = getConfiguredText(resolvedConfig, 'nativeBridge.targetLabel', 'target')
  const tagsLabel = getConfiguredText(resolvedConfig, 'nativeBridge.tagsLabel', 'tags')
  const newEntryLabel = getConfiguredText(resolvedConfig, 'nativeBridge.newEntryAction', 'new entry')
  const saveEntryLabel = getConfiguredText(resolvedConfig, 'nativeBridge.saveEntryAction', 'save entry')
  const deleteEntryLabel = getConfiguredText(resolvedConfig, 'nativeBridge.deleteEntryAction', 'delete entry')
  const duplicateEntryLabel = getConfiguredText(resolvedConfig, 'nativeBridge.duplicateEntryAction', 'duplicate entry')
  const exportLabel = getConfiguredText(resolvedConfig, 'nativeBridge.exportAction', 'copy export json')
  const importLabel = getConfiguredText(resolvedConfig, 'nativeBridge.importAction', 'import json')
  const latestHomeLabel = getConfiguredText(resolvedConfig, 'nativeBridge.latestHomeLabel', 'latest published home item')
  const latestGeneralLabel = getConfiguredText(resolvedConfig, 'nativeBridge.latestGeneralLabel', 'latest published general item')
  const collectionLabel = getConfiguredText(resolvedConfig, 'nativeBridge.collectionLabel', 'collection')
  const previewLabel = getConfiguredText(resolvedConfig, 'nativeBridge.previewLabel', 'preview')
  const emptyLabel = getConfiguredText(resolvedConfig, 'nativeBridge.emptyLabel', 'No native entries yet. Start with a note, dispatch, or publicBlock.')

  const [items, setItems] = useState([])
  const [activeId, setActiveId] = useState('')
  const [draft, setDraft] = useState(createEmptyNativeEntry())
  const [importText, setImportText] = useState('')
  const [copied, setCopied] = useState(false)
  const [importStatus, setImportStatus] = useState('')
  const [permissionState, setPermissionState] = useState('loading')
  const [canEdit, setCanEdit] = useState(false)
  const [collectionState, setCollectionState] = useState('loading')
  const [collectionError, setCollectionError] = useState('')
  const [operationState, setOperationState] = useState('idle')
  const [operationError, setOperationError] = useState('')
  const [revisionState, setRevisionState] = useState('idle')
  const [revisions, setRevisions] = useState([])

  useEffect(() => {
    let cancelled = false

    async function boot() {
      try {
        const perms = await getEditorPermissionsSnapshot()
        if (cancelled) return
        setCanEdit(Boolean(perms?.nativeContent?.canEdit))
        setPermissionState('loaded')
      } catch (err) {
        if (!cancelled) {
          setCanEdit(false)
          setPermissionState('error')
          setCollectionError((current) => current || formatRequestError(err, 'permission check failed'))
        }
      }

      const result = await loadNativeCollectionResult({ includeFuture: 1 })
      if (cancelled) return

      setItems(result.items)
      setCollectionState(result.source)
      setCollectionError(result.error || '')

      if (result.items.length) {
        setActiveId(result.items[0].id)
        setDraft(result.items[0])
      }
    }

    boot()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadRevisions() {
      if (!draft?.id || !canEdit) {
        setRevisions([])
        setRevisionState('idle')
        return
      }

      try {
        setRevisionState('loading')
        const result = await fetchNativeRevisions({ nativeId: draft.id })
        if (cancelled) return
        setRevisions(Array.isArray(result?.items) ? result.items : [])
        setRevisionState('loaded')
      } catch {
        if (cancelled) return
        setRevisions([])
        setRevisionState('error')
      }
    }

    loadRevisions()
    return () => {
      cancelled = true
    }
  }, [draft?.id, canEdit])

  const latestHome = useMemo(() => getLatestPublishedNativeEntry(items, 'home'), [items])
  const latestGeneral = useMemo(() => getLatestPublishedNativeEntry(items, 'general'), [items])

  function selectEntry(entry) {
    setActiveId(entry.id)
    setDraft(entry)
    setOperationError('')
  }

  function handleNew() {
    const fresh = createEmptyNativeEntry()
    setActiveId(fresh.id)
    setDraft(fresh)
    setOperationError('')
  }

  async function handleSave(note = 'save') {
    try {
      setOperationState('saving')
      setOperationError('')
      const next = await upsertNativeEntry(items, draft, note)
      setItems(next)
      const saved = next.find((item) => item.id === draft.id) || next[0]
      if (saved) {
        setActiveId(saved.id)
        setDraft(saved)
      }
      setCollectionState('remote')
      setOperationState('saved')
    } catch (err) {
      setOperationError(formatRequestError(err, 'save failed'))
      setOperationState('error')
    }
  }

  async function handleDelete() {
    if (!activeId) return

    try {
      setOperationState('deleting')
      setOperationError('')
      const next = await deleteNativeEntry(items, activeId)
      setItems(next)
      if (next.length) {
        setActiveId(next[0].id)
        setDraft(next[0])
      } else {
        const fresh = createEmptyNativeEntry()
        setActiveId(fresh.id)
        setDraft(fresh)
      }
      setOperationState('deleted')
    } catch (err) {
      setOperationError(formatRequestError(err, 'delete failed'))
      setOperationState('error')
    }
  }

  function handleDuplicate() {
    const copy = {
      ...draft,
      id: createEmptyNativeEntry().id,
      title: draft.title ? `${draft.title} copy` : '',
      slug: slugify(draft.title ? `${draft.title} copy` : ''),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      publishedAt: '',
      scheduledFor: '',
      status: 'draft',
      workflowState: 'draft',
    }
    setActiveId(copy.id)
    setDraft(copy)
    setOperationError('')
  }

  async function handleExport() {
    try {
      await navigator.clipboard.writeText(exportNativeCollection(items))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      setCopied(false)
    }
  }

  function handleImport() {
    try {
      const parsed = JSON.parse(importText)
      const next = importNativeCollection(parsed)
      setItems(next)
      if (next.length) {
        setActiveId(next[0].id)
        setDraft(next[0])
      }
      setImportStatus('imported')
      setCollectionState('local')
      setCollectionError('')
    } catch {
      setImportStatus('invalid json')
    }
  }

  async function handleRestoreRevision(revisionId) {
    try {
      setOperationState('restoring')
      setOperationError('')
      const result = await restoreNativeRevision(revisionId)
      const restored = result?.item || null
      if (!restored) return

      const refreshed = await loadNativeCollectionResult({ includeFuture: 1 })
      setItems(refreshed.items)
      setCollectionState(refreshed.source)
      setCollectionError(refreshed.error || '')
      setActiveId(restored.id)
      setDraft(restored)
      setOperationState('restored')
    } catch (err) {
      setOperationError(formatRequestError(err, 'revision restore failed'))
      setOperationState('error')
    }
  }

  return (
    <main className="page native-bridge-page">
      <section className="project-hero">
        <EditableText as="div" className="project-hero__eyebrow" field="nativeBridge.eyebrow">
          {eyebrow}
        </EditableText>
        <EditableText as="h1" field="nativeBridge.title">
          {title}
        </EditableText>
        <EditableText as="p" className="project-hero__description" field="nativeBridge.description">
          {description}
        </EditableText>
        <div className="project-hero__meta">
          <span>{items.length} {collectionLabel}</span>
          <span>{latestHome ? `${latestHomeLabel}: ${latestHome.title || latestHome.slug}` : `${latestHomeLabel}: none`}</span>
          <span>{latestGeneral ? `${latestGeneralLabel}: ${latestGeneral.title || latestGeneral.slug}` : `${latestGeneralLabel}: none`}</span>
          <span>permission: {permissionState === 'loaded' ? (canEdit ? 'can edit' : 'read only') : permissionState}</span>
          <span>collection: {collectionState}</span>
          <span>ops: {operationState}</span>
        </div>
        {collectionError ? <p className="review-card__excerpt">{collectionError}</p> : null}
        {operationError ? <p className="review-card__excerpt">{operationError}</p> : null}
      </section>

      <section className="native-bridge-layout">
        <aside className="native-bridge-sidebar">
          <div className="review-card__actions">
            <button className="button button--primary" type="button" onClick={handleNew}>{newEntryLabel}</button>
            <button className="button" type="button" onClick={handleExport}>{copied ? 'copied' : exportLabel}</button>
          </div>

          {items.length ? (
            <div className="native-bridge-list">
              {items.map((entry) => (
                <NativeEntryCard
                  key={entry.id}
                  entry={entry}
                  isActive={entry.id === activeId}
                  onSelect={() => selectEntry(entry)}
                />
              ))}
            </div>
          ) : (
            <div className="missing-state">
              <p>{emptyLabel}</p>
            </div>
          )}

          <label className="archive-control">
            <span>{importLabel}</span>
            <textarea
              className="native-content-editor__textarea native-content-editor__textarea--sm"
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder="paste exported native content json here"
            />
          </label>

          <div className="review-card__actions">
            <button className="button" type="button" onClick={handleImport} disabled={!canEdit}>{importLabel}</button>
          </div>
          {importStatus ? <p className="review-card__excerpt">{importStatus}</p> : null}

          <RevisionList revisions={revisions} onRestore={handleRestoreRevision} state={revisionState} />
        </aside>

        <section className="native-bridge-main">
          <div className="review-card__actions">
            <button className="button button--primary" type="button" onClick={() => handleSave('save')} disabled={!canEdit}>{saveEntryLabel}</button>
            <button className="button" type="button" onClick={handleDuplicate}>{duplicateEntryLabel}</button>
            <button className="button" type="button" onClick={handleDelete} disabled={!canEdit}>{deleteEntryLabel}</button>
            <button className="button" type="button" onClick={() => setDraft((d) => ({ ...d, status: 'published', workflowState: d.scheduledFor ? 'scheduled' : 'published' }))}>
              mark publish-ready
            </button>
            <button className="button" type="button" onClick={() => setDraft((d) => ({ ...d, status: 'archived', workflowState: 'archived' }))}>
              archive draft
            </button>
          </div>

          <NativeEntryEditor
            value={draft}
            onChange={setDraft}
            contentTypeLabel={contentTypeLabel}
            statusLabel={statusLabel}
            targetLabel={targetLabel}
            tagsLabel={tagsLabel}
          />

          <TranscriptBridgeCard draft={draft} setDraft={setDraft} />

          <NativeSourceBridgeCard nativeContentId={draft?.id || ''} />

          <section className="review-summary-grid">
            <article className="review-summary-card">
              <div className="review-summary-card__eyebrow">{previewLabel}</div>
              <ul>
                <li><span>title</span><strong>{draft.title || 'untitled'}</strong></li>
                <li><span>slug</span><strong>{draft.slug || 'no-slug'}</strong></li>
                <li><span>type</span><strong>{draft.contentType}</strong></li>
                <li><span>status</span><strong>{draft.status}</strong></li>
                <li><span>workflow</span><strong>{draft.workflowState || 'draft'}</strong></li>
                <li><span>target</span><strong>{draft.target}</strong></li>
                <li><span>scheduled</span><strong>{draft.scheduledFor || 'none'}</strong></li>
              </ul>
            </article>

            <article className="review-summary-card">
              <div className="review-summary-card__eyebrow">shape</div>
              <pre className="review-card__snippet">{JSON.stringify(draft, null, 2)}</pre>
            </article>
          </section>
        </section>
      </section>
    </main>
  )
}

function toLocalDateTime(value) {
  const str = String(value || '').trim()
  if (!str) return ''
  const d = new Date(str)
  if (!Number.isFinite(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromLocalDateTime(value) {
  const str = String(value || '').trim()
  if (!str) return ''
  const d = new Date(str)
  return Number.isFinite(d.getTime()) ? d.toISOString() : ''
}
