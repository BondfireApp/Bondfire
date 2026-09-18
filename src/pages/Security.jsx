import React from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../utils/api.js';
import PrivateStoragePanel from '../components/PrivateStoragePanel.jsx';
import ScopedKeysPanel from '../components/ScopedKeysPanel.jsx';
import EmergencyProtocolPanel from '../components/EmergencyProtocolPanel.jsx';
import AccountDestructionPanel from '../components/AccountDestructionPanel.jsx';

const card = { marginTop: 16, padding: 16, border: '1px solid #444', borderRadius: 12 };
const grid = { display: 'grid', gap: 8, maxWidth: 560 };

function formatTime(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return '—';
  try { return new Date(number).toLocaleString(); } catch { return '—'; }
}

function MfaPanel() {
  const [enabled, setEnabled] = React.useState(null);
  const [setup, setSetup] = React.useState(null);
  const [code, setCode] = React.useState('');
  const [recoveryCodes, setRecoveryCodes] = React.useState([]);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState('');

  const refresh = React.useCallback(async () => {
    const result = await api('/api/auth/me', { method: 'GET' });
    setEnabled(Number(result?.user?.mfa_enabled || 0) === 1);
  }, []);

  React.useEffect(() => { refresh().catch((error) => setMessage(error?.message || 'Could not load MFA status.')); }, [refresh]);

  async function startSetup() {
    setBusy(true); setMessage(''); setRecoveryCodes([]); setCode('');
    try {
      const result = await api('/api/auth/mfa/setup', { method: 'POST', body: '{}' });
      setSetup({ secret: String(result?.secret || ''), otpauth: String(result?.otpauth || '') });
    } catch (error) {
      setMessage(error?.message || 'MFA setup failed.');
    } finally { setBusy(false); }
  }

  async function confirmSetup() {
    setBusy(true); setMessage('');
    try {
      const result = await api('/api/auth/mfa/confirm', { method: 'POST', body: JSON.stringify({ code: code.trim() }) });
      setRecoveryCodes(Array.isArray(result?.recovery_codes) ? result.recovery_codes : []);
      setSetup(null); setCode(''); setEnabled(true);
      setMessage('Authenticator MFA is enabled. Save the recovery codes below before leaving this page.');
    } catch (error) {
      setMessage(error?.message || 'MFA confirmation failed.');
    } finally { setBusy(false); }
  }

  async function disableMfa() {
    setBusy(true); setMessage('');
    try {
      await api('/api/auth/mfa/disable', { method: 'POST', body: JSON.stringify({ code: code.trim() }) });
      setEnabled(false); setSetup(null); setCode(''); setRecoveryCodes([]);
      setMessage('Authenticator MFA is disabled.');
    } catch (error) {
      setMessage(error?.message || 'Could not disable MFA.');
    } finally { setBusy(false); }
  }

  async function copyRecoveryCodes() {
    try {
      await navigator.clipboard.writeText(recoveryCodes.join('\n'));
      setMessage('Recovery codes copied. Store them somewhere separate from this account.');
    } catch { setMessage('Could not copy recovery codes.'); }
  }

  return <section style={card} aria-labelledby="mfa-title">
    <h2 id="mfa-title" style={{ marginTop: 0 }}>Two-factor authentication</h2>
    <p>Protects your Bondfire login with a time-based authenticator code. This is account security, separate from organization encryption and recovery keys.</p>
    {enabled === null ? <p role="status">Checking MFA status…</p> : enabled ? <>
      <p><strong>Status: enabled</strong></p>
      <p>Disabling MFA requires a current six-digit authenticator code and removes the existing MFA recovery codes.</p>
      <div style={grid}>
        <label>Current authenticator code<input className="input" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} disabled={busy} /></label>
        <button className="btn" type="button" onClick={disableMfa} disabled={busy || !/^\d{6}$/.test(code.trim())}>{busy ? 'Updating…' : 'Disable MFA'}</button>
      </div>
    </> : setup ? <>
      <p><strong>Status: setup not yet confirmed</strong></p>
      <p>Add this account to your authenticator, then enter the six-digit code it generates. MFA does not turn on until confirmation succeeds.</p>
      <div style={grid}>
        <label>Authenticator secret<input className="input" readOnly value={setup.secret} /></label>
        {setup.otpauth ? <a className="btn" href={setup.otpauth}>Open in authenticator app</a> : null}
        <label>Six-digit code<input className="input" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} disabled={busy} /></label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn-red" type="button" onClick={confirmSetup} disabled={busy || !/^\d{6}$/.test(code.trim())}>{busy ? 'Confirming…' : 'Confirm and enable MFA'}</button>
          <button className="btn" type="button" onClick={() => { setSetup(null); setCode(''); }} disabled={busy}>Cancel setup</button>
        </div>
      </div>
    </> : <>
      <p><strong>Status: not enabled</strong></p>
      <button className="btn-red" type="button" onClick={startSetup} disabled={busy}>{busy ? 'Starting setup…' : 'Set up authenticator MFA'}</button>
    </>}

    {recoveryCodes.length ? <div style={{ marginTop: 14, padding: 12, border: '1px solid #d97706', borderRadius: 8 }}>
      <strong>Save these MFA recovery codes now.</strong>
      <p>Each code is single-use. Bondfire stores only their hashes, so this page cannot reveal these same codes later.</p>
      <div style={{ display: 'grid', gap: 4, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>{recoveryCodes.map((item) => <code key={item}>{item}</code>)}</div>
      <button className="btn" type="button" style={{ marginTop: 10 }} onClick={copyRecoveryCodes}>Copy recovery codes</button>
    </div> : null}
    {message ? <p role="status">{message}</p> : null}
  </section>;
}

function EmergencySection({ orgId }) {
  const [status, setStatus] = React.useState({ loading: true, error: '', globalActive: false, lockdown: false, isolated: false, stage: 'normal', updatedAt: null });
  const [reports, setReports] = React.useState({ loading: true, error: '', rows: [] });

  const refresh = React.useCallback(async () => {
    setStatus((current) => ({ ...current, loading: true, error: '' }));
    setReports((current) => ({ ...current, loading: true, error: '' }));
    const [statusResult, reportResult] = await Promise.allSettled([
      Promise.all([api('/api/emergency/status', { method: 'GET' }), api(`/api/orgs/${encodeURIComponent(orgId)}/emergency`, { method: 'GET' })]),
      api(`/api/orgs/${encodeURIComponent(orgId)}/emergency/reports`, { method: 'GET' }),
    ]);

    if (statusResult.status === 'fulfilled') {
      const [globalRes, orgRes] = statusResult.value;
      const globalActive = !!(globalRes?.isActive ?? globalRes?.status?.isActive);
      const lockdown = !!orgRes?.orgLockdown?.enabled;
      const protocol = orgRes?.orgProtocol || {};
      setStatus({ loading: false, error: '', globalActive, lockdown, isolated: !!protocol.isolated, stage: String(protocol.stage || 'normal'), updatedAt: protocol.updatedAt || orgRes?.orgLockdown?.updatedAt || null });
    } else setStatus((current) => ({ ...current, loading: false, error: statusResult.reason?.message || 'Could not load emergency status.' }));

    if (reportResult.status === 'fulfilled') setReports({ loading: false, error: '', rows: Array.isArray(reportResult.value?.reports) ? reportResult.value.reports : [] });
    else setReports((current) => ({ ...current, loading: false, error: reportResult.reason?.message || 'Could not load emergency reports.' }));
  }, [orgId]);

  React.useEffect(() => { refresh(); }, [refresh]);

  return <section style={{ ...card, borderColor: '#7f1d1d' }} aria-labelledby="emergency-title">
    <h2 id="emergency-title" style={{ marginTop: 0 }}>Organization emergency controls</h2>
    <p>For an actual organizational security incident. Lockdown is reversible; isolation restricts access to owners; the final destruction step permanently removes the organization’s active data and server-held recovery material.</p>

    <div style={{ padding: 12, border: '1px solid #444', borderRadius: 8 }}>
      <h3 style={{ marginTop: 0 }}>Current status</h3>
      {status.loading ? <p role="status">Checking emergency state…</p> : <>
        <p style={{ marginBottom: 6 }}>Platform emergency: <strong>{status.globalActive ? 'active' : 'normal'}</strong></p>
        <p style={{ marginBottom: 6 }}>Organization lockdown: <strong>{status.lockdown ? 'active' : 'off'}</strong></p>
        <p style={{ marginBottom: 6 }}>Owner-only isolation: <strong>{status.isolated ? 'active' : 'off'}</strong></p>
        <p style={{ marginBottom: 0 }}>Protocol stage: <strong>{status.stage}</strong>{status.updatedAt ? ` · updated ${formatTime(status.updatedAt)}` : ''}</p>
      </>}
      {status.error ? <p role="alert">{status.error}</p> : null}
    </div>

    <EmergencyProtocolPanel orgId={orgId} lockdown={status.lockdown} isolated={status.isolated} onChanged={refresh} />

    <div style={{ marginTop: 16, padding: 12, border: '1px solid #444', borderRadius: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div><h3 style={{ margin: 0 }}>Emergency history</h3><p style={{ margin: '6px 0 0' }}>Audit trail of lockdown, recovery, isolation, and destruction-related events for this organization.</p></div>
        <button className="btn" type="button" onClick={refresh} disabled={reports.loading}>Refresh</button>
      </div>
      {reports.loading ? <p role="status">Loading history…</p> : reports.rows.length ? <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
        {reports.rows.map((row) => <div key={row.id || `${row.eventType}-${row.createdAt}`} style={{ padding: 10, border: '1px solid #333', borderRadius: 8 }}>
          <strong>{row.summary || row.eventType || 'Emergency event'}</strong>
          <div style={{ fontSize: 13, opacity: .82, marginTop: 4 }}>{formatTime(row.createdAt)} · {row.outcome || 'recorded'}{row.actorUserId ? ` · actor ${row.actorUserId}` : ''}</div>
        </div>)}
      </div> : <p>No emergency events recorded for this organization.</p>}
      {reports.error ? <p role="alert">{reports.error}</p> : null}
    </div>
  </section>;
}

export default function Security() {
  const { orgId } = useParams();

  return <main style={{ maxWidth: 920, margin: '0 auto', padding: 16 }}>
    <h1>Security</h1>
    <p>Account login protection and, when opened from an organization, that organization’s encryption, recovery, and emergency controls.</p>

    <MfaPanel />

    {orgId ? <>
      <PrivateStoragePanel orgId={orgId} />
      <ScopedKeysPanel orgId={orgId} />
      <EmergencySection orgId={orgId} />
    </> : <section style={card}><h2 style={{ marginTop: 0 }}>Organization security</h2><p>Open an organization and choose Settings → Security to manage its encrypted storage, key recovery, or emergency protocol.</p><a className="btn" href="#/orgs">Open organizations</a></section>}

    <section style={{ ...card, borderColor: '#7f1d1d' }} aria-labelledby="account-deletion-title">
      <h2 id="account-deletion-title" style={{ marginTop: 0 }}>Personal account deletion</h2>
      <p>This is about your Bondfire account, not an organization’s encryption or emergency protocol. It is intentionally kept separate from organization destruction.</p>
      <AccountDestructionPanel />
    </section>
  </main>;
}
