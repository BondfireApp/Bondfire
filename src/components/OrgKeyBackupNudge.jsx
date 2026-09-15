import React from "react";
import { Link, useParams } from "react-router-dom";
import { getCachedOrgKey } from "../lib/zk.js";

function readFlag(key) {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeFlag(key, v) {
  try {
    localStorage.setItem(key, v ? "1" : "0");
  } catch {
    // ignore
  }
}

export default function OrgKeyBackupNudge({ orgId: orgIdProp }) {
  const params = useParams();
  const orgId = orgIdProp || params.orgId || "";

  const doneKey = `bf_orgkey_backup_done_${orgId}`;
  const dismissKey = `bf_orgkey_backup_dismiss_${orgId}`;

  const [show, setShow] = React.useState(false);

  const recompute = React.useCallback(() => {
    if (!orgId) {
      setShow(false);
      return;
    }
    const hasKey = !!getCachedOrgKey(orgId);
    const done = readFlag(doneKey);
    const dismissed = readFlag(dismissKey);
    setShow(hasKey && !done && !dismissed);
  }, [orgId, doneKey, dismissKey]);

  React.useEffect(() => {
    recompute();

    const onStorage = (e) => {
      const k = e?.key || "";
      if (k === doneKey || k === dismissKey) recompute();
    };

    const onKeyCached = (e) => {
      const changed = e?.detail?.orgId;
      if (!changed || String(changed) === String(orgId)) recompute();
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("bf:orgkey_cached", onKeyCached);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("bf:orgkey_cached", onKeyCached);
    };
  }, [orgId, doneKey, dismissKey, recompute]);

  if (!show) return null;

  return (
    <div
      className="card"
      style={{
        padding: 12,
        marginBottom: 12,
        border: "1px solid rgba(255,255,255,0.14)",
        background: "rgba(255,255,255,0.04)",
      }}
    >
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 280px", minWidth: 260 }}>
          <div style={{ fontWeight: 900, marginBottom: 4 }}>
            Protect your encrypted org data
          </div>
          <div className="helper">
            Your org key lives on this device. If your browser storage gets cleared, you could lose the ability to decrypt older data.
            Set up key recovery now so you can restore access.
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Link className="btn" to={`/org/${orgId}/settings?tab=security`}>
            Set up recovery
          </Link>
          <button
            type="button"
            className="btn"
            onClick={() => {
              writeFlag(dismissKey, true);
              setShow(false);
            }}
          >
            Remind me later
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              // Manual escape hatch: if user already configured recovery elsewhere.
              writeFlag(doneKey, true);
              writeFlag(dismissKey, false);
              setShow(false);
            }}
            title="If you've already set up recovery for this org"
          >
            Mark as done
          </button>
        </div>
      </div>
    </div>
  );
}
