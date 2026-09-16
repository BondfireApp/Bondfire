import { api } from '../utils/api.js';
// src/pages/OrgDash.jsx
import React from "react";
import { useNavigate } from "react-router-dom";
import { isDemoMode } from "../demo/demoMode.js";
import { ensureDemoOrgList, resetDemoState } from "../demo/demoStore.js";
import AccountDestructionPanel from "../components/AccountDestructionPanel.jsx";
import { hydrateOrgList } from "../lib/orgIdentity.js";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");
const PENDING_INVITE_KEY = "bf_pending_invite_v1";
const PENDING_INVITE_ERROR_KEY = "bf_pending_invite_error_v1";

function useIsMobile(maxWidthPx = 720) {
  const [isMobile, setIsMobile] = React.useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia && window.matchMedia(`(max-width: ${maxWidthPx}px)`).matches;
  });

  React.useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia(`(max-width: ${maxWidthPx}px)`);
    const onChange = () => setIsMobile(mq.matches);
    onChange();
    try {
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    } catch {
      mq.addListener(onChange);
      return () => mq.removeListener(onChange);
    }
  }, [maxWidthPx]);

  return isMobile;
}

function getToken() {
  return localStorage.getItem("bf_auth_token") || sessionStorage.getItem("bf_auth_token") || "";
}

