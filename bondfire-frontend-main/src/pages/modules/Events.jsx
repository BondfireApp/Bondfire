import React, { useEffect, useMemo, useState } from "react";
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

function toItems(data) {
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.events)) return data.events;
  if (Array.isArray(data)) return data;
  return [];
}

function toLinkItems(data) {
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.results)) return data.results;
  return [];
}

function safeText(v) {
  return String(v ?? "");
}

function formatWhen(value) {
  if (value == null || value === "") return "Date pending";
  const n = Number(value);
  const d = Number.isFinite(n) ? new Date(n) : new Date(value);
  if (Number.isNaN(d.getTime())) return "Date pending";
  return d.toLocaleString();
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

function toMillisOrNull(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (Number.isFinite(n)) return n;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.getTime();
}

export default function Events() {
  const { orgId: orgIdParam } = useParams();
  const orgId = orgIdParam || getOrgIdFromHash();

  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [related, setRelated] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState("");
  const [form, setForm] = useState({
    title: "",
    starts_at: "",
    ends_at: "",
    location: "",
    description: "",
  });

  async function refresh() {
    if (!orgId) return;
    setLoading(true);
    setErr("");
    try {
      const data = await api(`/api/orgs/${encodeURIComponent(orgId)}/events`);
      setItems(toItems(data));
    } catch (e) {
      setItems([]);
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh().catch(console.error);
  }, [orgId]);

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
        const items = toLinkItems(data).filter((item) => safeText(item?.type).toLowerCase() === "witness");
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
    return items.filter((item) =>
      [
        safeText(item?.title),
        safeText(item?.description),
        safeText(item?.location),
        normalizeTags(item?.tags ?? item?.tags_json).join(" "),
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle)
    );
  }, [items, q]);

  async function onCreateSubmit(e) {
    e.preventDefault();
    if (!orgId || creating) return;

    setCreateErr("");
    const title = safeText(form.title).trim();
    if (!title) {
      setCreateErr("Title is required.");
      return;
    }

    const startsAt = toMillisOrNull(form.starts_at);
    const endsAt = toMillisOrNull(form.ends_at);

    setCreating(true);
    try {
      await api(`/api/orgs/${encodeURIComponent(orgId)}/events`, {
        method: "POST",
        body: JSON.stringify({
          title,
          starts_at: startsAt,
          ends_at: endsAt,
          location: safeText(form.location).trim(),
          description: safeText(form.description).trim(),
        }),
      });
      setForm({ title: "", starts_at: "", ends_at: "", location: "", description: "" });
      setShowCreate(false);
      await refresh();
    } catch (e2) {
      setCreateErr(e2?.message || String(e2));
    } finally {
      setCreating(false);
    }
  }

  if (!orgId) {
    return <div style={{ padding: 16 }}>No org selected.</div>;
  }

  return (
    <div className="card" style={{ margin: 16, padding: 12 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <h2 className="section-title" style={{ margin: 0, flex: 1 }}>
          Events
        </h2>
        <button className="btn" type="button" onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? "Cancel" : "New event"}
        </button>
      </div>

      {showCreate ? (
        <form className="card" style={{ marginTop: 12, padding: 12 }} onSubmit={onCreateSubmit}>
          <div style={{ fontWeight: 800, marginBottom: 10 }}>Create event</div>
          <div className="grid" style={{ gap: 10 }}>
            <input
              className="input"
              value={form.title}
              onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
              placeholder="Title"
              required
            />
            <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
              <input
                className="input"
                type="datetime-local"
                value={form.starts_at}
                onChange={(e) => setForm((prev) => ({ ...prev, starts_at: e.target.value }))}
                style={{ minWidth: 220, flex: 1 }}
              />
              <input
                className="input"
                type="datetime-local"
                value={form.ends_at}
                onChange={(e) => setForm((prev) => ({ ...prev, ends_at: e.target.value }))}
                style={{ minWidth: 220, flex: 1 }}
              />
            </div>
            <input
              className="input"
              value={form.location}
              onChange={(e) => setForm((prev) => ({ ...prev, location: e.target.value }))}
              placeholder="Location"
            />
            <textarea
              className="input"
              value={form.description}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="Description"
              rows={3}
            />
          </div>
          {createErr ? (
            <div className="error" style={{ marginTop: 10 }}>
              {createErr}
            </div>
          ) : null}
          <div className="row" style={{ marginTop: 10, gap: 10 }}>
            <button className="btn" type="submit" disabled={creating}>
              {creating ? "Saving..." : "Save event"}
            </button>
          </div>
        </form>
      ) : null}

      <div className="row" style={{ gap: 10, marginTop: 12, flexWrap: "wrap" }}>
        <input
          className="input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by title, location, or description"
          style={{ minWidth: 240, flex: 1 }}
        />
        {q ? (
          <button className="btn" type="button" onClick={() => setQ("")}>
            Clear
          </button>
        ) : null}
        <button className="btn" type="button" onClick={() => refresh().catch(console.error)} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {related.length ? (
        <div className="card" style={{ padding: 12, marginTop: 12 }}>
          <div style={{ fontWeight: 800 }}>Related witness records</div>
          <div className="grid" style={{ gap: 8, marginTop: 8 }}>
            {related.map((item, idx) => {
              const key = safeText(item?.id) || `related-${idx}`;
              const href = safeText(item?.href).trim() || "#";
              return (
                <Link key={key} to={href} className="helper" style={{ textDecoration: "none" }}>
                  {safeText(item?.title) || "Untitled witness record"}
                  {item?.subtitle ? ` — ${safeText(item.subtitle)}` : ""}
                </Link>
              );
            })}
          </div>
        </div>
      ) : null}

      {err ? (
        <div className="card" style={{ padding: 12, marginTop: 12 }}>
          <div style={{ fontWeight: 800 }}>Couldn’t load events</div>
          <div className="error" style={{ marginTop: 8 }}>
            {err}
          </div>
        </div>
      ) : null}

      <div className="grid" style={{ gap: 10, marginTop: 12 }}>
        {loading ? <div className="helper">Loading events...</div> : null}

        {!loading && !err && filtered.length === 0 ? (
          <div className="card" style={{ padding: 12 }}>
            <div style={{ fontWeight: 800 }}>{q ? "No matching events" : "No events yet"}</div>
            <div className="helper" style={{ marginTop: 6 }}>
              {q
                ? "Try a different search term."
                : "Get started by creating your first event with title, date/time, and location."}
            </div>
            {!q ? (
              <button className="btn" type="button" style={{ marginTop: 10 }} onClick={() => setShowCreate(true)}>
                Create your first event
              </button>
            ) : null}
          </div>
        ) : null}

        {!loading &&
          !err &&
          filtered.map((item, idx) => {
            const id = item?.id || item?.event_id || "";
            const href = id ? `/org/${encodeURIComponent(orgId)}/events/${encodeURIComponent(id)}` : "#";
            const fallbackKey = `${safeText(item?.title) || "event"}-${safeText(item?.starts_at) || idx}`;
            return (
              <div key={id || fallbackKey} className="card" style={{ padding: 12 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 800, flex: 1 }}>{safeText(item?.title) || "Untitled event"}</div>
                  {id ? (
                    <Link className="btn" to={href}>
                      Open
                    </Link>
                  ) : (
                    <button className="btn" type="button" disabled>
                      Open
                    </button>
                  )}
                </div>
                <div className="helper" style={{ marginTop: 6 }}>
                  {formatWhen(item?.starts_at)}
                  {item?.location ? ` • ${safeText(item.location)}` : ""}
                </div>
                {item?.description ? <div style={{ marginTop: 8 }}>{safeText(item.description)}</div> : null}
                {normalizeTags(item?.tags ?? item?.tags_json).length ? (
                  <div className="helper" style={{ marginTop: 8 }}>
                    Tags: {normalizeTags(item?.tags ?? item?.tags_json).join(", ")}
                  </div>
                ) : null}
              </div>
            );
          })}
      </div>
    </div>
  );
}
