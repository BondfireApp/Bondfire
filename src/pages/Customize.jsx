import React from "react";
import {
  publicCustomizerDefaults,
  readPublicCustomizerSettings,
  writePublicCustomizerSettings,
} from "../lib/publicCustomizerLocal.js";

function toMenuText(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => `${item.label || ""} | ${item.url || ""}`.trim())
    .filter(Boolean)
    .join("\n");
}

function fromMenuText(value) {
  return String(value || "")
    .split("\n")
    .map((line) => {
      const [label, url] = line.split("|").map((part) => String(part || "").trim());
      return label && url ? { label, url } : null;
    })
    .filter(Boolean);
}

export default function Customize() {
  const defaults = React.useMemo(() => publicCustomizerDefaults(), []);
  const [form, setForm] = React.useState(() => readPublicCustomizerSettings());
  const [menuText, setMenuText] = React.useState(() => toMenuText(readPublicCustomizerSettings().menuItems));
  const [msg, setMsg] = React.useState("");

  function update(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function save(e) {
    e?.preventDefault();
    const next = {
      ...form,
      menuItems: fromMenuText(menuText),
    };
    const safe = writePublicCustomizerSettings(next);
    setForm(safe);
    setMenuText(toMenuText(safe.menuItems));
    setMsg("Saved locally. Public pages now reflect these settings.");
    window.dispatchEvent(new Event("bf:public-customizer-changed"));
  }

  function reset() {
    const safe = writePublicCustomizerSettings(defaults);
    setForm(safe);
    setMenuText("");
    setMsg("Reset to defaults.");
    window.dispatchEvent(new Event("bf:public-customizer-changed"));
  }

  return (
    <div className="card" style={{ margin: 16, padding: 16, maxWidth: 840 }}>
      <h2 style={{ marginTop: 0 }}>Customize Public Site</h2>
      <p className="helper">Changes are stored in localStorage for this browser only.</p>
      <form onSubmit={save} className="grid" style={{ gap: 10 }}>
        <label className="grid" style={{ gap: 6 }}>
          <span className="helper">Site title</span>
          <input className="input" value={form.siteTitle || ""} onChange={(e) => update("siteTitle", e.target.value)} placeholder="My local site title" />
        </label>

        <label className="grid" style={{ gap: 6 }}>
          <span className="helper">Tagline</span>
          <input className="input" value={form.tagline || ""} onChange={(e) => update("tagline", e.target.value)} placeholder="Short local masthead subtitle" />
        </label>

        <label className="grid" style={{ gap: 6 }}>
          <span className="helper">Logo URL override</span>
          <input className="input" value={form.logoUrl || ""} onChange={(e) => update("logoUrl", e.target.value)} placeholder="https://... or /path" />
        </label>

        <label className="grid" style={{ gap: 6 }}>
          <span className="helper">Masthead size</span>
          <select className="input" value={form.mastheadSize || "medium"} onChange={(e) => update("mastheadSize", e.target.value)}>
            <option value="small">Small</option>
            <option value="medium">Medium</option>
            <option value="large">Large</option>
          </select>
        </label>

        <label className="grid" style={{ gap: 6 }}>
          <span className="helper">Navigation menu items (Label | URL, one per line)</span>
          <textarea className="input" rows={4} value={menuText} onChange={(e) => setMenuText(e.target.value)} placeholder={"Home | /\nNeeds | #needs\nMeetings | #meetings"} />
        </label>

        <label className="grid" style={{ gap: 6 }}>
          <span className="helper">Homepage posts per page</span>
          <input className="input" type="number" min="1" max="50" value={form.postsPerPage || 10} onChange={(e) => update("postsPerPage", e.target.value)} />
        </label>

        <label className="grid" style={{ gap: 6 }}>
          <span className="helper">Homepage layout</span>
          <select className="input" value={form.layout || "default"} onChange={(e) => update("layout", e.target.value)}>
            <option value="default">Default</option>
            <option value="stacked">Stacked</option>
            <option value="compact">Compact</option>
          </select>
        </label>

        <div className="row" style={{ gap: 8 }}>
          <button className="btn-red" type="submit">Save</button>
          <button type="button" onClick={reset}>Reset defaults</button>
        </div>
        {msg ? <div className="helper">{msg}</div> : null}
      </form>
    </div>
  );
}
