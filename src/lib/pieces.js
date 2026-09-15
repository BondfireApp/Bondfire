const pieces = []
const projects = []

export function getAllPieces() { return pieces }
export function getPieces() { return pieces }
export function listPieces() { return pieces }
export function getPieceBySlug(slug) {
  return pieces.find((piece) => piece.slug === slug) || null
}

export function getAllProjects() { return projects }
export function getProjects() { return projects }
export function listProjects() { return projects }
export function getProjectBySlug(slug) {
  return projects.find((project) => project.slug === slug) || null
}

export default pieces
