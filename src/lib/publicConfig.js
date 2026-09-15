export function getConfiguredText(config, path, fallback = '') {
  const value = getPath(config, path)
  if (value == null || value === '') return fallback
  return value
}

export function renderConfiguredText(config, path, fallback = []) {
  const value = getConfiguredText(config, path, fallback)
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    return value.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean)
  }
  return Array.isArray(fallback) ? fallback : [String(fallback || '')].filter(Boolean)
}

function getPath(obj, path) {
  if (!obj || !path) return undefined
  return String(path).split('.').reduce((acc, key) => {
    return acc && Object.prototype.hasOwnProperty.call(acc, key) ? acc[key] : undefined
  }, obj)
}
