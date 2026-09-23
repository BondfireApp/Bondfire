import React, { useEffect, useMemo, useState } from "react";
import { Copy, LockKeyhole, Share2, X } from "lucide-react";
import { api } from "../../utils/api.js";
import { deviceKeyId } from "../../../shared/privateContent.js";
import { ensureDeviceKeypair, getCachedOrgKey } from "../../lib/zk.js";
import { decryptRows } from "../../utils/decryptRow.js";

import DrivePublicShare from "./DrivePublicShare.jsx";

function memberId(member) {
  return String(member?.userId || member?.user_id || "").trim();
}

function memberLabel(member) {
  const name = String(member?.name || "").trim();
  const email = String(member?.email || "").trim();
  if (name && name !== "__encrypted__") return name;
  if (email && email !== "__encrypted__") return email;
  const id = memberId(member);
  return id ? `Member ${id.slice(0, 8)}` : "Member";
}

function hasDeviceKey(member) {
  if (Array.isArray(member?.devices) && member.devices.some((device) => device?.public_key || device?.publicKey)) return true;
  return !!(member?.public_key || member?.publicKey);
}

function shareLink(orgId, target) {
  if (typeof window === "undefined" || !orgId || !target?.id || !target?.kind) return "";
  const route = `#/org/${encodeURIComponent(orgId)}/drive?item=${encodeURIComponent(`${target.kind}:${target.id}`)}`;
  return `${window.location.origin}${window.location.pathname}${route}`;
}

