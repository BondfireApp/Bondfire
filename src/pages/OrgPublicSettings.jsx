import * as React from 'react';

function randSlug() {
  return Math.random().toString(36).slice(2, 8);
}

export default function OrgPublicSettings({ orgId, orgName }) {
  const [enabled, setEnabled] = React.useState(false);
  const [slug, setSlug] = React.useState('');
  const [title, setTitle] = React.useState(orgName || '');
  const [about, setAbout] = React.useState('');
  const [features, setFeatures] = React.useState('');
  const [links, setLinks] = React.useState('');
  const [msg, setMsg] = React.useState('');

  // load
  React.useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(`bf_public_${orgId}`) || '{}');
      if (s.enabled != null) setEnabled(!!s.enabled);
      if (s.slug) setSlug(s.slug);
      if (s.title) setTitle(s.title);
      if (s.about) setAbout(s.about);
      if (Array.isArray(s.features)) setFeatures(s.features.join('\n'));
      if (Array.isArray(s.links)) setLinks(s.links.map(l => `${l.text} | ${l.url}`).join('\n'));
    } catch {}
  }, [orgId, orgName]);

  const save = (e) => {
    e?.preventDefault();
    const payload = {
      enabled,
      slug: (slug || '').trim(),
      title: (title || '').trim(),
      about: (about || '').trim(),
      features: features.split('\n').map(s=>s.trim()).filter(Boolean),
      links: links.split('\n').map(line => {
        const [text, url] = line.split('|').map(s=> (s||'').trim());
        return url ? { text: text || url, url } : null;
      }).filter(Boolean),
    };

    // write org settings
    localStorage.setItem(`bf_public_${orgId}`, JSON.stringify(payload));

    // maintain slug index
    const idx = JSON.parse(localStorage.getItem('bf_public_slug_index') || '{}');
    // remove old mapping(s) for this org
    for (const [k,v] of Object.entries(idx)) if (v === orgId) delete idx[k];
    if (payload.slug) idx[payload.slug] = orgId;
    localStorage.setItem('bf_public_slug_index', JSON.stringify(idx));

    setMsg('Saved.');
    setTimeout(()=>setMsg(''), 1500);
  };

  const gen = () => {
    setSlug(randSlug());
    setMsg('');
  };

  const publicUrl = slug ? `${location.origin}/#/p/${slug}` : null;

  return (
    <div className="card" style={{ padding:16 }}>
      <h3>Public Page</h3>
      <p className="helper">Share a read‑only page. Only what you enable is shown.</p>

      <form onSubmit={save} className="grid" style={{ gap:8, marginTop:8 }}>
        <label className="row" style={{ gap:8, alignItems:'center' }}>
          <input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)} />
          <span>Enable public page</span>
        </label>

        <label className="grid" style={{ gap:6 }}>
          <span className="helper">Share URL (slug)</span>
          <div className="row" style={{ gap:8 }}>
            <input style={{ flex:1 }} value={slug} onChange={e=>setSlug(e.target.value)} placeholder="e.g. bondfire-team" />
            <button type="button" onClick={gen}>Generate</button>
          </div>
          {publicUrl && <a className="helper" href={publicUrl} target="_blank" rel="noreferrer">{publicUrl}</a>}
        </label>

        <label className="grid" style={{ gap:6 }}>
          <span className="helper">Title</span>
          <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Public page title" />
        </label>

        <label className="grid" style={{ gap:6 }}>
          <span className="helper">About</span>
          <textarea rows={3} value={about} onChange={e=>setAbout(e.target.value)} placeholder="Short description" />
        </label>

        <label className="grid" style={{ gap:6 }}>
          <span className="helper">Features (one per line)</span>
          <textarea rows={3} value={features} onChange={e=>setFeatures(e.target.value)} placeholder={"Donations tracker\nVolunteers\nEvents"} />
        </label>

        <label className="grid" style={{ gap:6 }}>
          <span className="helper">Links (Text | URL per line)</span>
          <textarea rows={3} value={links} onChange={e=>setLinks(e.target.value)} placeholder={"Website | https://example.org\nTwitter | https://x.com/yourorg"} />
        </label>

        <div className="row" style={{ gap:8 }}>
          <button className="btn-red" type="submit">Save</button>
          {msg && <span className={msg.includes('Saved') ? 'success' : 'error'}>{msg}</span>}
        </div>
      </form>
    </div>
  );
}
