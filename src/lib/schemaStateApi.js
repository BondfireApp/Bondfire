import { requestJson, getDataPayload } from './apiClient'

export async function fetchSchemaState() {
  const data = await requestJson('/api/schema-state', {
    method: 'GET',
    headers: {
      accept: 'application/json',
    },
  }, 'schema state fetch failed')

  return {
    raw: data,
    payload: getDataPayload(data),
  }
}
