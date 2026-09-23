import React, { useEffect, useState } from 'react';
import { loadPublicDriveShare, publicDriveLink, stopPublicDriveShare } from '../../lib/drivePublicSharing.js';

export default function DrivePublicShare({ orgId, target, onPublish, onBusy }) {
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let alive = true;
    loadPublicDriveShare(orgId, target).then(value => { if (alive) setDetail(value); }).catch(e => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [orgId, target.kind, target.id]);
  async function action(stop = false) {
    setBusy(true); onBusy?.(true); setError(''); setCopied(false);
    try { setDetail(stop ? await stopPublicDriveShare(orgId, target) : await onPublish(target, detail)); }
    catch (e) { setError(e.message || 'Could not update public sharing.'); }
    finally { setBusy(false); onBusy?.(false); }
  }
  const link = publicDriveLink(detail);
  return <section style={{ padding: 12, border: '1px solid rgba(255,255,255,.15)', borderRadius: 12 }}>
    <div style={{ fontWeight: 750 }}>Anyone with the link</div>
    <p className="helper">No account or sign-in needed. Share a read-only copy of this item{target.kind === 'drive/folders' ? ' and its current contents' : ''}. Future edits stay private until you update the shared copy.</p>
    <div className="helper" style={{ marginBottom: 8 }}>{detail?.enabled ? 'Public link is on' : 'Public link is off'}</div>
    {link && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
      <input aria-label="Public share link" className="input" value={link} readOnly onFocus={e => e.target.select()} style={{ flex: '1 1 220px', minWidth: 0 }} />
      <button className="btn" type="button" onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setError('Select the link above and copy it.'); } }}>{copied ? 'Copied' : 'Copy public link'}</button>
      <a className="btn" href={link} target="_blank" rel="noreferrer">Open</a>
    </div>}
    {detail?.keyUnavailable && <p className="helper">This device cannot recover the old link. Stop sharing to replace it with a new one.</p>}
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <button className="btn" type="button" disabled={!detail || busy || detail.keyUnavailable} onClick={() => action()}>{busy ? 'Updating sharing…' : detail?.enabled ? 'Update shared copy' : 'Create public link'}</button>
      {detail?.enabled && <button className="btn" type="button" disabled={busy} onClick={() => action(true)}>Stop sharing</button>}
    </div>
    {error && <p role="alert" className="helper">{error === 'DRIVE_SHARE_ACCESS_DENIED' || error === 'INSUFFICIENT_ROLE' ? 'You need edit access to share this item publicly.' : error}</p>}
  </section>;
}
