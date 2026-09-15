import { normalizeError } from './errors.js'

export function hasDb(context) {
  return Boolean(context?.env?.BF_DB)
}

export async function ensureDb(context) {
  if (!hasDb(context)) return null
  const { runAppMigrations, APP_SCHEMA_VERSION } = await import('./migrations.js')
  const result = await runAppMigrations(context.env.BF_DB)
  context.__appSchema = {
    version: APP_SCHEMA_VERSION,
    applied: result.applied,
    migrations: result.migrations,
  }
  return context.env.BF_DB
}

export function jsonOk(payload = {}, options = {}) {
  const status = Number(options.status || 200)
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...(options.headers || {}),
  }

  return new Response(
    JSON.stringify(
      {
        ok: true,
        ...payload,
      },
      null,
      2
    ),
    { status, headers }
  )
}

export function jsonError(error, options = {}) {
  const normalized = normalizeError(error, options)
  const status = Number(options.status || normalized.status || 500)
  const message = normalized.expose === false ? 'Internal server error' : normalized.message

  return new Response(
    JSON.stringify(
      {
        ok: false,
        error: message,
        errorInfo: {
          code: normalized.code,
          message,
          status,
          details: normalized.details ?? null,
        },
        ...(options.payload || {}),
      },
      null,
      2
    ),
    {
      status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        ...(options.headers || {}),
      },
    }
  )
}

export async function parseJsonBody(request) {
  const contentType = request.headers.get('content-type') || ''
  if (!contentType.toLowerCase().includes('application/json')) {
    return {}
  }

  try {
    return await request.json()
  } catch {
    return {}
  }
}

export async function withApiHandler(handler, options = {}) {
  try {
    return await handler()
  } catch (error) {
    return jsonError(error, options)
  }
}
