import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { fetchPublicSiteDomainState, savePublicSiteDomainState } from '../lib/publicSiteDomainsApi'

function toHttpsUrl(hostname) {
  const value = String(hostname || '').trim()
  return value ? `https://${value}` : ''
}

function CopyButton({ value, label, onError }) {
  if (!value) return null
  return (
    <button
      className="btn"
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
        } catch (error) {
          onError?.(`Could not copy ${label}: ${String(error?.message || error)}`)
        }
      }}
    >
      Copy {label}
    </button>
  )
}

function DnsRecord({ record, onError }) {
  return (
    <div className="card" style={{ padding: 10, background: 'rgba(255,255,255,0.025)' }}>
      <div className="helper">{record.type || 'DNS'} record</div>
      <div style={{ marginTop: 4, overflowWrap: 'anywhere' }}><strong>Name:</strong> <code>{record.name}</code></div>
      <div style={{ marginTop: 4, overflowWrap: 'anywhere' }}><strong>Value:</strong> <code>{record.value}</code></div>
      <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <CopyButton value={record.name} label="name" onError={onError} />
        <CopyButton value={record.value} label="value" onError={onError} />
      </div>
    </div>
  )
}

function DomainRow({ domain, providerTarget, onPrimary, onVerify, onRemove, busy, onError }) {
  const provider = domain.provider || {}
  const ownership = provider.ownershipVerification
  const certificate = Array.isArray(provider.certificateValidation) ? provider.certificateValidation : []
  const isReady = domain.verificationStatus === 'verified' && provider.active

  return (
    <article className="card" style={{ padding: 14 }}>
      <div className="helper">custom domain</div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h3 style={{ margin: '4px 0' }}>{domain.hostname}</h3>
        <span className="helper">{isReady ? 'Live' : `Setup: ${provider.status || domain.verificationStatus}`}{domain.isPrimary ? ' · primary' : ''}</span>
      </div>

      {providerTarget ? (
        <div className="card" style={{ padding: 10, marginTop: 10, background: 'rgba(255,255,255,0.025)' }}>
          <div className="helper">Traffic record</div>
          <p style={{ margin: '6px 0' }}>
            Point <code>{domain.hostname}</code> to <code>{providerTarget}</code> using a CNAME, ALIAS, ANAME, or your DNS provider&apos;s apex-flattening equivalent.
          </p>
          <CopyButton value={providerTarget} label="target" onError={onError} />
        </div>
      ) : null}

      {ownership ? <DnsRecord record={ownership} onError={onError} /> : null}
      {certificate.map((record, index) => <DnsRecord key={`${record.name}-${index}`} record={record} onError={onError} />)}

      {Array.isArray(provider.errors) && provider.errors.length ? (
        <div className="error" style={{ marginTop: 10 }}>{provider.errors.join(' · ')}</div>
      ) : null}

      <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button className="btn" type="button" onClick={() => onVerify(domain.hostname)} disabled={busy}>Check setup</button>
        {!domain.isPrimary ? <button className="btn" type="button" onClick={() => onPrimary(domain.hostname)} disabled={busy || !isReady}>Make primary</button> : null}
        {isReady ? <a className="btn" href={toHttpsUrl(domain.hostname)} target="_blank" rel="noreferrer">Open site</a> : null}
        <button className="btn" type="button" onClick={() => onRemove(domain.hostname)} disabled={busy}>Remove</button>
      </div>
    </article>
  )
}

export function PublicDomainCard({ orgId: orgIdProp, slug = '', surface = 'organization' }) {
  const params = useParams()
  const orgId = String(orgIdProp || params?.orgId || '').trim()
  const [state, setState] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [newDomain, setNewDomain] = useState('')

  async function refresh() {
    if (!orgId) {
      setLoading(false)
      setError('Organization context is unavailable for domain management.')
      return
    }
    try {
      setLoading(true)
      setError('')
      const result = await fetchPublicSiteDomainState(orgId, surface)
      setState(result.state)
    } catch (err) {
      setError(String(err?.message || err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [orgId, surface])

  async function save(payload) {
    if (!orgId) return
    try {
      setSaving(true)
      setError('')
      const result = await savePublicSiteDomainState(orgId, payload, surface)
      setState(result.state)
      setNewDomain('')
    } catch (err) {
      setError(String(err?.message || err))
    } finally {
      setSaving(false)
    }
  }

  const primary = useMemo(() => state?.domains?.find((domain) => domain.isPrimary) || null, [state])
  const surfaceLabel = surface === 'publication' ? 'Publication Site' : 'Organization Page'
  const previewUrl = slug && typeof window !== 'undefined' ? `${window.location.origin}/#/p/${encodeURIComponent(slug)}` : ''

  return (
    <section className="card" style={{ padding: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 12, alignItems: 'start', flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ marginTop: 0 }}>{surfaceLabel} domain</h3>
          <p className="helper" style={{ marginBottom: 0 }}>Bring a domain you already own. Bondfire provisions the hostname and certificate; you only add the DNS records shown here.</p>
        </div>
        {primary?.verificationStatus === 'verified' ? <a className="btn" href={toHttpsUrl(primary.hostname)} target="_blank" rel="noreferrer">Open live domain</a> : null}
      </div>

      {surface === 'organization' && previewUrl ? <p className="helper">Bondfire preview: <a href={previewUrl} target="_blank" rel="noreferrer">{previewUrl}</a></p> : null}
      {error ? <div className="error" style={{ marginTop: 10 }}>{error}</div> : null}

      {!loading && state?.provider && !state.provider.configured ? (
        <div className="error" style={{ marginTop: 10 }}>Managed custom domains are not configured on this Bondfire deployment yet. A platform operator must configure the Cloudflare for SaaS provider once; organizations never need that credential.</div>
      ) : null}

      <div className="row" style={{ gap: 8, marginTop: 12, alignItems: 'end', flexWrap: 'wrap' }}>
        <label className="grid" style={{ gap: 6, flex: '1 1 280px' }}>
          <span className="helper">Domain you own</span>
          <input className="input" value={newDomain} onChange={(event) => setNewDomain(event.target.value)} placeholder="example.org or community.example.org" />
        </label>
        <button className="btn-red" type="button" onClick={() => save({ newDomain })} disabled={saving || loading || !newDomain.trim()}>{saving ? 'Adding…' : 'Add domain'}</button>
        <button className="btn" type="button" onClick={refresh} disabled={saving || loading}>{loading ? 'Loading…' : 'Refresh'}</button>
      </div>

      <div className="grid" style={{ gap: 12, marginTop: 14 }}>
        {!loading && !state?.domains?.length ? <div className="helper">No custom domain connected yet.</div> : null}
        {(state?.domains || []).map((domain) => (
          <DomainRow
            key={domain.hostname}
            domain={domain}
            providerTarget={state?.provider?.cnameTarget || domain?.provider?.cnameTarget || ''}
            onPrimary={(hostname) => save({ setPrimaryHostname: hostname })}
            onVerify={(hostname) => save({ verifyHostname: hostname })}
            onRemove={(hostname) => save({ removeHostname: hostname })}
            busy={saving}
            onError={setError}
          />
        ))}
      </div>
    </section>
  )
}
