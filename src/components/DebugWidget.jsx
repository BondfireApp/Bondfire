// src/components/DebugWidget.jsx
import React from "react";
import { clearDebugLogs, getDebugLogs, isDebugEnabled } from "../lib/debugBus.js";
import "./debugWidget.css";

function pretty(v) {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

export default function DebugWidget() {
  const [open, setOpen] = React.useState(false);
  const [tick, setTick] = React.useState(0);

  const enabled = React.useMemo(() => isDebugEnabled(), []);

  React.useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [enabled]);

  if (!enabled) return null;

  const logs = getDebugLogs();
  const latest = logs.slice(-60).reverse();

  let authObj = {};
  try {
    authObj = JSON.parse(localStorage.getItem("bf_auth") || "{}") || {};
  } catch {
    authObj = {};
  }

  return (
    <>
      <button
        type="button"
        className="bf-debug-fab"
        title="Debug"
        onClick={() => setOpen((v) => !v)}
      >
        🐞
      </button>

      {open ? (
        <div className="bf-debug-panel" role="dialog" aria-modal="true" aria-label="Debug panel">
          <div className="bf-debug-top">
            <div className="bf-debug-title">Debug</div>
            <div className="bf-debug-actions">
              <button
                type="button"
                className="bf-debug-btn"
                onClick={() => {
                  try {
                    localStorage.setItem("bf_debug", "1");
                  } catch {}
                }}
              >
                Pin
              </button>
              <button type="button" className="bf-debug-btn" onClick={() => clearDebugLogs()}>
                Clear
              </button>
              <button type="button" className="bf-debug-btn" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
          </div>

          <div className="bf-debug-grid">
            <section className="bf-debug-card">
              <h4>Auth</h4>
              <pre>
                {pretty({
                  hasAuth: !!localStorage.getItem("bf_auth"),
                  keys: Object.keys(authObj),
                })}
              </pre>
              <div className="bf-debug-row">
                <button
                  type="button"
                  className="bf-debug-btn danger"
                  onClick={() => {
                    try {
                      localStorage.removeItem("bf_auth");
                      window.location.reload();
                    } catch {}
                  }}
                >
                  Nuke bf_auth + reload
                </button>
              </div>
              <p className="bf-debug-help">
                If testers get logged out "randomly", watch the Recent events feed for 401s and refresh failures.
              </p>
            </section>

            <section className="bf-debug-card">
              <h4>Storage snapshot</h4>
              <pre>
                {pretty({
                  keys: Object.keys(localStorage)
                    .filter((k) => k.startsWith("bf_"))
                    .sort(),
                })}
              </pre>
            </section>

            <section className="bf-debug-card bf-debug-span">
              <h4>Recent events</h4>
              <div className="bf-debug-list" key={tick}>
                {latest.length ? (
                  latest.map((e, i) => (
                    <div key={i} className="bf-debug-item">
                      <div className="bf-debug-item-top">
                        <span className="t">{e.t}</span>
                        <span className="k">{e.type}</span>
                      </div>
                      <pre className="bf-debug-item-pre">{pretty(e.detail)}</pre>
                    </div>
                  ))
                ) : (
                  <div className="bf-debug-empty">No debug events yet.</div>
                )}
              </div>
            </section>
          </div>
        </div>
      ) : null}
    </>
  );
}
