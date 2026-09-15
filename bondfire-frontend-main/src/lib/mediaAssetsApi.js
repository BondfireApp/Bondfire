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

export async function fetchMediaAssets(params = {}) {
  const url = new URL('/api/media-assets', window.location.origin)

  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== '') {
      url.searchParams.set(key, String(value))
    }
  }

  const data = await requestJson(url.pathname + url.search, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      ...authHeaders(),
    },
  }, 'media fetch failed')

  return {
    raw: data,
    payload: getDataPayload(data),
    items: data?.items || data?.data?.items || [],
  }
}

export async function saveMediaAsset(asset) {
  const data = await requestJson('/api/media-assets', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify({ asset }),
  }, 'media save failed')

  return {
    raw: data,
    payload: getDataPayload(data),
    asset: data?.asset || data?.data?.asset || null,
  }
}

export async function removeMediaAsset(id) {
  const url = new URL('/api/media-assets', window.location.origin)
  url.searchParams.set('id', id)

  const data = await requestJson(url.pathname + url.search, {
    method: 'DELETE',
    headers: {
      accept: 'application/json',
      ...authHeaders(),
    },
  }, 'media delete failed')

  return {
    raw: data,
    payload: getDataPayload(data),
    deleted: data?.deleted || data?.data?.deleted || null,
  }
}
