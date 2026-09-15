import { getSavedAdminToken } from './publicConfigApi'
import { requestJson, getDataPayload } from './apiClient'

function authHeaders() {
  const token = getSavedAdminToken()
  if (!token) return {}
  return {
    authorization: `Bearer ${token}`,
    'x-sabot-admin-token': token,
  }
}

export async function fetchNativeSources(nativeContentId) {
  const url = new URL('/api/native-content-sources', window.location.origin)
  url.searchParams.set('nativeContentId', nativeContentId)

  const data = await requestJson(url.pathname + url.search, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      ...authHeaders(),
    },
  }, 'native sources fetch failed')

  return {
    raw: data,
    payload: getDataPayload(data),
    items: data?.items || data?.data?.items || [],
  }
}

export async function saveNativeSource(record) {
  const data = await requestJson('/api/native-content-sources', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify({ record }),
  }, 'native source save failed')

  return {
    raw: data,
    payload: getDataPayload(data),
    record: data?.record || data?.data?.record || null,
  }
}

export async function removeNativeSource(id) {
  const url = new URL('/api/native-content-sources', window.location.origin)
  url.searchParams.set('id', id)

  const data = await requestJson(url.pathname + url.search, {
    method: 'DELETE',
    headers: {
      accept: 'application/json',
      ...authHeaders(),
    },
  }, 'native source delete failed')

  return {
    raw: data,
    payload: getDataPayload(data),
    deleted: data?.deleted || data?.data?.deleted || null,
  }
}
