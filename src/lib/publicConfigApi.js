const ADMIN_TOKEN_KEY = 'bondfire-public-admin-token'

export function getSavedAdminToken() {
  try { return window.localStorage.getItem(ADMIN_TOKEN_KEY) || '' } catch { return '' }
}

export function saveAdminToken(token) {
  try { window.localStorage.setItem(ADMIN_TOKEN_KEY, String(token || '')) } catch {}
}

export function clearSavedAdminToken() {
  try { window.localStorage.removeItem(ADMIN_TOKEN_KEY) } catch {}
}
