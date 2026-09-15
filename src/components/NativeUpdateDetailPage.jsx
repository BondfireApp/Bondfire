import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { fetchNativeEntries } from '../lib/nativePublicContentApi'
import { useResolvedConfig } from '../lib/useResolvedConfig'
import { getConfiguredText } from '../lib/publicConfig'
import { buildPublicSitePath, usePublicSiteBasePath } from '../lib/publicSiteRouting'

function renderRichBlock(block) {
  if (!block) return null

  if (block.type === 'heading') {
    return <h2 key={block.id}>{block.text}</h2>
  }

  if (block.type === 'quote') {
    return <blockquote key={block.id}><p>{block.text}</p></blockquote>
  }

  if (block.type === 'image') {
    return (
      <figure key={block.id}>
        {block.url ? <img src={block.url} alt={block.alt || ''} /> : null}
        {block.caption ? <figcaption>{block.caption}</figcaption> : null}
      </figure>
    )
  }

  if (block.type === 'embed') {
    return (
      <div key={block.id} className="native-update-embed">
        <p><a href={block.url} target="_blank" rel="noreferrer">{block.url}</a></p>
        {block.caption ? <p>{block.caption}</p> : null}
      </div>
    )
  }

  return <p key={block.id}>{block.text}</p>
}

export function NativeUpdateDetailPage() {
  const siteBasePath = usePublicSiteBasePath()
  const { slug } = useParams()
  const resolvedConfig = useResolvedConfig()
  const [item, setItem] = useState(null)
  const [state, setState] = useState('loading')
  const [error, setError] = useState('')

  const notFoundTitle = getConfiguredText(resolvedConfig, 'nativeUpdates.notFoundTitle', 'Update not found')
  const notFoundBody = getConfiguredText(resolvedConfig, 'nativeUpdates.notFoundBody', 'That native published entry does not exist or is not publicly available.')
  const backLabel = getConfiguredText(resolvedConfig, 'nativeUpdates.backLabel', 'back to updates')

  useEffect(() => {
    let cancelled = false

    async function boot() {
      try {
        setState('loading')
        setError('')
        const data = await fetchNativeEntries({ slug })
        const next = data?.item || null
        if (cancelled) return

        if (!next || next.status !== 'published') {
          setItem(null)
          setState('loaded')
          return
        }

        setItem(next)
        setState('loaded')
      } catch (err) {
        if (cancelled) return
        setError(String(err?.message || err))
        setState('error')
      }
    }

    boot()
    return () => {
      cancelled = true
    }
  }, [slug])

  if (state === 'error') {
    return (
      <main className="page native-update-detail-page">
        <section className="missing-state">
          <h1>{notFoundTitle}</h1>
          <p>{error || notFoundBody}</p>
          <Link className="button button--primary" to={buildPublicSitePath(siteBasePath, '/updates')}>{backLabel}</Link>
        </section>
      </main>
    )
  }

  if (!item) {
    return (
      <main className="page native-update-detail-page">
        <section className="missing-state">
          <h1>{notFoundTitle}</h1>
          <p>{notFoundBody}</p>
          <Link className="button button--primary" to={buildPublicSitePath(siteBasePath, '/updates')}>{backLabel}</Link>
        </section>
      </main>
    )
  }

  return (
    <main className="page native-update-detail-page">
      <header className="piece-header">
        <div className="piece-header__eyebrow">native / published / {item.target}</div>
        <h1>{item.title || item.slug}</h1>
        {item.excerpt ? <p className="piece-header__subtitle">{item.excerpt}</p> : null}
        <div className="piece-header__meta">
          <span>{item.contentType}</span>
          <span>{item.status}</span>
          <span>{item.publishedAt || item.updatedAt}</span>
          {item.author ? <span>by {item.author}</span> : null}
        </div>
        <nav className="mode-toggle">
          <Link to={buildPublicSitePath(siteBasePath, '/updates')}>{backLabel}</Link>
        </nav>
      </header>

      <section className="piece-layout piece-layout--reading piece-layout--with-meta">
        <article className="piece-body-wrap">
          {Array.isArray(item.richBody) && item.richBody.length
            ? item.richBody.map(renderRichBlock)
            : item.body
              ? item.body.split('\n').filter(Boolean).map((para, idx) => <p key={idx}>{para}</p>)
              : <p>No body content yet.</p>}
        </article>

        <aside className="piece-meta-panel">
          <div className="piece-meta-panel__section">
            <div className="piece-meta-panel__label">target</div>
            <p>{item.target}</p>
          </div>

          <div className="piece-meta-panel__section">
            <div className="piece-meta-panel__label">type</div>
            <p>{item.contentType}</p>
          </div>

          <div className="piece-meta-panel__section">
            <div className="piece-meta-panel__label">status</div>
            <p>{item.status}</p>
          </div>

          {item.tags?.length ? (
            <div className="piece-meta-panel__section">
              <div className="piece-meta-panel__label">tags</div>
              <div className="piece-tag-list">
                {item.tags.map((tag) => (
                  <span className="piece-tag" key={tag}>{tag}</span>
                ))}
              </div>
            </div>
          ) : null}
        </aside>
      </section>
    </main>
  )
}
