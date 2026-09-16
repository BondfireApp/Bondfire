import React from "react";
import "../styles/labor-history-public.css";

function assetUrl(origin, src) {
  const base = String(origin || "").replace(/\/+$/, "");
  const path = String(src || "").startsWith("/") ? String(src) : `/${String(src || "")}`;
  return base ? `${base}${path}` : path;
}

function ArchiveImage({ page, origins, className = "", alt = "" }) {
  const candidates = React.useMemo(
    () => (Array.isArray(origins) ? origins : []).map((origin) => assetUrl(origin, page?.src)).filter(Boolean),
    [origins, page?.src],
  );
  const [sourceIndex, setSourceIndex] = React.useState(0);

  React.useEffect(() => setSourceIndex(0), [page?.src]);
  if (!page?.src || !candidates.length) return null;

  return (
    <img
      className={className}
      src={candidates[Math.min(sourceIndex, candidates.length - 1)]}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setSourceIndex((index) => Math.min(index + 1, candidates.length - 1))}
    />
  );
}
function Reader({ collection, pageIndex, setPageIndex, onClose, origins }) {
  const pages = Array.isArray(collection?.pages) ? collection.pages : [];
  const page = pages[pageIndex] || null;

  React.useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") setPageIndex((index) => Math.max(0, index - 1));
      if (event.key === "ArrowRight") setPageIndex((index) => Math.min(pages.length - 1, index + 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pages.length, setPageIndex]);

  if (!collection) return null;
  return (
    <div className="bf-history-reader" role="dialog" aria-modal="true" aria-label={`${collection.title} reader`}>
      <div className="bf-history-reader-bar">
        <div>
          <strong>{collection.title}</strong>
          <span>Page {pageIndex + 1} of {pages.length}</span>
        </div>
        <button type="button" onClick={onClose}>Close</button>
      </div>      <div className="bf-history-reader-stage">
        {page ? <ArchiveImage page={page} origins={origins} alt={`${collection.title}, page ${pageIndex + 1}`} /> : null}
      </div>
      <div className="bf-history-reader-controls">
        <button type="button" disabled={pageIndex <= 0} onClick={() => setPageIndex((index) => Math.max(0, index - 1))}>Previous</button>
        <input
          aria-label="Archive page number"
          type="number"
          min="1"
          max={Math.max(1, pages.length)}
          value={Math.min(pageIndex + 1, Math.max(1, pages.length))}
          onChange={(event) => {
            const next = Number(event.target.value || 1) - 1;
            setPageIndex(Math.min(Math.max(0, next), Math.max(0, pages.length - 1)));
          }}
        />
        <button type="button" disabled={pageIndex >= pages.length - 1} onClick={() => setPageIndex((index) => Math.min(pages.length - 1, index + 1))}>Next</button>
      </div>
    </div>
  );
}

export default function LaborHistoryArchive({ manifest }) {
  const collections = Array.isArray(manifest?.collections) ? manifest.collections : [];
  const origins = Array.isArray(manifest?.assetOrigins) ? manifest.assetOrigins : [];
  const [query, setQuery] = React.useState("");  const [activeId, setActiveId] = React.useState(() => collections[0]?.id || "");
  const [readerOpen, setReaderOpen] = React.useState(false);
  const [pageIndex, setPageIndex] = React.useState(0);

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return collections;
    return collections.filter((collection) => {
      const haystack = [
        collection.title,
        collection.year,
        collection.event,
        collection.description,
        ...(Array.isArray(collection.tags) ? collection.tags : []),
      ].join(" ").toLowerCase();
      return haystack.includes(needle);
    });
  }, [collections, query]);

  React.useEffect(() => {
    if (!filtered.length) return;
    if (!filtered.some((collection) => collection.id === activeId)) setActiveId(filtered[0].id);
  }, [activeId, filtered]);

  const active = filtered.find((collection) => collection.id === activeId) || filtered[0] || null;
  const openReader = () => {
    setPageIndex(0);
    setReaderOpen(true);
  };
  if (!collections.length) return null;

  return (
    <section id="labor-history" className="bf-history-archive" aria-labelledby="bf-history-title">
      <div className="bf-history-heading">
        <div>
          <div className="bf-organizing-kicker">RED HARBOR ARCHIVE</div>
          <h2 id="bf-history-title">{manifest?.title || "Labor history archive"}</h2>
          {manifest?.subtitle ? <p>{manifest.subtitle}</p> : null}
        </div>
        {manifest?.mirrorUrl ? (
          <a className="bf-organizing-button" href={manifest.mirrorUrl} target="_blank" rel="noopener noreferrer">Open mirror</a>
        ) : null}
      </div>

      <div className="bf-history-layout">
        <aside className="bf-history-sidebar">
          <label>
            <span>Search archive</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search year, event, keyword…" />
          </label>
          <div className="bf-history-collection-list">
            {filtered.map((collection) => (
              <button
                key={collection.id}
                type="button"
                className={collection.id === active?.id ? "is-active" : ""}
                onClick={() => { setActiveId(collection.id); setPageIndex(0); }}
              >                <span>{collection.year || "Archive"}</span>
                <strong>{collection.title}</strong>
                <small>{Array.isArray(collection.pages) ? `${collection.pages.length} pages` : ""}</small>
              </button>
            ))}
          </div>
        </aside>

        <div className="bf-history-main">
          {active ? (
            <>
              <div className="bf-history-tags">
                {active.year ? <span className="is-dark">{active.year}</span> : null}
                {active.event ? <span>{active.event}</span> : null}
                {(Array.isArray(active.tags) ? active.tags : []).map((tag) => <span key={tag}>{tag}</span>)}
              </div>
              <h3>{active.title}</h3>
              {active.description ? <p>{active.description}</p> : null}
              <div className="bf-history-preview">
                {active.pages?.[0] ? <ArchiveImage page={active.pages[0]} origins={origins} alt={`${active.title}, first page`} /> : null}
                <div>
                  <strong>{active.pages?.length || 0} scanned pages</strong>
                  <p>Open the reader to move through the complete collection. If one scan mirror fails, the reader automatically tries the redundant copy.</p>
                  <button type="button" className="bf-organizing-button primary" onClick={openReader}>Open reader</button>
                </div>
              </div>
            </>
          ) : <p>No matching collections.</p>}
        </div>
      </div>
      {readerOpen ? (
        <Reader
          collection={active}
          pageIndex={pageIndex}
          setPageIndex={setPageIndex}
          onClose={() => setReaderOpen(false)}
          origins={origins}
        />
      ) : null}
    </section>
  );
}
