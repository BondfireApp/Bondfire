function clean(value) {
  return String(value || '').trim()
}

export function getCustomDomainProviderConfig(env = {}) {
  const apiToken = clean(env.CLOUDFLARE_API_TOKEN || env.CF_API_TOKEN)
  const zoneId = clean(env.CLOUDFLARE_SAAS_ZONE_ID || env.CF_SAAS_ZONE_ID)
  const cnameTarget = clean(env.CLOUDFLARE_SAAS_CNAME_TARGET || env.CF_SAAS_CNAME_TARGET)

  return {
    provider: 'cloudflare-saas',
    configured: Boolean(apiToken && zoneId && cnameTarget),
    apiToken,
    zoneId,
    cnameTarget,
  }
}

async function cfRequest(config, path, options = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${config.apiToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || body?.success === false) {
    const detail = Array.isArray(body?.errors)
      ? body.errors.map((item) => item?.message || item?.code).filter(Boolean).join('; ')
      : ''
    const error = new Error(detail || `Cloudflare request failed (${response.status})`)
    error.status = response.status
    error.providerBody = body
    throw error
  }
  return body?.result ?? null
}

async function listByHostname(config, hostname) {
  const result = await cfRequest(
    config,
    `/zones/${encodeURIComponent(config.zoneId)}/custom_hostnames?hostname=${encodeURIComponent(hostname)}`,
    { method: 'GET' },
  )
  return Array.isArray(result) ? result : []
}

function mapValidationRecords(ssl = {}) {
  const records = Array.isArray(ssl?.validation_records) ? ssl.validation_records : []
  return records.map((record) => ({
    type: String(record?.txt_name ? 'TXT' : record?.cname ? 'CNAME' : record?.type || '').toUpperCase(),
    name: String(record?.txt_name || record?.cname || record?.name || ''),
    value: String(record?.txt_value || record?.cname_target || record?.value || ''),
  })).filter((record) => record.name && record.value)
}

function mapProviderState(config, result) {
  if (!result) {
    return {
      configured: config.configured,
      provider: config.provider,
      found: false,
      cnameTarget: config.cnameTarget,
      status: 'missing',
      sslStatus: 'missing',
      active: false,
      ownershipVerification: null,
      certificateValidation: [],
    }
  }

  const ownership = result?.ownership_verification
  const ownershipVerification = ownership?.name && ownership?.value
    ? { type: String(ownership.type || 'TXT').toUpperCase(), name: ownership.name, value: ownership.value }
    : null
  const status = String(result?.status || 'pending')
  const sslStatus = String(result?.ssl?.status || 'pending')

  return {
    configured: config.configured,
    provider: config.provider,
    found: true,
    providerId: String(result?.id || ''),
    cnameTarget: config.cnameTarget,
    status,
    sslStatus,
    active: status === 'active' && sslStatus === 'active',
    ownershipVerification,
    certificateValidation: mapValidationRecords(result?.ssl),
    errors: Array.isArray(result?.verification_errors) ? result.verification_errors.map(String) : [],
  }
}

export async function getManagedHostnameState(env, hostname) {
  const config = getCustomDomainProviderConfig(env)
  if (!config.configured) {
    return {
      configured: false,
      provider: config.provider,
      found: false,
      cnameTarget: config.cnameTarget,
      status: 'provider_not_configured',
      sslStatus: 'provider_not_configured',
      active: false,
      ownershipVerification: null,
      certificateValidation: [],
      errors: [],
    }
  }

  const matches = await listByHostname(config, hostname)
  return mapProviderState(config, matches[0] || null)
}

export async function provisionManagedHostname(env, hostname) {
  const config = getCustomDomainProviderConfig(env)
  if (!config.configured) {
    const error = new Error('CUSTOM_DOMAIN_PROVIDER_NOT_CONFIGURED')
    error.code = 'CUSTOM_DOMAIN_PROVIDER_NOT_CONFIGURED'
    throw error
  }

  const matches = await listByHostname(config, hostname)
  if (matches.length) return mapProviderState(config, matches[0])

  const created = await cfRequest(
    config,
    `/zones/${encodeURIComponent(config.zoneId)}/custom_hostnames`,
    {
      method: 'POST',
      body: JSON.stringify({
        hostname,
        ssl: {
          method: 'txt',
          type: 'dv',
          bundle_method: 'ubiquitous',
          min_tls_version: '1.2',
        },
      }),
    },
  )

  return mapProviderState(config, created)
}

export async function removeManagedHostname(env, hostname) {
  const config = getCustomDomainProviderConfig(env)
  if (!config.configured) return { configured: false, removed: false }

  const matches = await listByHostname(config, hostname)
  const item = matches[0]
  if (!item?.id) return { configured: true, removed: false }

  await cfRequest(
    config,
    `/zones/${encodeURIComponent(config.zoneId)}/custom_hostnames/${encodeURIComponent(item.id)}`,
    { method: 'DELETE' },
  )
  return { configured: true, removed: true }
}
