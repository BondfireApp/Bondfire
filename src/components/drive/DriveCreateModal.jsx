import React from "react";

export default function DriveCreateModal({ open, onClose, title = "New", actions = [] }) {
  const [error, setError] = React.useState("");
  const [busyId, setBusyId] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setError("");
      setBusyId("");
    }
  }, [open]);

  if (!open) return null;

  async function runAction(action) {
    if (busyId) return;
    setError("");
    setBusyId(action.id);
    try {
      await action.onClick?.();
      onClose?.();
    } catch (err) {
      setError(err?.message || "Drive could not create this item.");
    } finally {
      setBusyId("");
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.56)", zIndex: 160, display: "grid", placeItems: "start center", paddingTop: 52 }} onClick={busyId ? undefined : onClose}>
      <div className="card" style={{ width: "min(1120px, calc(100vw - 36px))", padding: 14 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 28, fontWeight: 800 }}>＋ {title}</div>
            <div className="helper">Create a new document or folder, or import existing files into this folder.</div>
          </div>
          <button className="btn" type="button" onClick={onClose} disabled={!!busyId}>×</button>
        </div>
        {error ? (
          <div role="alert" style={{ marginBottom: 10, padding: 10, border: "1px solid rgba(239,68,68,0.55)", borderRadius: 10, background: "rgba(127,29,29,0.22)", color: "#fecaca" }}>
            {error}
          </div>
        ) : null}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(136px, 1fr))", gap: 10 }}>
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              onClick={() => runAction(action)}
              disabled={!!busyId}
              aria-busy={busyId === action.id ? "true" : undefined}
              style={{ display: "grid", gap: 8, alignContent: "start", minHeight: 104, padding: 12, borderRadius: 12, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.03)", color: "#fff", textAlign: "left", cursor: busyId ? "wait" : "pointer", opacity: busyId && busyId !== action.id ? 0.55 : 1 }}
            >
              <div style={{ fontSize: 26 }}>{action.icon || "•"}</div>
              <div style={{ fontWeight: 800 }}>{busyId === action.id ? "Working…" : action.label}</div>
              <div className="helper">{action.hint || ""}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}