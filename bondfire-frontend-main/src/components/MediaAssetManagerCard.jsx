import { useEffect, useMemo, useState } from 'react'
import { fetchMediaAssets, saveMediaAsset, removeMediaAsset } from '../lib/mediaAssetsApi'
import { formatRequestError } from '../lib/apiClient'

function emptyAsset() {
  return {
    id: '',
    title: '',
    url: '',
    altText: '',
    caption: '',
    credit: '',
    mediaType: 'image',
  }
}

export function MediaAssetManagerCard({ onPick }) {
  const [items, setItems] = useState([])
  const [form, setForm] = useState(emptyAsset())
  const [state, setState] = useState('loading')
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')

  async function reload() {
    try {
      setState('loading')
      setError('')
      const result = await fetchMediaAssets()
      const next = Array.isArray(result?.items) ? result.items : []
      setItems(next)
      setState(next.length ? 'loaded' : 'empty')
    } catch (err) {
      setError(formatRequestError(err, 'media asset load failed'))
      setState('error')
    }
  }

  useEffect(() => {
    reload()
  }, [])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((item) =>
      [item.title, item.url, item.altText, item.caption, item.credit].join(' ').toLowerCase().includes(q)
    )
  }, [items, query])

  async function handleSave() {
    try {
      setState('saving')
      setError('')
      await saveMediaAsset(form)
      setForm(emptyAsset())
      await reload()
    } catch (err) {
      setError(formatRequestError(err, 'media asset save failed'))
      setState(items.length ? 'loaded' : 'error')
    }
  }

  async function handleDelete(id) {
    try {
      setState('deleting')
      setError('')
      await removeMediaAsset(id)
      await reload()
    } catch (err) {
      setError(formatRequestError(err, 'media asset delete failed'))
      setState(items.length ? 'loaded' : 'error')
    }
  }

  return (
    <section className="media-asset-card">
      <div className="media-asset-card__header">
        <div className="media-asset-card__eyebrow">media / assets / registry</div>
        <h3>Media Assets</h3>
        <p>Register reusable images and pick them into native content blocks. This is the first real asset layer, because apparently URLs needed adult supervision.</p>
      </div>

      <div className="media-asset-card__grid">
        <label className="archive-control">
          <span>title</span>
          <input type="text" value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} />
        </label>

        <label className="archive-control">
          <span>url</span>
          <input type="text" value={form.url} onChange={(e) => setForm((p) => ({ ...p, url: e.target.value }))} />
        </label>

        <label className="archive-control">
          <span>media type</span>
          <select value={form.mediaType} onChange={(e) => setForm((p) => ({ ...p, mediaType: e.target.value }))}>
            <option value="image">image</option>
            <option value="audio">audio</option>
            <option value="video">video</option>
            <option value="document">document</option>
          </select>
        </label>

        <label className="archive-control">
          <span>alt text</span>
          <input type="text" value={form.altText} onChange={(e) => setForm((p) => ({ ...p, altText: e.target.value }))} />
        </label>
      </div>

      <label className="archive-control">
        <span>caption</span>
        <textarea className="review-override-builder__textarea" value={form.caption} onChange={(e) => setForm((p) => ({ ...p, caption: e.target.value }))} />
      </label>

      <label className="archive-control">
        <span>credit</span>
        <input type="text" value={form.credit} onChange={(e) => setForm((p) => ({ ...p, credit: e.target.value }))} />
      </label>

      <div className="review-card__actions">
        <button className="button button--primary" type="button" onClick={handleSave}>save asset</button>
        <button className="button" type="button" onClick={() => setForm(emptyAsset())}>clear</button>
        <button className="button" type="button" onClick={reload}>reload</button>
      </div>

      <label className="archive-control">
        <span>search assets</span>
        <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>

      {error ? <p className="review-card__excerpt">{error}</p> : null}
      <p className="review-card__excerpt">status: {state}</p>

      <div className="media-asset-list">
        {visible.map((item) => (
          <article className="media-asset-item" key={item.id}>
            <div className="media-asset-item__thumb">
              {item.mediaType === 'image' ? <img src={item.url} alt={item.altText || item.title || ''} /> : <span>{item.mediaType}</span>}
            </div>
            <div className="media-asset-item__body">
              <strong>{item.title || item.url}</strong>
              <p>{item.caption || item.altText || item.credit || item.url}</p>
              <div className="review-card__actions">
                <button className="button button--primary" type="button" onClick={() => onPick?.(item)}>use asset</button>
                <button className="button" type="button" onClick={() => setForm(item)}>edit</button>
                <button className="button" type="button" onClick={() => handleDelete(item.id)}>delete</button>
              </div>
            </div>
          </article>
        ))}
        {!visible.length && state !== 'loading' ? <p className="review-card__excerpt">No media assets yet.</p> : null}
      </div>
    </section>
  )
}