export default function DriveShareModal({ open, orgId, target, onClose, onApply, onPublish }) {
  const [members, setMembers] = useState([]);
  const [meUserId, setMeUserId] = useState("");
  const [detail, setDetail] = useState(null);
  const [permissions, setPermissions] = useState({});
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const link = useMemo(() => shareLink(orgId, target), [orgId, target]);

  useEffect(() => {
    if (!open || !orgId || !target?.id || !target?.kind) return undefined;
    let alive = true;
    setLoading(true);
    setError("");
    setCopied(false);
    setBusyLabel("");

    (async () => {
      try {
        if (target.kind === "drive/templates") { setDetail({}); setMembers([]); return; }
        const device = await ensureDeviceKeypair({ register: false });
        const deviceId = await deviceKeyId(device.pubJwk);
        const shareData = await api(`/api/orgs/${encodeURIComponent(orgId)}/drive/shares?kind=${encodeURIComponent(target.kind)}&itemId=${encodeURIComponent(target.id)}&deviceId=${encodeURIComponent(deviceId)}`);
        const memberData = shareData?.canManage
          ? await api(`/api/orgs/${encodeURIComponent(orgId)}/members`)
          : { members: [], meUserId: shareData?.meUserId || "" };
        if (!alive) return;
        let nextMembers = Array.isArray(memberData?.members) ? memberData.members : [];
        const orgKey = getCachedOrgKey(orgId);
        if (orgKey && nextMembers.length) nextMembers = await decryptRows(orgKey, nextMembers);
        const selfId = String(memberData?.meUserId || shareData?.meUserId || "");
        const next = {};
        if (Array.isArray(shareData?.grants)) {
          for (const grant of shareData.grants) {
            const userId = String(grant?.userId || "");
            if (userId) next[userId] = grant?.permission === "view" ? "view" : "edit";
          }
        }
        if (!shareData?.restricted) {
          for (const member of nextMembers) {
            const userId = memberId(member);
            if (!userId) continue;
            next[userId] = String(member?.role || "") === "viewer" ? "view" : "edit";
          }
          if (!nextMembers.length && selfId) {
            next[selfId] = String(shareData?.role || "") === "viewer" ? "view" : "edit";
          }
        }
        setMembers(nextMembers);
        setMeUserId(selfId);
        setDetail(shareData || {});
        setPermissions(next);
      } catch (loadError) {
        if (alive) setError(String(loadError?.message || loadError || "Could not load sharing."));
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => { alive = false; };
  }, [open, orgId, target?.id, target?.kind]);

  if (!open || !target) return null;

  const canManage = !!detail?.canManage;
  const selectedCount = Object.keys(permissions).filter((id) => permissions[id]).length;

  function setMemberAccess(userId, value) {
    if (!userId || userId === meUserId) return;
    setPermissions((prev) => {
      const next = { ...prev };
      if (!value) delete next[userId];
      else next[userId] = value;
      return next;
    });
  }

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Could not copy the link. Your browser blocked clipboard access.");
    }
  }

  async function save() {
    if (!canManage || busy) return;
    const grants = Object.entries(permissions)
      .filter(([, permission]) => permission === "view" || permission === "edit")
      .map(([userId, permission]) => ({ userId, permission }));
    if (meUserId && !grants.some((grant) => grant.userId === meUserId)) grants.push({ userId: meUserId, permission: "edit" });

    const missingKeys = grants
      .filter((grant) => grant.userId !== meUserId)
      .filter((grant) => !hasDeviceKey(members.find((member) => memberId(member) === grant.userId)));
    if (missingKeys.length) {
      setError("One or more selected members have not registered an encryption key on a device yet. They need to sign in once before this item can be shared with them.");
      return;
    }

    setBusy(true);
    setBusyLabel("Preparing encrypted access…");
    setError("");
    try {
      await onApply?.({
        target,
        members,
        meUserId,
        grants,
        existing: detail || {},
        onProgress: (label) => setBusyLabel(String(label || "Updating access…")),
      });
      onClose?.();
    } catch (saveError) {
      setError(String(saveError?.message || saveError || "Sharing failed."));
    } finally {
      setBusy(false);
      setBusyLabel("");
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Manage access for ${target.label || "Drive item"}`}
      style={{ position: "fixed", inset: 0, zIndex: 1200, background: "rgba(0,0,0,0.72)", display: "grid", placeItems: "center", padding: 16 }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose?.();
      }}
    >
      <div style={{ width: "min(620px, 100%)", maxHeight: "min(760px, 92vh)", overflow: "auto", background: "#0d0e10", border: "1px solid rgba(255,255,255,0.13)", borderRadius: 16, boxShadow: "0 24px 80px rgba(0,0,0,.58)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 16px 12px", borderBottom: "1px solid rgba(255,255,255,.08)" }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, display: "grid", placeItems: "center", background: "rgba(255,255,255,.06)" }}><Share2 size={18} /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 19 }}>Manage access for {target.label || "item"}</h2>
            <div className="helper" style={{ marginTop: 3 }}>{detail?.inherited ? "Access is inherited from a restricted folder." : detail?.restricted ? "Only the selected organization members below can open this item." : "Everyone in this organization with Drive access can already open this item."}</div>
          </div>
          <button className="btn" type="button" aria-label="Close sharing" onClick={onClose} disabled={busy} style={{ padding: 7 }}><X size={16} /></button>
        </div>

        <div style={{ padding: 16, display: "grid", gap: 16 }}>
          <DrivePublicShare key={`${orgId}:${target.kind}:${target.id}`} orgId={orgId} target={target} onPublish={onPublish} onBusy={setBusy} />
          {target.kind !== "drive/templates" && <>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: 12, border: "1px solid rgba(255,255,255,.09)", borderRadius: 12, background: "rgba(255,255,255,.025)" }}>
            <LockKeyhole size={17} style={{ marginTop: 2, flex: "0 0 auto" }} />
            <div className="helper" style={{ lineHeight: 1.5 }}>
              {detail?.restricted || detail?.inherited ? "Restricted access is end-to-end encrypted. Bondfire stores permission records and wrapped item keys, not a readable copy of the document." : "Drive items are available to organization members by default. Use this panel only when you need to restrict this item to specific members."}
            </div>
          </div>

          <div>
            <div style={{ fontWeight: 750, marginBottom: 4 }}>Private Drive link</div>
            <div className="helper" style={{ marginBottom: 8 }}>Requires a Bondfire account with permission to this item. Copying this link does not grant access by itself.</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input className="input" value={link} readOnly style={{ flex: 1, minWidth: 0 }} />
              <button className="btn" type="button" onClick={copyLink} disabled={!link}><Copy size={15} /> {copied ? "Copied" : "Copy"}</button>
            </div>
          </div>

          <div>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
              <div style={{ fontWeight: 750 }}>{detail?.restricted || detail?.inherited ? "People with access" : "Organization members"}</div>
              <div className="helper">{detail?.restricted || detail?.inherited ? `${selectedCount} selected` : "Access inherited from Drive"}</div>
            </div>

            {loading ? <div className="helper" style={{ padding: "14px 0" }}>Loading organization members…</div> : (
              <div style={{ display: "grid", gap: 6 }}>
                {members.map((member) => {
                  const userId = memberId(member);
                  if (!userId) return null;
                  const isSelf = userId === meUserId;
                  const ready = isSelf || hasDeviceKey(member);
                  const value = permissions[userId] || "";
                  return (
                    <div key={userId} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 150px", gap: 10, alignItems: "center", padding: "9px 10px", border: "1px solid rgba(255,255,255,.075)", borderRadius: 10 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{memberLabel(member)}{isSelf ? " (you)" : ""}</div>
                        <div className="helper" style={{ fontSize: 12 }}>{ready ? (member.role || "member") : "Needs to sign in on a device before encrypted sharing is available"}</div>
                      </div>
                      <select
                        className="input"
                        value={isSelf ? "edit" : value}
                        disabled={!canManage || busy || isSelf || !ready}
                        onChange={(event) => setMemberAccess(userId, event.target.value)}
                        aria-label={`Access for ${memberLabel(member)}`}
                      >
                        <option value="">No access</option>
                        <option value="view">Can view</option>
                        <option value="edit" disabled={String(member?.role || "") === "viewer"}>Can edit</option>
                      </select>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          </>}

          {error ? <div role="alert" style={{ color: "#ff9b9b", whiteSpace: "pre-wrap" }}>{error}</div> : null}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
            <button className="btn" type="button" onClick={onClose} disabled={busy}>Cancel</button>
            {canManage ? <button className="btn-red" type="button" onClick={save} disabled={busy || loading}>{busy ? (busyLabel || "Updating access…") : detail?.restricted ? "Update access" : "Restrict access"}</button> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
