import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../utils/api.js";

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
    archive_id: archiveTag ? archiveTag.slice("archive:".length) : "",
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
                <div className="row" style={{ marginTop: 10 }}>
                  <Link className="btn" to={`/org/${encodeURIComponent(orgId)}/witness/capture?retrieve=1&archiveId=${encodeURIComponent(item.archive_id)}`} style={{ textDecoration: "none" }}>
                    Retrieve recording
                  </Link>
                </div>
              ) : null}
            </div>
          ))}
      </div>
    </div>
  );
}
