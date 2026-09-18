import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../utils/api.js";
import { cacheOrgKey, decryptJsonWithOrgKey, getCachedOrgKey } from "../../lib/zk.js";
import { loadPrivateKey } from "../../lib/privateCrypto.js";
import { downloadRecBlob, recoverRecRecordingBlob } from "../../lib/recArchiveClient.js";

function getOrgIdFromHash() {
  try {
    const m = (window.location.hash || "").match(/#\/org\/([^/]+)/);
    return m && m[1] ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

function safeText(v) {
  return String(v ?? "");
}

function toItems(data) {
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.records)) return data.records;
  if (Array.isArray(data?.witness)) return data.witness;
  if (Array.isArray(data)) return data;
  return [];
}

function toLinkItems(data) {
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.results)) return data.results;
  return [];
}


function normalizeTags(value) {
  if (Array.isArray(value)) {
    return value.map((tag) => safeText(tag).trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return normalizeTags(parsed);
    } catch {}
    return text
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  return [];
}

function formatWhen(value) {
  if (value == null || value === "") return "Date unknown";
  const n = Number(value);
  const d = Number.isFinite(n) ? new Date(n) : new Date(value);
  if (Number.isNaN(d.getTime())) return "Date unknown";
  return d.toLocaleString();
}

function normalizeItem(raw, index) {
  const id = raw?.id ?? raw?._id ?? null;
  const tags = normalizeTags(raw?.tags ?? raw?.tags_json);
  const archiveTag = tags.find((tag) => tag.startsWith("archive:"));
  return {
    id,
    key: id || `${safeText(raw?.title) || "record"}-${safeText(raw?.happened_at) || index}`,
    title: safeText(raw?.title).trim() || "Untitled recording",
    summary: safeText(raw?.summary).trim() || "Encrypted REC capture.",
    happened_at: raw?.happened_at ?? null,
    visibility: safeText(raw?.visibility).trim() || "private",
    tags,
    archive_id: safeText(raw?.rec_archive_id).trim() || (archiveTag ? archiveTag.slice("archive:".length) : ""),
    encrypted_recovery: safeText(raw?.encrypted_recovery).trim(),
    can_manage_rec: Boolean(raw?.can_manage_rec),
    legacy_rec: Boolean(raw?.legacy_rec),
  };
}

export default function WitnessArchive() {
  const { orgId: orgIdParam } = useParams();
  const orgId = orgIdParam || getOrgIdFromHash();

  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [related, setRelated] = useState([]);
  const [capabilities, setCapabilities] = useState({});
  const [media, setMedia] = useState({});
  const [busyById, setBusyById] = useState({});
  const [noticeById, setNoticeById] = useState({});
  const mediaRef = useRef({});
  const reqSeq = useRef(0);

  async function refresh() {
    if (!orgId) return;

    const requestId = reqSeq.current + 1;
    reqSeq.current = requestId;
    setLoading(true);
    setErr("");

    try {
      const data = await api(`/api/orgs/${encodeURIComponent(orgId)}/witness`);
      if (reqSeq.current !== requestId) return;
      const normalized = toItems(data).map(normalizeItem);
      const nextCapabilities = {};
      let orgKey = getCachedOrgKey(orgId);
      if (!orgKey) {
        try {
          const privacy = await api(`/api/orgs/${encodeURIComponent(orgId)}/privacy`);
          orgKey = await loadPrivateKey(orgId, privacy, api);
          if (orgKey) cacheOrgKey(orgId, orgKey);
        } catch {}
      }
      if (orgKey) {
        for (const item of normalized) {
          if (!item.encrypted_recovery || !item.archive_id) continue;
          try {
            const capability = await decryptJsonWithOrgKey(orgKey, item.encrypted_recovery);
            if (capability?.archiveId === item.archive_id && capability?.recoveryPhrase) {
              nextCapabilities[item.id] = capability;
            }
          } catch {}
        }
      }
      setCapabilities(nextCapabilities);
      setItems(normalized);
    } catch (e) {
      if (reqSeq.current !== requestId) return;
      setItems([]);
      setErr(e?.message || "Unable to load witness records.");
    } finally {
      if (reqSeq.current !== requestId) return;
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [orgId]);

  useEffect(() => () => {
    reqSeq.current += 1;
    for (const entry of Object.values(mediaRef.current)) {
      if (entry?.url) URL.revokeObjectURL(entry.url);
    }
  }, []);

  useEffect(() => {
    let canceled = false;
    async function loadRelated() {
      const needle = safeText(q).trim();
      if (!orgId || !needle) {
        setRelated([]);
        return;
      }
      try {
        const data = await api(
          `/api/orgs/${encodeURIComponent(orgId)}/links/search?q=${encodeURIComponent(needle)}`
        );
        if (canceled) return;
        const items = toLinkItems(data).filter((item) => safeText(item?.type).toLowerCase() === "event");
        setRelated(items.slice(0, 5));
      } catch {
        if (canceled) return;
        setRelated([]);
      }
    }
    loadRelated().catch(() => setRelated([]));
    return () => {
      canceled = true;
    };
  }, [orgId, q]);

  const filtered = useMemo(() => {
    const needle = safeText(q).trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) => [item.title, item.summary, item.visibility, item.tags.join(" ")].join(" ").toLowerCase().includes(needle));
  }, [items, q]);

  function setItemBusy(id, value) {
    setBusyById((current) => ({ ...current, [id]: value }));
  }

  function setItemNotice(id, value) {
    setNoticeById((current) => ({ ...current, [id]: value }));
  }

  function storeMedia(id, entry) {
    mediaRef.current = { ...mediaRef.current, [id]: entry };
    setMedia(mediaRef.current);
  }

  async function ensureRecovered(item) {
    if (mediaRef.current[item.id]?.blob) return mediaRef.current[item.id];
    const capability = capabilities[item.id];
    if (!capability?.recoveryPhrase) throw new Error("This capture does not have account-managed recovery on this device.");
    const recovered = await recoverRecRecordingBlob(item.archive_id, capability.recoveryPhrase);
    const entry = { ...recovered, url: URL.createObjectURL(recovered.blob) };
    storeMedia(item.id, entry);
    return entry;
  }

  async function playRecording(item) {
    setItemBusy(item.id, "play");
    setItemNotice(item.id, "Decrypting recording on this device…");
    try {
      await ensureRecovered(item);
      setItemNotice(item.id, "");
    } catch (error) {
      setItemNotice(item.id, error?.message || "Could not open this recording.");
    } finally {
      setItemBusy(item.id, "");
    }
  }

  async function downloadRecording(item) {
    setItemBusy(item.id, "download");
    setItemNotice(item.id, "Preparing download…");
    try {
      const entry = await ensureRecovered(item);
      downloadRecBlob(entry.blob, `rec-${item.archive_id}.webm`);
      setItemNotice(item.id, "");
    } catch (error) {
      setItemNotice(item.id, error?.message || "Could not download this recording.");
    } finally {
      setItemBusy(item.id, "");
    }
  }
  async function deleteRecording(item) {
    if (!item?.id || busyById[item.id]) return;
    const legacyText = item.legacy_rec
      ? "This older capture cannot be decrypted without its recovery sentence, but it can be permanently deleted because you manage this organization."
      : "This permanently deletes the encrypted REC archive and its Bondfire archive entry.";
    if (!window.confirm(`${legacyText}

Delete this recording?`)) return;

    setItemBusy(item.id, "delete");
    setItemNotice(item.id, "Deleting archive…");
    try {
      await api(`/api/orgs/${encodeURIComponent(orgId)}/witness?id=${encodeURIComponent(item.id)}`, { method: "DELETE" });
      const existing = mediaRef.current[item.id];
      if (existing?.url) URL.revokeObjectURL(existing.url);
      const nextMedia = { ...mediaRef.current };
      delete nextMedia[item.id];
      mediaRef.current = nextMedia;
      setMedia(nextMedia);
      setCapabilities((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      setItems((current) => current.filter((record) => record.id !== item.id));
      setNoticeById((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
    } catch (error) {
      setItemNotice(item.id, error?.message || "Could not delete this recording.");
    } finally {
      setItemBusy(item.id, "");
    }
  }

  if (!orgId) {
    return <div style={{ padding: 16 }}>No org selected.</div>;
  }

  const hasSearch = safeText(q).trim().length > 0;
  const hasError = Boolean(err);

  return (
    <div className="card" style={{ margin: 16, padding: 12 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <h2 className="section-title" style={{ margin: 0, flex: 1 }}>
          REC Archive
        </h2>
        <Link className="btn-red" to={`/org/${encodeURIComponent(orgId)}/witness/capture`} style={{ textDecoration: "none" }}>
          New recording
        </Link>
      </div>

      <div className="helper" style={{ marginTop: 8 }}>
        Browse encrypted REC captures for this organization or start a new camera/microphone recording.
      </div>

      <div className="row" style={{ gap: 10, marginTop: 12, flexWrap: "wrap" }}>
        <input
          className="input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search witness records"
          style={{ minWidth: 240, flex: 1 }}
        />
        <button className="btn" type="button" onClick={() => void refresh()} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {related.length ? (
        <div className="card" style={{ padding: 12, marginTop: 12 }}>
          <div style={{ fontWeight: 800 }}>Related events</div>
          <div className="grid" style={{ gap: 8, marginTop: 8 }}>
            {related.map((item, idx) => {
              const key = safeText(item?.id) || `related-${idx}`;
              const href = safeText(item?.href).trim() || "#";
              return (
                <a key={key} href={`#${href}`} className="helper" style={{ textDecoration: "none" }}>
                  {safeText(item?.title) || "Untitled event"}
                  {item?.subtitle ? ` — ${safeText(item.subtitle)}` : ""}
                </a>
              );
            })}
          </div>
        </div>
      ) : null}

      {hasError ? (
        <div className="card" style={{ padding: 12, marginTop: 12 }}>
          <div style={{ fontWeight: 800 }}>Could not load witness records</div>
          <div className="helper" style={{ marginTop: 6 }}>
            Check your connection and permissions, then refresh.
          </div>
          <div className="error" style={{ marginTop: 8 }}>
            {err}
          </div>
        </div>
      ) : null}

      <div className="grid" style={{ gap: 10, marginTop: 12 }}>
        {loading ? <div className="helper">Loading witness records...</div> : null}

        {!loading && !hasError && filtered.length === 0 ? (
          <div className="card" style={{ padding: 12 }}>
            <div style={{ fontWeight: 800 }}>{hasSearch ? "No matching witness records" : "No REC recordings yet"}</div>
            <div className="helper" style={{ marginTop: 6 }}>
              {hasSearch
                ? "Try a different search term."
                : "Start the archive by making your first encrypted video recording."}
            </div>
            {!hasSearch ? (
              <div className="row" style={{ marginTop: 10 }}>
                <Link className="btn-red" to={`/org/${encodeURIComponent(orgId)}/witness/capture`} style={{ textDecoration: "none" }}>
                  Start recording
                </Link>
              </div>
            ) : null}
          </div>
        ) : null}

        {!loading &&
          !hasError &&
          filtered.map((item) => (
            <div key={item.key} className="card" style={{ padding: 12 }}>
              <div style={{ fontWeight: 800 }}>{item.title}</div>
              <div className="helper" style={{ marginTop: 6 }}>
                {formatWhen(item.happened_at)} • {item.visibility}
              </div>
              <div style={{ marginTop: 8 }}>{item.summary}</div>
              {item.tags.length ? (
                <div className="helper" style={{ marginTop: 6 }}>
                  Tags: {item.tags.join(", ")}
                </div>
              ) : null}
              {item.archive_id ? (
                <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                  {capabilities[item.id] ? (
                    <>
                      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                        <button className="btn" type="button" onClick={() => void playRecording(item)} disabled={Boolean(busyById[item.id])}>
                          {busyById[item.id] === "play" ? "Opening…" : "Play"}
                        </button>
                        <button className="btn" type="button" onClick={() => void downloadRecording(item)} disabled={Boolean(busyById[item.id])}>
                          {busyById[item.id] === "download" ? "Preparing…" : "Download"}
                        </button>
                        {item.can_manage_rec ? (
                          <button className="btn-red" type="button" onClick={() => void deleteRecording(item)} disabled={Boolean(busyById[item.id])}>
                            {busyById[item.id] === "delete" ? "Deleting…" : "Delete"}
                          </button>
                        ) : null}
                      </div>
                      {media[item.id]?.url ? (
                        <video controls autoPlay src={media[item.id].url} style={{ width: "100%", maxHeight: 420, background: "#050606" }} />
                      ) : null}
                    </>
                  ) : item.can_manage_rec ? (
                    <>
                      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                        {item.legacy_rec ? (
                          <Link className="btn" to={`/org/${encodeURIComponent(orgId)}/witness/capture?retrieve=1&archiveId=${encodeURIComponent(item.archive_id)}`} style={{ textDecoration: "none" }}>
                            Recover old recording
                          </Link>
                        ) : null}
                        <button className="btn-red" type="button" onClick={() => void deleteRecording(item)} disabled={Boolean(busyById[item.id])}>
                          {busyById[item.id] === "delete" ? "Deleting…" : "Delete"}
                        </button>
                      </div>
                      <div className="helper">
                        {item.legacy_rec
                          ? "This capture predates account-managed recovery. Its recovery sentence is still required to decrypt it, but you can delete it here without one."
                          : "This device does not currently have the organization key needed for direct playback or download."}
                      </div>
                    </>
                  ) : (
                    <div className="row">
                      <Link className="btn" to={`/org/${encodeURIComponent(orgId)}/witness/capture?retrieve=1&archiveId=${encodeURIComponent(item.archive_id)}`} style={{ textDecoration: "none" }}>
                        Recover recording
                      </Link>
                    </div>
                  )}
                  {noticeById[item.id] ? <div className="helper">{noticeById[item.id]}</div> : null}
                </div>
              ) : null}
            </div>
          ))}
      </div>
    </div>
  );
}
