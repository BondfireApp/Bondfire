import { useEffect, useState } from 'react'
import { fetchNativeSources, saveNativeSource, removeNativeSource } from '../lib/nativeContentSourcesApi'
import { formatRequestError } from '../lib/apiClient'

function emptyRecord(nativeContentId = '') {
  return {
    id: '',
    nativeContentId,
    sourceType: 'manual',
    sourceLabel: '',
    sourceUrl: '',
    sourceExternalId: '',
    notes: '',
  }
}

export function NativeSourceBridgeCard({ nativeContentId }) {
  const [items, setItems] = useState([])
  const [form, setForm] = useState(emptyRecord(nativeContentId))
  const [state, setState] = useState('idle')
  const [error, setError] = useState('')

  async function reload() {
    if (!nativeContentId) {
      setItems([])
      setState('idle')
      setError('')
      return
    }

    try {
      setState('loading')
      setError('')
      const result = await fetchNativeSources(nativeContentId)
      const next = Array.isArray(result?.items) ? result.items : []
      setItems(next)
      setState(next.length ? 'loaded' : 'empty')
    } catch (err) {
      setError(formatRequestError(err, 'native source load failed'))
      setState('error')
    }
  }

  useEffect(() => {
    setForm(emptyRecord(nativeContentId))
    reload()
  }, [nativeContentId])

  async function handleSave() {
    try {
      setState('saving')
      setError('')
      await saveNativeSource({ ...form, nativeContentId })
      setForm(emptyRecord(nativeContentId))
      await reload()
    } catch (err) {
      setError(formatRequestError(err, 'native source save failed'))
      setState(items.length ? 'loaded' : 'error')
    }
  }

  async function handleDelete(id) {
    try {
      setState('deleting')
      setError('')
      await removeNativeSource(id)
      await reload()
    } catch (err) {
      setError(formatRequestError(err, 'native source delete failed'))
      setState(items.length ? 'loaded' : 'error')
    }
  }

  return (
    <section className="review-summary-card">
      <div className="review-summary-card__eyebrow">source bridge</div>
      <p className="review-card__excerpt">
        Track whether this entry came from manual writing, imported material, a note, a Drive doc, podcast audio, or transcript work. Humans adore losing provenance, so this helps.
      </p>

      <div className="native-content-editor__grid">
        <label className="archive-control">
          <span>source type</span>
          <select value={form.sourceType} onChange={(e) => setForm((p) => ({ ...p, sourceType: e.target.value }))}>
            <option value="manual">manual</option>
            <option value="imported">imported</option>
            <option value="note">note</option>
            <option value="drive">drive</option>
            <option value="podcast_audio">podcast_audio</option>
            <option value="transcript">transcript</option>
          </select>
        </label>

        <label className="archive-control">
          <span>label</span>
          <input type="text" value={form.sourceLabel} onChange={(e) => setForm((p) => ({ ...p, sourceLabel: e.target.value }))} />
        </label>

        <label className="archive-control">
          <span>source url</span>
          <input type="text" value={form.sourceUrl} onChange={(e) => setForm((p) => ({ ...p, sourceUrl: e.target.value }))} />
        </label>

        <label className="archive-control">
          <span>external id</span>
          <input type="text" value={form.sourceExternalId} onChange={(e) => setForm((p) => ({ ...p, sourceExternalId: e.target.value }))} />
        </label>
      </div>

      <label className="archive-control">
        <span>notes</span>
        <textarea className="native-content-editor__textarea native-content-editor__textarea--sm" value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} />
      </label>

      <div className="review-card__actions">
        <button className="button button--primary" type="button" onClick={handleSave} disabled={!nativeContentId}>save source record</button>
        <button className="button" type="button" onClick={() => setForm(emptyRecord(nativeContentId))}>clear</button>
        <button className="button" type="button" onClick={reload} disabled={!nativeContentId}>reload</button>
      </div>

      {error ? <p className="review-card__excerpt">{error}</p> : null}
      <p className="review-card__excerpt">status: {state}</p>

      <div className="native-source-list">
        {items.map((item) => (
          <article className="native-source-item" key={item.id}>
            <div className="native-source-item__meta">
              <strong>{item.sourceType}</strong>
              <span>{item.sourceLabel || item.sourceUrl || item.sourceExternalId || 'untitled source'}</span>
            </div>
            {item.notes ? <p>{item.notes}</p> : null}
            <div className="review-card__actions">
              <button className="button" type="button" onClick={() => setForm(item)}>edit</button>
              <button className="button" type="button" onClick={() => handleDelete(item.id)}>delete</button>
            </div>
          </article>
        ))}
        {!items.length ? <p className="review-card__excerpt">No source records yet.</p> : null}
      </div>
    </section>
  )
}
