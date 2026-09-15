import { useEffect, useMemo, useState } from 'react'
import { fetchPublicSiteDomainState, savePublicSiteDomainState } from '../lib/publicSiteDomainsApi'

function DomainRow({ domain, onPrimary, onVerify, onRemove, onCopy, busy, disabled }) {
  return (
    <article className="admin-card">
      <div className="admin-card__eyebrow">mapped domain</div>
      <h2>{domain.hostname}</h2>
      <p>
        status: {domain.verificationStatus}
        {domain.isPrimary ? ' · primary' : ''}
      </p>
      <p style={{ wordBreak: 'break-all' }}>
        verification token: {domain.verificationToken || 'pending generation'}
      </p>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        {domain.verificationToken ? (
          <button className="button" type="button" onClick={() => onCopy(domain.verificationToken, `verification token for ${domain.hostname}`)}>
            copy token
          </button>
        ) : null}
        {!domain.isPrimary ? (
          <button className="button button--primary" type="button" onClick={() => onPrimary(domain.hostname)} disabled={busy || disabled}>
            make primary
          </button>
        ) : null}
        {domain.verificationStatus !== 'verified' ? (
          <button className="button" type="button" onClick={() => onVerify(domain.hostname)} disabled={busy || disabled}>
            mark verified
          </button>
        ) : null}
        <button className="button" type="button" onClick={() => onRemove(domain.hostname)} disabled={busy || disabled}>
          remove
        </button>
      </div>
    </article>
  )
}

