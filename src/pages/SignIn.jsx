// src/pages/SignIn.jsx
import React, { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

const PENDING_INVITE_KEY = "bf_pending_invite_v1";
const PENDING_INVITE_ERROR_KEY = "bf_pending_invite_error_v1";
const ORG_ID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

function fireAuthChanged() {
  try { window.dispatchEvent(new Event("bf-auth-changed")); } catch {}
}

async function safeJson(res) {
  return res.json().catch(() => ({}));
}

function startDemo(navigate) {
  navigate("/demo");
}

function friendlyAuthError(error, fallback = "Authentication failed.") {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "You are offline. Reconnect and try again.";
  const status = Number(error?.status || 0);
  if (status === 401) return "The email or password was not accepted. Check them and try again.";
  if (status === 403) return "This account is not allowed to complete that action.";
  if (status === 429) return "Too many attempts. Wait a little before trying again.";
  return String(error?.message || fallback);
}

function rememberInviteFailure(code, message) {
  try {
    sessionStorage.setItem(PENDING_INVITE_KEY, String(code || "").trim().toUpperCase());
    sessionStorage.setItem(PENDING_INVITE_ERROR_KEY, String(message || "Invite code was not accepted."));
  } catch {}
}

function requestedOrgId(searchParams) {
  const value = String(searchParams.get("org") || "").trim();
  return ORG_ID_RE.test(value) ? value : "";
}

export default function SignIn() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fromBuilder = searchParams.get("from") === "builder";
  const targetOrgId = requestedOrgId(searchParams);
  const initialInvite = String(searchParams.get("invite") || searchParams.get("code") || "").trim().toUpperCase();

  const [mode, setMode] = useState(() => fromBuilder || searchParams.get("mode") === "register" ? "register" : "login");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [inviteCode, setInviteCode] = useState(initialInvite);
  const [mfaStep, setMfaStep] = useState(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaRecovery, setMfaRecovery] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  function readCsrfToken() {
    try {
      const cookie = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("bf_csrf="));
      return cookie ? decodeURIComponent(cookie.slice(8)) : "";
    } catch { return ""; }
  }

  async function postJson(url, body, { includeCsrf = false } = {}) {
    const headers = { "Content-Type": "application/json", Accept: "application/json" };
    if (includeCsrf) {
      const csrf = readCsrfToken();
      if (csrf) headers["X-CSRF"] = csrf;
    }
    let res;
    try {
      res = await fetch(url, { method: "POST", credentials: "include", headers, body: JSON.stringify(body || {}) });
    } catch (cause) {
      const error = new Error("The server could not be reached. Check your connection and try again.");
      error.cause = cause;
      throw error;
    }
    return { res, data: await safeJson(res) };
  }

  async function redeemInviteCode(code) {
    const { res, data } = await postJson("/api/invites/redeem", { code }, { includeCsrf: true });
    if (!res.ok || !data?.ok) {
      const error = new Error(
        res.status === 410
          ? "This invitation has expired. Ask an organization admin for a new invite."
          : res.status === 404
            ? "That invitation could not be found. Check the code or ask for a new invite."
            : data?.error || "Invite code was not accepted. Check the code and try again."
      );
      error.status = res.status;
      throw error;
    }
    return data;
  }

  async function canEnterRequestedOrg(orgId) {
    if (!orgId) return false;
    try {
      const response = await fetch(`/api/orgs/${encodeURIComponent(orgId)}/privacy`, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async function finishAuthenticatedFlow({ invite = "" } = {}) {
    const trimmedCode = String(invite || "").trim().toUpperCase();
    if (trimmedCode) {
      try {
        const joined = await redeemInviteCode(trimmedCode);
        fireAuthChanged();
        if (joined?.org?.id) {
          navigate(`/org/${encodeURIComponent(joined.org.id)}/overview`, { replace: true });
          return;
        }
      } catch (inviteError) {
        rememberInviteFailure(trimmedCode, inviteError?.message);
        fireAuthChanged();
        navigate("/orgs", { replace: true });
        return;
      }
    }

    fireAuthChanged();
    if (targetOrgId && await canEnterRequestedOrg(targetOrgId)) {
      navigate(`/org/${encodeURIComponent(targetOrgId)}/overview`, { replace: true });
      return;
    }
    navigate("/orgs", { replace: true });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const url = mode === "register" ? "/api/auth/register" : "/api/auth/login";
      const payload = mode === "register" ? { email, password: pass, name } : { email, password: pass };
      const { res, data } = await postJson(url, payload);

      if (mode === "login" && res.ok && data?.ok && data?.mfa_required && data?.challenge_id) {
        setMfaStep({ challengeId: data.challenge_id, email });
        setBusy(false);
        return;
      }

      if (!res.ok || !data?.ok) {
        const error = new Error(data?.error || (mode === "register" ? "Account creation failed." : "Sign in failed."));
        error.status = res.status;
        throw error;
      }

      const meRes = await fetch("/api/auth/me", { credentials: "include" });
      const meData = await safeJson(meRes);
      if (!meRes.ok || !meData?.ok) {
        const error = new Error("Your account was accepted, but the session did not finish starting. Try signing in again.");
        error.status = meRes.status;
        throw error;
      }

      await finishAuthenticatedFlow({ invite: inviteCode });
    } catch (e2) {
      setErr(friendlyAuthError(e2, mode === "register" ? "Account creation failed." : "Sign in failed."));
    } finally {
      setBusy(false);
    }
  }

  async function handleMfaVerify(e) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const { res, data } = await postJson("/api/auth/login/mfa", {
        challenge_id: mfaStep?.challengeId,
        code: mfaCode,
        recovery_code: mfaRecovery,
      });
      if (!res.ok || !data?.ok) {
        const error = new Error(data?.error || "The verification code was not accepted.");
        error.status = res.status;
        throw error;
      }

      const meRes = await fetch("/api/auth/me", { credentials: "include" });
      const meData = await safeJson(meRes);
      if (!meRes.ok || !meData?.ok) {
        const error = new Error("Verification succeeded, but the session did not finish starting. Try signing in again.");
        error.status = meRes.status;
        throw error;
      }

      setMfaStep(null);
      setMfaCode("");
      setMfaRecovery("");
      await finishAuthenticatedFlow({ invite: inviteCode });
    } catch (e2) {
      setErr(friendlyAuthError(e2, "Verification failed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="bf-auth-page" style={{ maxWidth: 520, margin: "8vh auto", padding: 16 }}>
      <h1 style={{ marginBottom: 6 }}>Welcome to Bondfire</h1>
      <p className="helper" style={{ marginTop: 0 }}>
        {targetOrgId
          ? "Sign in to continue to the organization that sent you here."
          : fromBuilder
            ? "Sign in or create an account. Your staged build stays in this browser, and you can choose Build or Join from the organization dashboard."
            : mode === "login"
              ? "Sign in to continue. If you have an invite, enter it below and Bondfire will take you straight to that organization."
              : "Create an account. You can join with an invite now or choose Build or Join from the organization dashboard."}
      </p>

      <div className="bf-auth-mode-actions" style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <button type="button" className={mode === "login" ? "btn-red" : "btn"} onClick={() => { setErr(""); setMode("login"); }} disabled={busy}>Sign in</button>
        <button type="button" className={mode === "register" ? "btn-red" : "btn"} onClick={() => { setErr(""); setMode("register"); }} disabled={busy}>Create account</button>
      </div>

      <div style={{ marginTop: 12 }}>
        <button type="button" className="btn" onClick={() => startDemo(navigate)} disabled={busy}>Try Demo (no account required)</button>
      </div>

      {err && <div className="error" role="alert" style={{ marginTop: 12 }}>{String(err)}</div>}

      {mfaStep ? (
        <form onSubmit={handleMfaVerify} className="grid" style={{ gap: 10, marginTop: 12 }}>
          <div className="helper">MFA required for <b>{mfaStep.email}</b>. Enter your authenticator code or a recovery code.</div>
          <label className="grid" style={{ gap: 6 }}>
            <span className="sr-only">Authenticator code</span>
            <input className="input" type="text" inputMode="numeric" autoComplete="one-time-code" placeholder="Authenticator code (6 digits)" value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} autoFocus />
          </label>
          <label className="grid" style={{ gap: 6 }}>
            <span className="sr-only">Recovery code</span>
            <input className="input" type="text" placeholder="Recovery code (optional)" value={mfaRecovery} onChange={(e) => setMfaRecovery(e.target.value)} />
          </label>
          <button className="btn-red" disabled={busy}>{busy ? "Verifying…" : "Verify"}</button>
          <button type="button" className="btn" disabled={busy} onClick={() => { setMfaStep(null); setMfaCode(""); setMfaRecovery(""); }}>Back</button>
        </form>
      ) : (
        <form onSubmit={handleSubmit} className="grid" style={{ gap: 10, marginTop: 12 }}>
          {mode === "register" ? (
            <label className="grid" style={{ gap: 6 }}>
              <span className="sr-only">Name</span>
              <input className="input" type="text" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </label>
          ) : null}
          <label className="grid" style={{ gap: 6 }}>
            <span className="sr-only">Email</span>
            <input className="input" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus required />
          </label>
          <label className="grid" style={{ gap: 6 }}>
            <span className="sr-only">Password</span>
            <input className="input" type="password" placeholder="Password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete={mode === "register" ? "new-password" : "current-password"} required />
          </label>
          <label className="grid" style={{ gap: 6 }}>
            <span className="helper">Invite code (optional)</span>
            <input className="input" type="text" placeholder="Paste invite code" value={inviteCode} onChange={(e) => setInviteCode(e.target.value.toUpperCase())} autoCapitalize="characters" autoCorrect="off" spellCheck="false" />
          </label>
          <button className="btn-red" disabled={busy}>{busy ? "Working…" : mode === "register" ? "Create account" : "Sign in"}</button>
        </form>
      )}
    </main>
  );
}
