export function getFeaturedProjects(projects = []) {
  const list = Array.isArray(projects) ? projects : []
  const featured = list.filter((project) => project?.featured)
  return featured.length ? featured : list.slice(0, 3)
}

export function isFeaturedProject(project) {
  return Boolean(project?.featured)
}