function toHttpsUrl(hostname) {
  const value = String(hostname || '').trim()
  if (!value) return ''
  if (/^https?:\/\//i.test(value)) return value
  return `https://${value}`
}

function getPublicSiteStatus({ mode, state, publicSlug }) {
  const domains = state?.domains || []
  const primary = domains.find((domain) => domain.isPrimary) || null

  if (mode === 'scaffold') {
    return 'Scaffold mode only: preview URLs are local placeholders until BF_DB is bound.'
  }

  if (!String(publicSlug || '').trim()) {
    return 'Site slug is not set yet.'
  }

  if (!primary) {
    return 'Slug preview is ready. No primary custom domain is configured yet.'
  }

  if (primary.verificationStatus === 'verified') {
    return `Slug preview is ready. Primary custom domain ${primary.hostname} is marked verified.`
  }

  return `Slug preview is ready. Primary custom domain ${primary.hostname} still needs verification and external DNS/binding setup.`
}

export function PublicDomainCard({ slug = '' }) {
  const [state, setState] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [newDomain, setNewDomain] = useState('')
  const [canEdit, setCanEdit] = useState(false)
  const [mode, setMode] = useState('')
  const [note, setNote] = useState('')

  async function refresh() {
    try {
      setLoading(true)
      setError('')
      const result = await fetchPublicSiteDomainState()
      setState(result.state)
      setCanEdit(result.canEdit)
      setMode(result.mode || 'scaffold')
      setNote(result.note || result.authReason || '')
    } catch (err) {
      setError(String(err?.message || err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  const resolvedSlug = useMemo(() => {
    const fromProp = String(slug || '').trim()
    if (fromProp) return fromProp
    return String(state?.siteSlug || '').trim()
  }, [slug, state?.siteSlug])

  async function save(payload) {
    try {
      setSaving(true)
      setError('')
      const result = await savePublicSiteDomainState({
        ...(payload || {}),
        siteSlug: resolvedSlug || undefined,
      })
      setState(result.state)
      setCanEdit(result.canEdit)
      setMode(result.mode || 'scaffold')
      setNote(result.note || result.authReason || '')
      setNewDomain('')
    } catch (err) {
      setError(String(err?.message || err))
    } finally {
      setSaving(false)
    }
  }

  async function copyText(value, label) {
    if (!value) {
      setError(`No ${label} available to copy.`)
      return
    }

    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value)
        return
      }

      const input = document.createElement('textarea')
      input.value = value
      input.setAttribute('readonly', '')
      input.style.position = 'absolute'
      input.style.left = '-9999px'
      document.body.appendChild(input)
      input.select()
      document.execCommand('copy')
      document.body.removeChild(input)
    } catch (err) {
      setError(`Failed to copy ${label}: ${String(err?.message || err)}`)
    }
  }

  const generatedPublicUrl = useMemo(() => {
    if (!resolvedSlug) return ''
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    if (!origin) return `/#/p/${resolvedSlug}`
    return `${origin}/#/p/${resolvedSlug}`
  }, [resolvedSlug])
  const previewUrlReady = Boolean(generatedPublicUrl)
  const urlActionDisabled = loading || saving || !previewUrlReady
  const primaryDomain = useMemo(() => state?.domains?.find((domain) => domain.isPrimary) || null, [state])
  const primaryCustomDomainUrl = useMemo(() => toHttpsUrl(primaryDomain?.hostname), [primaryDomain])
  const statusText = useMemo(() => getPublicSiteStatus({ mode, state, publicSlug: resolvedSlug }), [mode, state, resolvedSlug])
  const previewStatusMessage = useMemo(() => {
    if (loading) return 'Loading public preview URL…'
    if (saving) return 'Saving public settings…'
    if (!String(resolvedSlug || '').trim()) return 'Preview URL unavailable: save a public site slug to generate it.'
    if (!previewUrlReady) return 'Preview URL unavailable: public route could not be resolved from current state.'
    return ''
  }, [loading, saving, resolvedSlug, previewUrlReady])

  return (
    <>
      <section className="admin-card">
        <div className="admin-card__eyebrow">public domain setup</div>
        <h2>Slug and domain routing</h2>
        <p>
          Custom domain mapping is supplemental to your Public Page settings slug. Verification tokens in this UI reflect repo-side proof state only.
        </p>
        <p>
          Real DNS records and deployment host binding must be configured in your DNS/deployment providers outside this repo. This screen does not perform automatic DNS verification.
        </p>

        {mode === 'scaffold' ? <p>Running in scaffold mode (BF_DB not bound).</p> : null}
        {note ? <p>{note}</p> : null}
        {!canEdit ? <p>You do not currently have edit permission for this route.</p> : null}
        {error ? <p className="review-card__excerpt">{error}</p> : null}

        <p><strong>Current public site status:</strong> {statusText}</p>

        <p><strong>Live public slug:</strong> {resolvedSlug || 'not set'}</p>

        {previewUrlReady ? (
          <>
            <p style={{ wordBreak: 'break-all' }}>generated public URL: {generatedPublicUrl}</p>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <a
                className={`button button--primary${urlActionDisabled ? ' button--disabled' : ''}`}
                href={generatedPublicUrl}
                target="_blank"
                rel="noreferrer"
                aria-disabled={urlActionDisabled}
                onClick={(event) => {
                  if (urlActionDisabled) event.preventDefault()
                }}
              >
                {saving ? 'saving…' : loading ? 'loading…' : 'open preview'}
              </a>
              <button
                className="button"
                type="button"
                onClick={() => copyText(generatedPublicUrl, 'generated public URL')}
                disabled={urlActionDisabled}
              >
                {saving ? 'saving…' : loading ? 'loading…' : 'copy generated URL'}
              </button>
            </div>
          </>
        ) : (
          <p>{previewStatusMessage}</p>
        )}

        {primaryCustomDomainUrl ? (
          <>
            <p style={{ wordBreak: 'break-all' }}>primary custom domain URL: {primaryCustomDomainUrl}</p>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <button className="button" type="button" onClick={() => copyText(primaryCustomDomainUrl, 'primary custom domain URL')}>
                copy primary domain URL
              </button>
            </div>
          </>
        ) : (
          <p>primary custom domain URL: none set yet</p>
        )}

        <div className="archive-controls">
          <label className="archive-control">
            <span>add custom domain</span>
            <input value={newDomain} onChange={(event) => setNewDomain(event.target.value)} placeholder="example.com" />
          </label>
          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button className="button button--primary" type="button" onClick={() => save({ newDomain })} disabled={saving || loading || !newDomain.trim() || !canEdit}>
              add domain
            </button>
          </div>
        </div>
      </section>

      <section className="admin-grid">
        {loading ? <article className="admin-card"><p>loading domains…</p></article> : null}
        {!loading && !state?.domains?.length ? (
          <article className="admin-card">
            <div className="admin-card__eyebrow">mapped domains</div>
            <h2>none yet</h2>
            <p>No custom domains are mapped yet.</p>
          </article>
        ) : null}
        {!loading && state?.domains?.map((domain) => (
          <DomainRow
            key={domain.hostname}
            domain={domain}
            onPrimary={(hostname) => save({ setPrimaryHostname: hostname })}
            onVerify={(hostname) => save({ setVerifiedHostname: hostname, verificationStatus: 'verified' })}
            onRemove={(hostname) => save({ removeHostname: hostname })}
            onCopy={copyText}
            busy={saving}
            disabled={!canEdit}
          />
        ))}
      </section>
    </>
  )
}
