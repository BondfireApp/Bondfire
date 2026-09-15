import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useResolvedConfig } from '../lib/useResolvedConfig'
import { getConfiguredText } from '../lib/publicConfig'
import { buildPublicSitePath, usePublicSiteBasePath } from '../lib/publicSiteRouting'
import { getFeaturedProjects } from '../lib/projectFeatured'
import { getAllPieces } from '../lib/pieces'

function buildSearchIndex() {
  const projects = getFeaturedProjects().map((item) => ({
    kind: 'project',
    slug: item.slug,
    title: item.title,
    excerpt: item.excerpt || item.subtitle || '',
    path: `/projects/${item.slug}`,
  }))

  const pieces = getAllPieces().map((item) => ({
    kind: 'piece',
    slug: item.slug,
    title: item.title,
    excerpt: item.excerpt || item.subtitle || '',
    path: `/pieces/${item.slug}`,
  }))

  return [...projects, ...pieces]
}

export function PublicSearchPage() {
  const siteBasePath = usePublicSiteBasePath()
  const resolvedConfig = useResolvedConfig()
  const [query, setQuery] = useState('')
  const index = useMemo(() => buildSearchIndex(), [])

  const eyebrow = getConfiguredText(resolvedConfig, 'search.hero.eyebrow', 'public / search / stable enough')
  const title = getConfiguredText(resolvedConfig, 'search.hero.title', 'Search')
  const description = getConfiguredText(
    resolvedConfig,
    'search.hero.description',
    'A simple public search route that respects slug-based site rendering. It is not fancy, but it also is not broken, which already puts it above many systems.'
  )

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return index
    return index.filter((item) => `${item.title} ${item.excerpt}`.toLowerCase().includes(q))
  }, [index, query])

  return (
    <main className="page search-page">
      <section className="project-hero">
        <div className="project-hero__eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p className="project-hero__description">{description}</p>
      </section>

      <section className="archive-results-bar">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="search projects and pieces"
        />
        <span>{results.length} results</span>
      </section>

      <section className="piece-grid">
        {results.map((item) => (
          <article className="piece-card" key={`${item.kind}:${item.slug}`}>
            <div className="piece-card__eyebrow">{item.kind}</div>
            <h2>
              <Link to={buildPublicSitePath(siteBasePath, item.path)}>{item.title}</Link>
            </h2>
            <p>{item.excerpt}</p>
          </article>
        ))}
      </section>
    </main>
  )
}
