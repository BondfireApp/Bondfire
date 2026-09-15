import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useResolvedConfig } from '../lib/useResolvedConfig'
import { getConfiguredText } from '../lib/publicConfig'
import { buildPublicSitePath, usePublicSiteBasePath } from '../lib/publicSiteRouting'
import { getFeaturedProjects } from '../lib/projectFeatured'

export function ProjectsIndexPage() {
  const siteBasePath = usePublicSiteBasePath()
  const resolvedConfig = useResolvedConfig()
  const projects = useMemo(() => getFeaturedProjects(), [])

  const eyebrow = getConfiguredText(resolvedConfig, 'projects.hero.eyebrow', 'selected / practice / sabotage')
  const title = getConfiguredText(resolvedConfig, 'projects.hero.title', 'Projects')
  const description = getConfiguredText(
    resolvedConfig,
    'projects.hero.description',
    'A compact index of work, experiments, and systems. This public route is stable enough to survive a slug and eventually a custom domain.'
  )

  return (
    <main className="page projects-page">
      <section className="project-hero">
        <div className="project-hero__eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p className="project-hero__description">{description}</p>
      </section>

      <section className="project-grid">
        {projects.map((project) => (
          <article className="project-card" key={project.slug}>
            <div className="project-card__eyebrow">{project.eyebrow}</div>
            <h2>
              <Link to={buildPublicSitePath(siteBasePath, `/projects/${project.slug}`)}>{project.title}</Link>
            </h2>
            <p>{project.excerpt}</p>
          </article>
        ))}
      </section>
    </main>
  )
}
