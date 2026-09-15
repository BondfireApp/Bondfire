import { Link, useParams } from 'react-router-dom'
import { getProjectBySlug } from '../lib/pieces'
import { renderConfiguredText } from '../lib/publicConfig'
import { useResolvedConfig } from '../lib/useResolvedConfig'
import { buildPublicSitePath, usePublicSiteBasePath } from '../lib/publicSiteRouting'

export function ProjectPage() {
  const { slug } = useParams()
  const siteBasePath = usePublicSiteBasePath()
  const project = getProjectBySlug(slug)
  const resolvedConfig = useResolvedConfig()

  if (!project) {
    return (
      <main className="page project-page missing">
        <section className="missing-state">
          <h1>Missing project</h1>
          <p>That project slug does not exist. Humans love a good broken link.</p>
          <Link className="button button--primary" to={buildPublicSitePath(siteBasePath, '/projects')}>Back to projects</Link>
        </section>
      </main>
    )
  }

  return (
    <main className="page project-page">
      <nav className="mode-toggle">
        <Link to={buildPublicSitePath(siteBasePath, '/projects')}>back to projects</Link>
      </nav>

      <header className="piece-header">
        <div className="piece-header__eyebrow">{project.eyebrow}</div>
        <h1>{project.title}</h1>
        <p className="piece-header__subtitle">{project.subtitle || project.excerpt}</p>
        <div className="piece-header__meta">
          {project.year ? <span>{project.year}</span> : null}
          {project.tags?.length ? <span>{project.tags.join(' · ')}</span> : null}
        </div>
      </header>

      <section className="piece-layout piece-layout--reading">
        <article className="piece-body-wrap">
          {renderConfiguredText(resolvedConfig, `projects.body.${project.slug}`, project.body || []).map((node, idx) => (
            <p key={idx}>{node}</p>
          ))}
        </article>
      </section>
    </main>
  )
}
