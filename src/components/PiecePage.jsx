import { Link, useParams } from 'react-router-dom'
import { getPieceBySlug } from '../lib/pieces'
import { useResolvedConfig } from '../lib/useResolvedConfig'
import { renderConfiguredText } from '../lib/publicConfig'
import { buildPublicSitePath, usePublicSiteBasePath } from '../lib/publicSiteRouting'

export function PiecePage() {
  const { slug } = useParams()
  const siteBasePath = usePublicSiteBasePath()
  const piece = getPieceBySlug(slug)
  const resolvedConfig = useResolvedConfig()

  if (!piece) {
    return (
      <main className="page piece-page missing">
        <section className="missing-state">
          <h1>Missing piece</h1>
          <p>That piece slug does not exist. A beautiful little void.</p>
          <Link className="button button--primary" to={buildPublicSitePath(siteBasePath, '/')}>Back home</Link>
        </section>
      </main>
    )
  }

  return (
    <main className="page piece-page">
      <nav className="mode-toggle">
        <Link to={buildPublicSitePath(siteBasePath, '/')}>back home</Link>
      </nav>

      <header className="piece-header">
        <div className="piece-header__eyebrow">{piece.eyebrow}</div>
        <h1>{piece.title}</h1>
        <p className="piece-header__subtitle">{piece.subtitle || piece.excerpt}</p>
      </header>

      <section className="piece-layout piece-layout--reading">
        <article className="piece-body-wrap">
          {renderConfiguredText(resolvedConfig, `pieces.body.${piece.slug}`, piece.body || []).map((node, idx) => (
            <p key={idx}>{node}</p>
          ))}
        </article>
      </section>
    </main>
  )
}
