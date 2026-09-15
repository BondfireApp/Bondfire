const API_URL = '/api/public-site-domains'

async function readJson(response) {
  return response.json().catch(() => ({}))
}

export async function fetchPublicSiteDomainState() {
  const response = await fetch(API_URL, {
    method: 'GET',
    credentials: 'include',
  })

  const data = await readJson(response)

  if (!response.ok) {
    throw new Error(data?.error || 'Failed to load public site domain state')
  }

  return {
    state: data?.state || null,
    canEdit: Boolean(data?.canEdit),
    authMode: data?.authMode || '',
    authReason: data?.authReason || '',
    mode: data?.mode || 'scaffold',
    note: data?.note || '',
  }
}

export async function savePublicSiteDomainState(payload) {
  const response = await fetch(API_URL, {
    method: 'PUT',
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload || {}),
  })

  const data = await readJson(response)

  if (!response.ok) {
    throw new Error(data?.error || 'Failed to save public site domain state')
  }

  return {
    state: data?.state || null,
    canEdit: Boolean(data?.canEdit),
    authMode: data?.authMode || '',
    authReason: data?.authReason || '',
    mode: data?.mode || 'scaffold',
    note: data?.note || '',
  }
}
