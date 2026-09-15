// src/help/HelpPanel.jsx
import React from "react";
import { HELP_TOPICS } from "./helpContent.js";
import { isDemoMode } from "../demo/demoMode.js";
import "./help.css";

export default function HelpPanel({ open, activeId, setActiveId, onClose }) {
  const [q, setQ] = React.useState("");

  const topics = React.useMemo(() => {
    const qq = String(q || "").trim().toLowerCase();
    if (!qq) return HELP_TOPICS;
    return HELP_TOPICS.filter((t) => {
      const hay = [t.title, t.blurb, ...(t.keywords || [])].join(" ").toLowerCase();
      return hay.includes(qq);
    });
  }, [q]);

  const active = React.useMemo(() => {
    const a = HELP_TOPICS.find((t) => t.id === activeId);
    return a || HELP_TOPICS[0];
  }, [activeId]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="bf-help-backdrop" onClick={() => onClose?.()} />
      <div className="bf-help-panel" role="dialog" aria-modal="true" aria-label="Help panel">
        <div className="bf-help-top">
          <h3>Need help?</h3>
          {isDemoMode() ? (
            <button type="button" className="bf-help-tour" onClick={() => { try { window.dispatchEvent(new Event("bf-demo-tour-open")); } catch {} }}>
              Start tour
            </button>
          ) : null}
          <button type="button" className="bf-help-close" onClick={() => onClose?.()}>
            Close
          </button>
        </div>

        <div className="bf-help-body">
          <div className="bf-help-nav">
            <input
              className="bf-help-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search help…"
            />
            {topics.map((t) => (
              <button
                key={t.id}
                type="button"
                className={"bf-help-navbtn" + (t.id === active.id ? " active" : "")}
                onClick={() => setActiveId(t.id)}
              >
                <div className="t">{t.title}</div>
                <div className="b">{t.blurb}</div>
              </button>
            ))}
          </div>

          <div className="bf-help-content">
            <h2 className="bf-help-topic-title">{active.title}</h2>
            <p className="bf-help-topic-blurb">{active.blurb}</p>

            {(active.sections || []).map((s, idx) => (
              <div key={idx} className="bf-help-sec">
                <h4>{s.h}</h4>
                {(s.p || []).map((pp, j) => (
                  <p key={j}>{pp}</p>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}