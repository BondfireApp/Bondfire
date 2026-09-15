import React from 'react';
import { api } from '../utils/api.js';
import { clearAccountDeviceData, emergencyError } from '../lib/emergencyUi.js';

const CONFIRMATION = 'DELETE MY ACCOUNT';

export default function AccountDestructionPanel({ initialOpen = false }) {
  const [open, setOpen] = React.useState(initialOpen);
  const [password, setPassword] = React.useState('');
  const [mfaCode, setMfaCode] = React.useState('');
  const [confirmation, setConfirmation] = React.useState('');
  const [acknowledgeHistoricalLimit, setAcknowledgeHistoricalLimit] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [deleted, setDeleted] = React.useState(false);
  const [blockers, setBlockers] = React.useState([]);

  async function destroyAccount() {
    setBusy(true);
    setError('');
    try {
      await api('/api/auth/destroy-account', {
        method: 'POST',
        body: JSON.stringify({ password, mfaCode, confirmation, acknowledgeHistoricalLimit }),
      });
      setDeleted(true); setPassword(''); setMfaCode('');
      await clearAccountDeviceData();
      window.location.assign('/');
    } catch (err) {
      setError(emergencyError(err));
      setBlockers(Array.isArray(err?.details?.orgs) ? err.details.orgs : []);
      setBusy(false);
    }
  }

  if (deleted) return <section role="status"><h3>Account deleted</h3><p>{error || 'Your active account has been removed.'}</p><a href="#/signin">Return to sign in</a></section>;

  return (
    <section style={{ marginTop: 16, padding: 16, border: '1px solid #7f1d1d', borderRadius: 12, background: '#210808', color: '#fff1f2' }}>
      <h3 style={{ marginTop: 0 }}>Destroy my Bondfire account</h3>
      {!open ? (
        <>
          <p style={{ maxWidth: 720 }}>
            This is separate from destroying an organization. Your account can be permanently removed only after any organization for which you are the sole remaining owner is transferred or destroyed.
          </p>
          <button onClick={() => setOpen(true)}>Open account destruction</button>
        </>
      ) : (
        <>
          <p style={{ fontWeight: 700, maxWidth: 720 }}>
            This removes your active account, sessions, MFA/recovery material, memberships, and account-owned records. It cannot be undone by Bondfire support.
          </p>
          <p style={{ maxWidth: 720 }}>
            Legacy plaintext may still exist in provider-managed historical backups outside Bondfire control. This action removes active data and cryptographic recovery material now.
          </p>
          <div style={{ display: 'grid', gap: 8, maxWidth: 520 }}>
            <input
              aria-label="Current password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Current password"
            />
            <input
              aria-label="Authenticator code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={mfaCode}
              onChange={(event) => setMfaCode(event.target.value)}
              placeholder="MFA code, if enabled"
            />
            <input
              aria-label="Account deletion confirmation phrase"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder={CONFIRMATION}
            />
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 12, maxWidth: 720 }}>
            <input
              type="checkbox"
              checked={acknowledgeHistoricalLimit}
              onChange={(event) => setAcknowledgeHistoricalLimit(event.target.checked)}
            />
            <span>I understand the provider-history limitation and still want my active Bondfire account and recovery material destroyed now.</span>
          </label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            <button disabled={busy} onClick={() => { setOpen(false); setPassword(''); setMfaCode(''); setConfirmation(''); setAcknowledgeHistoricalLimit(false); setError(''); }}>Cancel</button>
            <button
              disabled={busy || !password || confirmation !== CONFIRMATION || !acknowledgeHistoricalLimit}
              onClick={destroyAccount}
              style={{ fontWeight: 800 }}
            >
              {busy ? 'Destroying…' : 'Destroy my account permanently'}
            </button>
          </div>
          {error ? <div role="alert" style={{ marginTop: 12 }}>{error}</div> : null}
          {blockers.length ? <ul>{blockers.map((org) => <li key={org.id}><a href={`#/org/${encodeURIComponent(org.id)}/settings?tab=security`}>{org.name || org.id} · organization security</a></li>)}</ul> : null}
        </>
      )}
    </section>
  );
}
