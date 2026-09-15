import { getSavedAdminToken } from './publicConfigApi'
import { requestJson, getDataPayload } from './apiClient'

function buildAuthHeaders() {
  const token = getSavedAdminToken()
  if (!token) return {}
  return {
    authorization: `Bearer ${token}`,
    'x-sabot-admin-token': token,
  }
}

export async function fetchNativeEntries(params = {}) {
  const url = new URL('/api/native-content', window.location.origin)

  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== '') {
      url.searchParams.set(key, String(value))
    }
  }

  const data = await requestJson(url.pathname + url.search, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      ...buildAuthHeaders(),
    },
  }, 'native content fetch failed')

  return {
    raw: data,
    payload: getDataPayload(data),
    items: data?.items || data?.data?.items || [],
    item: data?.item || data?.data?.item || null,
  }
}

export async function saveNativeEntry(item, revisionNote = 'save') {
  const data = await requestJson('/api/native-content', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...buildAuthHeaders(),
    },
    body: JSON.stringify({ item, revisionNote }),
  }, 'native content save failed')

  return {
    raw: data,
    payload: getDataPayload(data),
    item: data?.item || data?.data?.item || null,
  }
}

export async function removeNativeEntry(idOrSlug) {
  const url = new URL('/api/native-content', window.location.origin)
  url.searchParams.set('id', idOrSlug)

  const data = await requestJson(url.pathname + url.search, {
    method: 'DELETE',
    headers: {
      accept: 'application/json',
      ...buildAuthHeaders(),
    },
  }, 'native content delete failed')

  return {
    raw: data,
    payload: getDataPayload(data),
    deleted: data?.deleted || data?.data?.deleted || null,
  }
}

export async function fetchNativeRevisions(params = {}) {
  const url = new URL('/api/native-content-revisions', window.location.origin)

  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== '') {
      url.searchParams.set(key, String(value))
    }
  }

  const data = await requestJson(url.pathname + url.search, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      ...buildAuthHeaders(),
    },
  }, 'native revisions fetch failed')

  return {
    raw: data,
    payload: getDataPayload(data),
    items: data?.items || data?.data?.items || [],
  }
}

export async function restoreNativeRevision(revisionId) {
  const data = await requestJson('/api/native-content-revisions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...buildAuthHeaders(),
    },
    body: JSON.stringify({ revisionId }),
  }, 'native revision restore failed')

  return {
    raw: data,
    payload: getDataPayload(data),
    item: data?.item || data?.data?.item || null,
  }
}
