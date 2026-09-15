// src/pages/Orgs.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../utils/api.js";

function loadOrgs() {
  try { return JSON.parse(localStorage.getItem("bf_orgs") || "[]"); }
  catch { return []; }
}
function saveOrgs(list) {
  localStorage.setItem("bf_orgs", JSON.stringify(list));
}

export default function Orgs() {
  const navigate = useNavigate();
  const [orgs, setOrgs] = useState(loadOrgs());
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const go = (id) => navigate(`/org/${id}`);

  async function refresh() {
    setErr("");
    setLoading(true);
    try {
      const data = await api("/api/orgs");
      const list = Array.isArray(data.orgs) ? data.orgs : [];
      setOrgs(list);
      saveOrgs(list);
    } catch (e) {
      setErr(e?.message || "Failed to load orgs");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh().catch(console.error);
  }, []);

  const items = useMemo(
    () =>
      orgs.map((o) => (
        <li
          key={o.id}
          className="row"
          style={{ justifyContent: "space-between", alignItems: "center", gap: 8 }}
        >
          <div>
            <div style={{ fontWeight: 600 }}>{o.name}</div>
            <div className="helper">Role: {o.role}</div>
          </div>
          <button type="button" className="primary" onClick={() => go(o.id)}>
            Open
          </button>
        </li>
      )),
    [orgs]
  );

  return (
    <div className="grid" style={{ gap: 12, paddingTop: 12 }}>
      <div className="card">
        <h2 style={{ margin: "4px 0 8px" }}>Org Dashboard</h2>
        <p className="helper">Choose an organization to enter its workspace.</p>

        <div className="row" style={{ gap: 8, marginTop: 10 }}>
          <button className="primary" type="button" onClick={() => refresh().catch(console.error)} disabled={loading}>
            {loading ? "Loading" : "Refresh"}
          </button>
          <button className="primary" type="button" onClick={() => window.location.assign("/#/mfa")}>
            Set up 2FA
          </button>
        </div>

        {err && <div className="helper" style={{ color: "tomato", marginTop: 10 }}>{err}</div>}
      </div>

      <div className="card">
        <h3>Your orgs</h3>
        {items.length === 0 ? (
          <p className="helper" style={{ marginTop: 6 }}>
            You do not belong to any orgs yet. Use Sign Up to create one.
          </p>
        ) : (
          <ul style={{ display: "grid", gap: 8, marginTop: 8, padding: 0, listStyle: "none" }}>
            {items}
          </ul>
        )}
      </div>
    </div>
  );
}
