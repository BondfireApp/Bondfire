import React from "react";
import "../styles/publication-public.css";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");

function articleSlugFromPath() {
  if (typeof window === "undefined") return "";
  const path = String(window.location.pathname || "/").replace(/\/+$/, "") || "/";
  const match = path.match(/^\/(?:post|bulletin|article)\/([^/]+)$/i);
  return match ? decodeURIComponent(match[1]) : "";
}

async function loadPublication(orgId, slug = "") {
  const query = new URLSearchParams({ org: orgId });
  if (slug) query.set("slug", slug);
  const response = await fetch(`${API_BASE}/api/public/publication?${query.toString()}`, {
    headers: { Accept: "application/json" },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${response.status}`);
  return data;
}

function displayDate(item) {
  const value = item?.publishedAt || item?.published_at || item?.createdAt || item?.created_at || "";
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function ArticleBody({ item }) {
  const body = String(item?.body || "");
  if (!body && !Array.isArray(item?.richBody)) return null;
  if (body) return <div className="bf-publication-body">{body}</div>;
  return (
    <div className="bf-publication-body">
      {(item.richBody || []).map((block, index) => {
        const text = typeof block === "string" ? block : String(block?.text || block?.content || "");
        return text ? <p key={index}>{text}</p> : null;
      })}
    </div>
  );
}

export default function PublicPublicationPage({ orgId }) {
  const slug = articleSlugFromPath();
  const [state, setState] = React.useState({ loading: true, error: "", data: null });

  React.useEffect(() => {
    let alive = true;
    loadPublication(orgId, slug)
      .then((data) => alive && setState({ loading: false, error: "", data }))
      .catch((error) => alive && setState({ loading: false, error: String(error?.message || error), data: null }));
    return () => { alive = false; };
  }, [orgId, slug]);

  if (state.loading) return <main className="bf-publication-site"><p className="bf-publication-empty">Loading publication…</p></main>;
  if (state.error || !state.data) return <main className="bf-publication-site"><p className="bf-publication-empty">This publication is unavailable.</p></main>;

  const publication = state.data.publication || {};
  const name = publication.name || "Publication";
  const item = state.data.item;
  const items = Array.isArray(state.data.items) ? state.data.items : [];

  return (
    <div className="bf-publication-site">
      <header className="bf-publication-header">
        <a className="bf-publication-brand" href="/">{name}</a>
        {publication.description ? <p>{publication.description}</p> : null}
      </header>

      <main className="bf-publication-main">
        {slug ? (
          item ? (
            <article className="bf-publication-article">
              <a className="bf-publication-back" href="/">← All posts</a>
              <h1>{item.title || "Untitled"}</h1>
              <div className="bf-publication-meta">{[item.author, displayDate(item)].filter(Boolean).join(" · ")}</div>
              {item.excerpt ? <p className="bf-publication-deck">{item.excerpt}</p> : null}
              <ArticleBody item={item} />
            </article>
          ) : <p className="bf-publication-empty">That article could not be found.</p>
        ) : (
          <section>
            <div className="bf-publication-kicker">LATEST</div>
            <h1>{name}</h1>
            {!items.length ? <p className="bf-publication-empty">No published posts yet.</p> : null}
            <div className="bf-publication-list">
              {items.map((entry) => (
                <article key={entry.id || entry.slug} className="bf-publication-card">
                  <div className="bf-publication-meta">{[entry.author, displayDate(entry)].filter(Boolean).join(" · ")}</div>
                  <h2><a href={`/post/${encodeURIComponent(entry.slug || entry.id)}`}>{entry.title || "Untitled"}</a></h2>
                  {entry.excerpt ? <p>{entry.excerpt}</p> : null}
                </article>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
