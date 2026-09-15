import { api as contentApi } from '../utils/api.js';
export async function safeJson(res) {
  try {
    return await res.json()
  } catch {
    return null
  }
}

export function getErrorMessage(data, fallback) {
  return data?.errorInfo?.message || data?.error || fallback
}

export function getDataPayload(data) {
  if (data && typeof data === 'object' && data.data && typeof data.data === 'object') {
    return data.data
  }
  return data
}

export function formatRequestError(error, fallback = 'Request failed') {
  if (!error) return fallback
  if (typeof error === 'string') return error

  return (
    error?.message ||
    error?.info?.message ||
    error?.payload?.errorInfo?.message ||
    error?.payload?.error ||
    fallback
  )
}

export function requireOk(data, res, fallback) {
  if (!res.ok || !data?.ok) {
    const error = new Error(getErrorMessage(data, fallback))
    error.status = res.status
    error.info = data?.errorInfo || null
    error.payload = data || null
    throw error
  }
  return data
}

export async function requestJson(input, init = {}, fallback = 'Request failed') {
  if (typeof input === 'string' && /^\/api\/orgs\//.test(input)) return contentApi(input, init)
  const res = await fetch(input, init)
  const data = await safeJson(res)
  requireOk(data, res, `${fallback}: ${res.status}`)
  return data
}
