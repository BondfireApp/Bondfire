import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import DriveFilePreview from './components/drive/DriveFilePreview.jsx';
import { decryptWithOrgKey } from './lib/zk.js';
import './drivePublic.css';

export async function openPublicDriveShare(location, signal) {
  const token = new URLSearchParams(location.search).get('share') || '';
  const hex = location.hash.slice(1);
  if (!/^[a-f0-9]{64}$/.test(token) || !/^[a-f0-9]{64}$/.test(hex)) throw new Error('This link is incomplete. Ask for the full public share link.');
  const response = await fetch(`/api/drive-public/${token}`, { credentials: 'omit', cache: 'no-store', signal });
  if (!response.ok) throw new Error('This link is unavailable or sharing has stopped.');
  const key = Uint8Array.from(hex.match(/.{2}/g), pair => parseInt(pair, 16));
  const content = JSON.parse(await decryptWithOrgKey(key, await response.text()));
  if (content.version !== 1 || !Array.isArray(content.items)) throw new Error('This shared item could not be opened.');
  return content;
}

function PublicDrive() {
  const [share, setShare] = useState(null);
  const [selected, setSelected] = useState(0);
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    openPublicDriveShare(window.location, controller.signal).then(setShare).catch(e => { if (!controller.signal.aborted) setError(e.message || 'This link could not be opened.'); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const item = share?.items[selected];
    if (!item || item.kind === 'drive/folders') { setFile(null); return undefined; }
    let alive = true, objectUrl = '';
    setFile(null);
    (async () => {
      const blob = item.dataUrl?.startsWith('data:') ? await (await fetch(item.dataUrl)).blob() : new Blob([item.text || ''], { type: item.mime });
      if (!alive) return;
      objectUrl = URL.createObjectURL(blob);
      setFile({ name: item.name, mime: item.mime, textContent: item.text, dataUrl: item.dataUrl, previewObjectUrl: objectUrl, previewUrl: objectUrl, downloadUrl: objectUrl });
    })().catch(() => { if (alive) setError('This file could not be opened.'); });
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [share, selected]);
  return <main className="public-drive">
    <header><span className="helper">Bondfire · Shared Drive</span><h1>{share?.title || 'Shared item'}</h1><p className="helper">Read-only shared copy · No sign-in needed</p></header>
    {error ? <p role="alert">{error}</p> : !share ? <p role="status">Opening shared item…</p> : <>
      {share.items.length > 1 && <nav aria-label="Shared files">{share.items.map((item, index) => <button className="btn" type="button" key={index} aria-pressed={selected === index} onClick={() => setSelected(index)}>{item.path ? `${item.path}/` : ''}{item.name}{item.kind === 'drive/folders' ? '/' : ''}</button>)}</nav>}
      {file ? <><div className="public-drive-actions"><h2>{file.name}</h2><a className="btn" href={file.downloadUrl} download={file.name}>Download</a></div><DriveFilePreview file={file} /></> : <p>{share.items[selected]?.kind === 'drive/folders' ? 'Select a file to open it.' : 'Loading file…'}</p>}
    </>}
  </main>;
}

createRoot(document.getElementById('root')).render(<PublicDrive />);
