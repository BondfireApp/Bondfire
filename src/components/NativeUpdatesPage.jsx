import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchNativeEntries } from '../lib/nativePublicContentApi'
import { useResolvedConfig } from '../lib/useResolvedConfig'
import { getConfiguredText } from '../lib/publicConfig'
import { buildPublicSitePath, usePublicSiteBasePath } from '../lib/publicSiteRouting'
import { EditableText } from './EditableText'

function NativeUpdateCard({ item, siteBasePath }) {
  return (
    <article className="piece-card">
      <div className="piece-card__eyebrow">
        <span>{item.target}</span>
        <span>{item.contentType}</span>
      </div>
      <h3>
        <Link to={buildPublicSitePath(siteBasePath, `/updates/${item.slug}`)}>{item.title || item.slug}</Link>
      </h3>
      {item.excerpt ? <p>{item.excerpt}</p> : null}
      <div className="piece-card__footer">
        <span>{item.publishedAt || item.updatedAt}</span>
      </div>
    </article>
  )
}

export function NativeUpdatesPage() {
  const siteBasePath = usePublicSiteBasePath()
  const resolvedConfig = useResolvedConfig()
  const [items, setItems] = useState([])
  const [state, setState] = useState('loading')
  const [error, setError] = useState('')

  const eyebrow = getConfiguredText(resolvedConfig, 'nativeUpdates.eyebrow', 'native / updates / publishing')
  const title = getConfiguredText(resolvedConfig, 'nativeUpdates.title', 'Updates')
  const description = getConfiguredText(
    resolvedConfig,
    'nativeUpdates.description',
    'Published native entries from inside Sabot. This is the first real public rendering lane for native content.'
  )
  const emptyTitle = getConfiguredText(resolvedConfig, 'nativeUpdates.emptyTitle', 'No published updates yet')
  const emptyBody = getConfiguredText(resolvedConfig, 'nativeUpdates.emptyBody', 'Native publishing exists now, but nothing has been published to the public updates surface yet.')

  useEffect(() => {
    let cancelled = false

    async function boot() {
      try {
        setState('loading')
        setError('')
        const data = await fetchNativeEntries({ status: 'published' })
        if (cancelled) return
        setItems(Array.isArray(data?.items) ? data.items : [])
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
  }, [])

  const homeAndGeneral = useMemo(
    () => items.filter((item) => item.target === 'general' || item.target === 'home' || item.target === 'press' || item.target === 'projects'),
    [items]
  )

  return (
    <main className="page native-updates-page">
      <section className="project-hero">
        <EditableText as="div" className="project-hero__eyebrow" field="nativeUpdates.eyebrow">
          {eyebrow}
        </EditableText>
        <EditableText as="h1" field="nativeUpdates.title">
          {title}
        </EditableText>
        <EditableText as="p" className="project-hero__description" field="nativeUpdates.description">
          {description}
        </EditableText>
        <div className="project-hero__meta">
          <span>{homeAndGeneral.length} published native entries</span>
          <span>status: {state}</span>
        </div>
        {error ? <p className="review-card__excerpt">{error}</p> : null}
      </section>

      {homeAndGeneral.length ? (
        <>
        <section className="archive-results-bar">
          <Link className="button button--primary" to={buildPublicSitePath(siteBasePath, '/search')}>search everything</Link>
        </section>
        <section className="piece-grid">
          {homeAndGeneral.map((item) => (
            <NativeUpdateCard key={item.id} item={item} siteBasePath={siteBasePath} />
          ))}
        </section>
        </>
      ) : (
        <section className="missing-state">
          <h2>{emptyTitle}</h2>
          <p>{emptyBody}</p>
        </section>
      )}
    </main>
  )
}