function readCookie(name) {
  if (typeof document === "undefined") return "";
  const safe = name.replace(/[$()*+.?[\\\]^{|}]/g, "\\$&");
  const m = document.cookie.match(new RegExp(`(?:^|; )${safe}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : "";
}

function friendlyOrgError(error, fallback) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return "You are offline. Reconnect and try again; nothing was changed.";
  }
  const status = Number(error?.status || 0);
  if (status === 401) return "Your session expired. Sign in again, then retry this action.";
  if (status === 403) return "You do not have permission to do that in this organization.";
  if (status === 404) return "That organization or invitation could not be found. Refresh the dashboard or check the invite code.";
  if (status === 410) return "That invitation has expired. Ask an organization admin for a new invite.";
  if (status === 429) return "Too many attempts. Wait a little before trying again.";
  return String(error?.message || fallback);
}

async function authFetch(path, opts = {}) {
  const token = getToken();
  const relative = path.startsWith("/") ? path : `/${path}`;
  const isAbs = path.startsWith("http");
  const candidates = (() => {
    if (isAbs) return [path];
    if (!API_BASE) return [relative];
    if (relative.startsWith("/api/")) return [relative, `${API_BASE}${relative}`];
    return [`${API_BASE}${relative}`];
  })();

  const headers = {
    "Content-Type": "application/json",
    ...(opts.headers || {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const method = String(opts.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    const csrf = readCookie("bf_csrf");
    if (csrf && !headers["X-CSRF"] && !headers["x-csrf"]) headers["X-CSRF"] = csrf;
  }

  const doReq = async (u) => {
    let res;
    try {
      res = await fetch(u, {
        ...opts,
        credentials: "include",
        headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
    } catch (cause) {
      const error = new Error("The server could not be reached.");
      error.cause = cause;
      throw error;
    }
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.ok === false) {
      const error = new Error(j.error || j.message || `Request failed (${res.status})`);
      error.status = res.status;
      error.code = j.error;
      throw error;
    }
    return j;
  };

  let lastErr = null;
  for (let i = 0; i < candidates.length; i++) {
    const u = candidates[i];
    try {
      return await doReq(u);
    } catch (e) {
      lastErr = e;
      const shouldTryNext = i < candidates.length - 1 && (
        e?.status === 404 ||
        e?.status >= 500 ||
        !e?.status
      );
      if (!shouldTryNext) throw e;
    }
  }

  throw lastErr || new Error("Request failed");
}

export default function OrgDash() {
  const nav = useNavigate();
  const demoMode = isDemoMode();
  const isMobile = useIsMobile(720);

  const [orgs, setOrgs] = React.useState([]);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState("");
  const [msgKind, setMsgKind] = React.useState("info");
  const [showAccountDeletionPrompt, setShowAccountDeletionPrompt] = React.useState(false);
  const [inviteCode, setInviteCode] = React.useState(() => {
    try { return sessionStorage.getItem(PENDING_INVITE_KEY) || ""; } catch { return ""; }
  });

  const load = React.useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) {
      setMsg("");
      setMsgKind("info");
    }
    try {
      if (demoMode) {
        const demoOrg = ensureDemoOrgList();
        setOrgs([demoOrg]);
        return;
      }
      const r = await authFetch("/api/orgs", { method: "GET" });
      const list = Array.isArray(r.orgs) ? r.orgs : [];
      const revealed = await hydrateOrgList(list);
      setOrgs(revealed);
    } catch (e) {
      setMsg(friendlyOrgError(e, "Could not load your organizations. Refresh to try again."));
      setMsgKind("error");
    }
  }, [demoMode]);

  React.useEffect(() => {
    load();
    try {
      if (sessionStorage.getItem("bf_account_deletion_prompt") === "1") {
        sessionStorage.removeItem("bf_account_deletion_prompt");
        setShowAccountDeletionPrompt(true);
      }
      const pendingInviteError = sessionStorage.getItem(PENDING_INVITE_ERROR_KEY);
      if (pendingInviteError) {
        sessionStorage.removeItem(PENDING_INVITE_ERROR_KEY);
        setMsg(pendingInviteError);
        setMsgKind("error");
      }
    } catch {}
  }, [load]);

  const joinWithInvite = async (e) => {
    e?.preventDefault();
    const code = (inviteCode || "").trim().toUpperCase();
    if (!code) return;
    setBusy(true);
    setMsg("");
    setMsgKind("info");
    try {
      if (demoMode) {
        setMsg("Invite join is disabled in demo mode.");
        return;
      }
      const r = await authFetch("/api/invites/redeem", { method: "POST", body: { code } });
      setInviteCode("");
      try {
        sessionStorage.removeItem(PENDING_INVITE_KEY);
        sessionStorage.removeItem(PENDING_INVITE_ERROR_KEY);
      } catch {}
      await load({ quiet: true });
      if (r?.org?.id) nav(`/org/${encodeURIComponent(r.org.id)}`);
      else {
        setMsg("Invitation accepted. The organization is now in your list.");
        setMsgKind("success");
      }
    } catch (e2) {
      try { sessionStorage.setItem(PENDING_INVITE_KEY, code); } catch {}
      setMsg(friendlyOrgError(e2, "The invitation could not be accepted. Check the code and try again."));
      setMsgKind("error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="bf-org-dashboard" style={{ padding: 16 }}>
      {showAccountDeletionPrompt ? <div role="dialog" aria-modal="true" aria-labelledby="account-deletion-dialog-title" style={{ position: "fixed", inset: 0, zIndex: 1000, display: "grid", placeItems: "center", padding: 16, background: "rgba(0,0,0,.78)" }}><div style={{ width: "min(720px, 100%)", maxHeight: "90vh", overflowY: "auto", position: "relative" }}><button type="button" aria-label="Close account deletion prompt" onClick={() => setShowAccountDeletionPrompt(false)} style={{ position: "absolute", right: 12, top: 12, zIndex: 2 }}>Close</button><div id="account-deletion-dialog-title" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden" }}>Account deletion</div><AccountDestructionPanel initialOpen /></div></div> : null}
      <h1 style={{ marginTop: 0 }}>Organization Dashboard</h1>
      <p className="helper">Choose an organization to enter its workspace, or create or join one.</p>

      {msg ? (
        <div className={msgKind === "error" ? "error" : "helper"} role={msgKind === "error" ? "alert" : "status"} style={{ marginBottom: 14 }}>
          {msg}
        </div>
      ) : null}

      {demoMode ? (
        <div className="card" style={{ padding: 12, marginBottom: 16, background: "rgba(255,255,255,0.03)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontWeight: 800, flex: 1 }}>Demo Mode is active. Changes are saved only in this browser.</div>
            <button className="btn" type="button" onClick={() => { resetDemoState(); ensureDemoOrgList(); load(); setMsg("Demo reset."); setMsgKind("success"); try { window.dispatchEvent(new Event("bf-demo-tour-open")); } catch {} }}>
              Reset Demo
            </button>
          </div>
        </div>
      ) : null}

      <div
        className="grid bf-org-dashboard-actions"
        style={{
          gap: 16,
          gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
        }}
      >
        <section className="card" style={{ padding: 16 }}>
          <h2 style={{ marginTop: 0 }}>Create a new org</h2>
          <p className="helper" style={{ lineHeight: 1.55 }}>
            Choose the modules first, then name the organization and bring it into the room. Any staged builder choices from before sign-in are preserved.
          </p>
          <button
            className="btn-red"
            type="button"
            onClick={() => nav("/build?new=1")}
            disabled={busy}
          >
            Build a new org
          </button>
        </section>

        <section className="card" style={{ padding: 16 }}>
          <h2 style={{ marginTop: 0 }}>Join with an invite code</h2>
          <form onSubmit={joinWithInvite} className="grid" style={{ gap: 10 }}>
            <label className="grid" style={{ gap: 6 }}>
              <span className="helper">Invite code</span>
              <input
                className="input"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                placeholder="Paste invite code"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck="false"
              />
            </label>
            <button className="btn-red" disabled={busy || !inviteCode.trim()}>
              {busy ? "Joining…" : "Join"}
            </button>
          </form>
        </section>
      </div>

      <section className="card" style={{ padding: 16, marginTop: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, flex: 1, minWidth: 140 }}>Your orgs</h2>
          <button className="btn" style={{ whiteSpace: "nowrap" }} onClick={() => load()} disabled={busy}>
            Refresh
          </button>
        </div>

        {orgs.length === 0 ? (
          <div className="helper" style={{ marginTop: 12 }}>No organizations yet. Build one or join with an invite above.</div>
        ) : (
          <div style={{ marginTop: 12 }}>
            {orgs.map((o) => (
              <div
                key={o.id}
                className="row bf-org-dashboard-row"
                style={{
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 0",
                  borderTop: "1px solid #222",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {o.name || o.id}
                  </div>
                  <div className="helper">Role: {o.role || "member"}</div>
                </div>
                <div className="bf-org-dashboard-row-actions" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <button
                    className="btn-red"
                    data-tour="demo-org-open"
                    style={{ whiteSpace: "nowrap" }}
                    onClick={() => nav(`/org/${encodeURIComponent(o.id)}`)}
                    disabled={busy}
                  >
                    Open workspace
                  </button>
                  {['owner', 'admin'].includes(o.role) ? (
                    <button className="btn" disabled={busy} onClick={() => nav(`/org/${encodeURIComponent(o.id)}/settings?tab=security`)}>
                      Security
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
