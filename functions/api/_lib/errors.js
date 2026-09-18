export class ApiError extends Error {
  constructor(message, options = {}) {
    super(String(message || 'Unexpected error'))
    this.name = 'ApiError'
    this.status = Number(options.status || 500)
    this.code = String(options.code || 'API_ERROR')
    this.details = options.details ?? null
    this.expose = options.expose !== false
    this.cause = options.cause
  }
}

export function badRequest(message, options = {}) {
  return new ApiError(message, {
    status: 400,
    code: 'BAD_REQUEST',
    ...options,
  })
}

export function unauthorized(message = 'Unauthorized', options = {}) {
  return new ApiError(message, {
    status: 401,
    code: 'UNAUTHORIZED',
    ...options,
  })
}

export function forbidden(message = 'Forbidden', options = {}) {
  return new ApiError(message, {
    status: 403,
    code: 'FORBIDDEN',
    ...options,
  })
}

export function notFound(message = 'Not found', options = {}) {
  return new ApiError(message, {
    status: 404,
    code: 'NOT_FOUND',
    ...options,
  })
}

export function methodNotAllowed(message = 'Method not allowed', options = {}) {
  return new ApiError(message, {
    status: 405,
    code: 'METHOD_NOT_ALLOWED',
    ...options,
  })
}

export function dbUnavailable(message = 'Database unavailable', options = {}) {
  return new ApiError(message, {
    status: 503,
    code: 'DB_UNAVAILABLE',
    ...options,
  })
}

export function normalizeError(error, fallback = {}) {
  if (error instanceof ApiError) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
      details: error.details ?? null,
      expose: error.expose !== false,
      cause: error.cause,
    }
  }

  return {
    status: Number(fallback.status || 500),
    code: String(fallback.code || 'INTERNAL_ERROR'),
    message: String(error?.message || fallback.message || 'Unexpected error'),
    details: fallback.details ?? null,
    expose: fallback.expose !== false,
    cause: error,
  }
}
