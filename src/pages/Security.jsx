import ScopedKeysPanel from '../components/ScopedKeysPanel.jsx';
import { deviceKeyId } from '../../shared/privateContent.js';
import { decryptPrivate } from '../lib/privateCrypto.js';
import PrivateStoragePanel from '../components/PrivateStoragePanel.jsx';
import React from "react";
import { useParams } from "react-router-dom";
import { api } from "../utils/api.js";
import EmergencyProtocolPanel from "../components/EmergencyProtocolPanel.jsx";
import AccountDestructionPanel from "../components/AccountDestructionPanel.jsx";
import {
  ensureDeviceKeypair,
  randomOrgKey,
  wrapForMember,
  unwrapOrgKey,
  cacheOrgKey,
  getCachedOrgKey,
  wrapOrgKeyForRecovery,
  unwrapOrgKeyFromRecovery,
  saveRecoveryToServer,
  loadRecoveryFromServer,
  deleteRecoveryFromServer,
} from "../lib/zk.js";
import { kidFromJwk } from "../lib/zk_kid.js";

// Base64url -> Uint8Array (robust to missing padding)
function b64urlToBytes(input) {
  if (typeof input !== "string") throw new Error("Invalid base64 payload");
  let s = input.trim().replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  let bin;
  try {
    bin = atob(s);
  } catch {
    throw new Error("Invalid base64 payload (decode failed)");
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export default function Security() {
  const { orgId } = useParams();

  const [msg, setMsg] = React.useState("");
  const [mfaSecret, setMfaSecret] = React.useState("");
  const [mfaQr, setMfaQr] = React.useState("");
  const [mfaCode, setMfaCode] = React.useState("");
  const [recoveryCodes, setRecoveryCodes] = React.useState([]);
  const [showRecovery, setShowRecovery] = React.useState(false);

  const [zkStatus, setZkStatus] = React.useState({ deviceKey: false, orgKey: false });
  const [orgKeyVersion, setOrgKeyVersion] = React.useState(1);
  const [recoveryInfo, setRecoveryInfo] = React.useState({ has: false, updatedAt: null });
  const [recoveryMsg, setRecoveryMsg] = React.useState("");
  const [recoveryPassA, setRecoveryPassA] = React.useState("");
  const [recoveryPassB, setRecoveryPassB] = React.useState("");
  const [recoveryRestorePass, setRecoveryRestorePass] = React.useState("");
  const [emergencyStatus, setEmergencyStatus] = React.useState({
    loading: true,
    error: "",
    globalActive: false,
    orgLockdownActive: false,
    orgIsolationActive: false,
    globalUpdatedAt: null,
    orgUpdatedAt: null,
  });

  const [emergencyReports, setEmergencyReports] = React.useState({
    loading: true,
    error: "",
    rows: [],
  });

  React.useEffect(() => {
    (async () => {
      const orgKey = getCachedOrgKey(orgId);
      setZkStatus((s) => ({ ...s, orgKey: !!orgKey }));
      try {
        const dev = await ensureDeviceKeypair();
        setZkStatus((s) => ({ ...s, deviceKey: !!dev?.pubJwk }));
      } catch {}

      try {
        const r = await loadRecoveryFromServer(orgId);
        setRecoveryInfo({ has: !!r?.has_recovery, updatedAt: r?.updated_at || null });
      } catch {
        // ignore
      }
    })();
  }, [orgId]);

  const loadEmergencyStatus = React.useCallback(async () => {
    if (!orgId) return;
    setEmergencyStatus((s) => ({ ...s, loading: true, error: "" }));
    try {
      const [globalRes, orgRes] = await Promise.all([
        api("/api/emergency/status", { method: "GET" }),
        api(`/api/orgs/${orgId}/emergency`, { method: "GET" }),
      ]);

      const globalActive = !!(globalRes?.isActive ?? globalRes?.status?.isActive);
      const globalUpdatedAt = globalRes?.updatedAt ?? globalRes?.status?.updatedAt ?? null;
      const orgLockdown = orgRes?.orgLockdown || null;
      const orgProtocol = orgRes?.orgProtocol || null;

      setEmergencyStatus({
        loading: false,
        error: "",
        globalActive,
        orgLockdownActive: !!orgLockdown?.enabled,
        orgIsolationActive: !!orgProtocol?.isolated,
        globalUpdatedAt,
        orgUpdatedAt: orgProtocol?.updatedAt || orgLockdown?.updatedAt || null,
      });
    } catch (e) {
      setEmergencyStatus((s) => ({
        ...s,
        loading: false,
        error: e?.message || "Failed to load emergency status",
      }));
    }
  }, [orgId]);

  React.useEffect(() => {
    loadEmergencyStatus();
  }, [loadEmergencyStatus]);

  const loadEmergencyReports = React.useCallback(async () => {
    if (!orgId) return;
    setEmergencyReports((s) => ({ ...s, loading: true, error: "" }));
    try {
      const res = await api(`/api/orgs/${orgId}/emergency/reports`, { method: "GET" });
      setEmergencyReports({
        loading: false,
        error: "",
        rows: Array.isArray(res?.reports) ? res.reports : [],
      });
    } catch (e) {
      setEmergencyReports((s) => ({
        ...s,
        loading: false,
        error: e?.message || "Failed to load emergency reports",
      }));
    }
  }, [orgId]);

  React.useEffect(() => {
    loadEmergencyReports();
  }, [loadEmergencyReports]);

  async function startMfa() {
    setMsg("");
    try {
      const d = await api("/api/auth/mfa/setup", { method: "POST", body: JSON.stringify({}) });
      setMfaSecret(d.secret || "");
      setMfaQr(d.otpauth_url || "");
      setRecoveryCodes(d.recovery_codes || []);
      setShowRecovery(true);
    } catch (e) {
      setMsg(e.message || "failed");
    }
  }

  async function confirmMfa() {
    setMsg("");
    try {
      const d = await api("/api/auth/mfa/confirm", {
        method: "POST",
        body: JSON.stringify({ code: mfaCode }),
      });
      setRecoveryCodes(d.recovery_codes || []);
      setShowRecovery(true);
      setMsg("mfa enabled");
    } catch (e) {
      setMsg(e.message || "failed");
    }
  }

  async function disableMfa() {
    setMsg("");
    try {
      await api("/api/auth/mfa/disable", {
        method: "POST",
        body: JSON.stringify({ code: mfaCode }),
      });
      setMsg("mfa disabled");
    } catch (e) {
      setMsg(e.message || "failed");
    }
  }

  async function enableZkForOrg() {
    setMsg("");
    try {
      await ensureDeviceKeypair();

      const current = await api(`/api/orgs/${orgId}/crypto`);
      if (current.has_org_key || current.wrapped_key) throw new Error("This organization already has a key. Load or recover it; do not replace it.");
      const members = await api(`/api/orgs/${orgId}/members`);
      const list = Array.isArray(members.members) ? members.members : [];

      const key = randomOrgKey();
      const wrapped_keys = [];

      for (const m of list) {
        if (!m?.public_key) continue;
        let pub;
        try {
          pub = JSON.parse(m.public_key);
        } catch {
          continue;
        }
        const wrapped_key = await wrapForMember(key, pub);
        wrapped_keys.push({ user_id: m.user_id, wrapped_key });
      }

      if (!wrapped_keys.length) {
        setMsg("no members have public keys registered yet");
        return;
      }

      await api(`/api/orgs/${orgId}/crypto`, {
        method: "POST",
        body: JSON.stringify({ wrapped_keys, encrypted_org_metadata: null }),
      });

      cacheOrgKey(orgId, key);
      setZkStatus((s) => ({ ...s, orgKey: true }));
      setMsg("Organization key created. Content privacy status is shown in the conversion panel.");
    } catch (e) {
      setMsg(e.message || "failed");
    }
  }

  async function rewrapOrgKeyForAllMembers({ rotate = false } = {}) {
    setMsg("");
    try {
      await ensureDeviceKeypair();

      const cached = getCachedOrgKey(orgId);
      if (!cached) {
        setMsg("no org key cached on this device. load org key first.");
        return;
      }

      let keyVersion = orgKeyVersion || 1;
      let orgKeyBytes = cached;

      if (rotate) {
        const r = await api(`/api/orgs/${orgId}/zk/rotate`, { method: "POST" });
        keyVersion = Number(r?.key_version) || keyVersion + 1;
        setOrgKeyVersion(keyVersion);
        orgKeyBytes = randomOrgKey();
      }

      const members = await api(`/api/orgs/${orgId}/members`);
      const list = Array.isArray(members.members) ? members.members : [];

      const wrapped_keys = [];
      const privateStatus = await api(`/api/orgs/${encodeURIComponent(orgId)}/privacy`);
      if (privateStatus.keyCheck) await decryptPrivate(orgKeyBytes, privateStatus.keyCheck, orgId, 'key-check', orgId);
      for (const m of list) {
        const uid = m.user_id || m.userId;
        const devices = m.devices?.length ? m.devices : [{public_key: m.public_key || m.publicKey}];
        for (const device of devices) {
          if (!uid || !device.public_key) continue;
          const pub = JSON.parse(device.public_key);
          const wrapped_key = await wrapForMember(orgKeyBytes, pub);
          wrapped_keys.push({user_id: uid, wrapped_key, ...(device.device_id ? {device_id: device.device_id} : {})});
        }
      }

      if (!wrapped_keys.length) {
        setMsg("no members have public keys registered yet");
        return;
      }

      await api(`/api/orgs/${orgId}/crypto`, {
        method: "POST",
        body: JSON.stringify({ wrapped_keys }),
      });

      if (rotate) {
        cacheOrgKey(orgId, orgKeyBytes);
        setZkStatus((s) => ({ ...s, orgKey: true }));
        setMsg("org key rotated and re-wrapped for members");
      } else {
        setMsg("org key re-wrapped for members");
      }
    } catch (e) {
      setMsg(e.message || "failed");
    }
  }

  async function fetchOrgKey() {
    setMsg("");
    try {
      const device = await ensureDeviceKeypair();
      const d = await api(`/api/orgs/${orgId}/crypto?device_id=${await deviceKeyId(device.pubJwk)}`, { method: "GET" });
      if (!d?.wrapped_key) {
        setMsg("no wrapped key for you on this org yet");
        return;
      }
      const key = await unwrapOrgKey(d.wrapped_key);
      cacheOrgKey(orgId, key);
      setZkStatus((s) => ({ ...s, orgKey: true }));
      setMsg("org key loaded on this device");
    } catch (e) {
      setMsg(String(e?.message || e || "failed"));
    }
  }

  async function saveRecoveryBackup() {
    setRecoveryMsg("");
    try {
      if (!orgId) throw new Error("Missing org id");
      const orgKey = getCachedOrgKey(orgId);
      if (!orgKey) throw new Error("No org key cached yet. Load the org key first, then enable recovery.");
      if (recoveryPassA !== recoveryPassB) throw new Error("Passphrases do not match.");
      const wrapped = await wrapOrgKeyForRecovery(orgKey, recoveryPassA);
      const r = await saveRecoveryToServer(orgId, wrapped);
      setRecoveryInfo({ has: true, updatedAt: r?.updated_at || Date.now() });
      setRecoveryPassA("");
      setRecoveryPassB("");
      setRecoveryMsg("Recovery backup saved ✅");
      setTimeout(() => setRecoveryMsg(""), 1600);
    } catch (e) {
      setRecoveryMsg(e?.message || String(e));
    }
  }

  async function restoreFromRecovery() {
    setRecoveryMsg("");
    try {
      if (!orgId) throw new Error("Missing org id");
      const r = await loadRecoveryFromServer(orgId);
      if (!r?.has_recovery) throw new Error("No recovery backup found for this org/user.");

      const recovered = await unwrapOrgKeyFromRecovery(r, recoveryRestorePass);

      // Some builds returned base64, others return bytes. Normalize to bytes.
      const orgKeyBytes =
        recovered instanceof Uint8Array
          ? recovered
          : Array.isArray(recovered)
          ? new Uint8Array(recovered)
          : typeof recovered === "string"
          ? b64urlToBytes(recovered)
          : null;

      if (!orgKeyBytes || !(orgKeyBytes instanceof Uint8Array) || orgKeyBytes.length < 16) {
        throw new Error("Recovery returned an invalid org key.");
      }

      cacheOrgKey(orgId, orgKeyBytes);
      setZkStatus((s) => ({ ...s, orgKey: true }));
      setRecoveryRestorePass("");
      setRecoveryMsg("Org key restored ✅");
      setTimeout(() => setRecoveryMsg(""), 1600);
    } catch (e) {
      setRecoveryMsg(e?.message || String(e));
    }
  }

  async function removeRecoveryBackup() {
    setRecoveryMsg("");
    try {
      if (!orgId) throw new Error("Missing org id");
      await deleteRecoveryFromServer(orgId);
      setRecoveryInfo({ has: false, updatedAt: null });
      setRecoveryMsg("Recovery backup removed.");
      setTimeout(() => setRecoveryMsg(""), 1200);
    } catch (e) {
      setRecoveryMsg(e?.message || String(e));
    }
  }

  async function refreshEmergencyPanels() {
    await Promise.all([loadEmergencyStatus(), loadEmergencyReports()]);
  }

  return (
    <div style={{ maxWidth: 920, margin: "0 auto", padding: 16 }}>
      <h2>security</h2>
      {!orgId ? <p>For organization lockdown or deletion, <a href="#/orgs">open your organization</a> and choose Settings → Security.</p> : null}
      {orgId ? <>

      <section style={{ marginTop: 16, padding: 12, border: "1px solid #333", borderRadius: 8 }}>
        <h3>Emergency status</h3>
        {emergencyStatus.loading ? (
          <div>loading emergency status…</div>
        ) : (
          <div style={{ fontSize: 14, opacity: 0.9 }}>
            <div>global emergency: {emergencyStatus.globalActive ? "active" : "inactive"}</div>
            <div>org lockdown: {emergencyStatus.orgLockdownActive ? "active" : "inactive"}</div>
            <div>org isolation: {emergencyStatus.orgIsolationActive ? "active" : "inactive"}</div>
            <div>
              global updated:{" "}
              {emergencyStatus.globalUpdatedAt
                ? new Date(emergencyStatus.globalUpdatedAt).toLocaleString()
                : "—"}
            </div>
            <div>
              org updated:{" "}
              {emergencyStatus.orgUpdatedAt
                ? new Date(emergencyStatus.orgUpdatedAt).toLocaleString()
                : "—"}
            </div>
          </div>
        )}
        {emergencyStatus.error ? (
          <div style={{ marginTop: 10, color: "#8b1d1d" }}>{emergencyStatus.error}</div>
        ) : null}
      </section>

      <PrivateStoragePanel orgId={orgId} />
      <ScopedKeysPanel orgId={orgId} />

      <EmergencyProtocolPanel
        orgId={orgId}
        lockdown={emergencyStatus.orgLockdownActive}
        isolated={emergencyStatus.orgIsolationActive}
        onChanged={refreshEmergencyPanels}
      />

      <section style={{ marginTop: 16, padding: 12, border: "1px solid #333", borderRadius: 8 }}>
        <h3>Emergency reports</h3>
        {emergencyReports.loading ? <div>loading emergency reports…</div> : null}
        {!emergencyReports.loading && emergencyReports.error ? (
          <div style={{ color: "#8b1d1d" }}>{emergencyReports.error}</div>
        ) : null}
        {!emergencyReports.loading && !emergencyReports.error && emergencyReports.rows.length === 0 ? (
          <div style={{ opacity: 0.85 }}>No emergency reports yet.</div>
        ) : null}
        {!emergencyReports.loading && !emergencyReports.error && emergencyReports.rows.length > 0 ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "6px 4px" }}>Event</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "6px 4px" }}>Outcome</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "6px 4px" }}>When</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "6px 4px" }}>Actor</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "6px 4px" }}>Org</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "6px 4px" }}>Summary</th>
                </tr>
              </thead>
              <tbody>
                {emergencyReports.rows.map((row) => (
                  <tr key={row.id}>
                    <td style={{ borderBottom: "1px solid #eee", padding: "6px 4px" }}>{row.eventType || "—"}</td>
                    <td style={{ borderBottom: "1px solid #eee", padding: "6px 4px" }}>{row.outcome || "—"}</td>
                    <td style={{ borderBottom: "1px solid #eee", padding: "6px 4px" }}>
                      {row.createdAt ? new Date(row.createdAt).toLocaleString() : "—"}
                    </td>
                    <td style={{ borderBottom: "1px solid #eee", padding: "6px 4px" }}>{row.actorUserId || "—"}</td>
                    <td style={{ borderBottom: "1px solid #eee", padding: "6px 4px" }}>{row.orgId || "—"}</td>
                    <td style={{ borderBottom: "1px solid #eee", padding: "6px 4px" }}>{row.summary || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      </> : null}

      <section style={{ marginTop: 16, padding: 12, border: "1px solid #333", borderRadius: 8 }}>
        <h3>mfa</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={startMfa}>start mfa</button>
          <button onClick={confirmMfa}>confirm</button>
          <button onClick={disableMfa}>disable</button>
        </div>

        <div style={{ marginTop: 8 }}>
          <label>
            6 digit code
            <input value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} style={{ marginLeft: 8, width: 120 }} />
          </label>
        </div>

        {mfaSecret ? (
          <div style={{ marginTop: 8 }}>
            <div>
              <b>secret</b> {mfaSecret}
            </div>
            {mfaQr ? (
              <div style={{ marginTop: 4 }}>
                <a href={mfaQr} target="_blank" rel="noreferrer">
                  open otp url
                </a>
              </div>
            ) : null}
          </div>
        ) : null}

        {showRecovery && recoveryCodes.length ? (
          <div style={{ marginTop: 8 }}>
            <b>recovery codes</b>
            <pre style={{ whiteSpace: "pre-wrap" }}>{recoveryCodes.join("\n")}</pre>
          </div>
        ) : null}
      </section>

      {orgId ?       <section style={{ marginTop: 16, padding: 12, border: "1px solid #333", borderRadius: 8 }}>
        <h3>Organization encryption keys</h3>
        <div style={{ fontSize: 14, opacity: 0.9 }}>
          device key: {zkStatus.deviceKey ? "ok" : "missing"} | org key cached: {zkStatus.orgKey ? "yes" : "no"} | org key version: {orgKeyVersion}
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          <button onClick={enableZkForOrg}>Create initial organization key (admin)</button>
          <button onClick={() => rewrapOrgKeyForAllMembers({ rotate: false })}>rewrap for all members</button>

          <button onClick={fetchOrgKey}>load org key on this device</button>
        </div>

        <div style={{ height: 12 }} />

        <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
          <h4 style={{ margin: 0 }}>Key recovery</h4>
          <p style={{ marginTop: 8 }}>
            Clearing site data wipes your local org key cache. Recovery lets you store a passphrase encrypted backup on the server so you can restore the org key after a wipe.
          </p>

          <div style={{ marginTop: 6, opacity: 0.85 }}>
            <strong>Status:</strong> {recoveryInfo.has ? "backup saved" : "no backup"}
            {recoveryInfo.updatedAt ? ` · last updated ${new Date(recoveryInfo.updatedAt).toLocaleString()}` : ""}
          </div>

          {!recoveryInfo.has ? (
            <>
              <div style={{ display: "grid", gap: 8, maxWidth: 520, marginTop: 10 }}>
                <input type="password" value={recoveryPassA} placeholder="Create recovery passphrase (min 8 chars)" onChange={(e) => setRecoveryPassA(e.target.value)} />
                <input type="password" value={recoveryPassB} placeholder="Confirm passphrase" onChange={(e) => setRecoveryPassB(e.target.value)} />
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                <button onClick={saveRecoveryBackup}>enable recovery</button>
              </div>
            </>
          ) : (
            <>
              <div style={{ display: "grid", gap: 8, maxWidth: 520, marginTop: 10 }}>
                <input type="password" value={recoveryRestorePass} placeholder="Enter passphrase to restore org key" onChange={(e) => setRecoveryRestorePass(e.target.value)} />
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                <button onClick={restoreFromRecovery}>restore org key</button>
                <button onClick={removeRecoveryBackup}>remove backup</button>
              </div>
            </>
          )}

          {recoveryMsg ? <div style={{ marginTop: 10, color: "#8b1d1d" }}>{recoveryMsg}</div> : null}
        </div>
      </section> : null}

      <AccountDestructionPanel />

      {msg ? <div style={{ marginTop: 12, color: "#f88" }}>{msg}</div> : null}
    </div>
  );
}
