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
  const touchStartX = React.useRef(null);
  const touchStartY = React.useRef(null);

  const goPrev = React.useCallback(
    () => setPageIndex((index) => Math.max(0, index - 1)),
    [setPageIndex],
  );
  const goNext = React.useCallback(
    () => setPageIndex((index) => Math.min(pages.length - 1, index + 1)),
    [pages.length, setPageIndex],
  );

  React.useEffect(() => {
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (event) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") goPrev();
      if (event.key === "ArrowRight") goNext();
    };

    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = priorOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [goNext, goPrev, onClose]);

  if (!collection || !pages.length) return null;

  const start = Math.max(0, pageIndex - 2);
  const end = Math.min(pages.length, pageIndex + 3);
  const visiblePages = pages.slice(start, end);

  const handleTouchStart = (event) => {
    const touch = event.touches?.[0];
    if (!touch) return;
    touchStartX.current = touch.clientX;
    touchStartY.current = touch.clientY;
  };

  const handleTouchEnd = (event) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const touch = event.changedTouches?.[0];
    if (!touch) return;

    const dx = touch.clientX - touchStartX.current;
    const dy = touch.clientY - touchStartY.current;
    touchStartX.current = null;
    touchStartY.current = null;

    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
    if (dx < 0) goNext();
    else goPrev();
  };

  return (
    <div className="bf-history-reader" role="dialog" aria-modal="true" aria-label={`${collection.title} reader`}>
      <div className="bf-history-reader-bar">
        <div className="bf-history-reader-title">
          <span className="bf-history-reader-kicker">Full reader</span>
          <strong>{collection.title}</strong>
          <span>Page {pageIndex + 1} of {pages.length}</span>
        </div>
        <div className="bf-history-reader-top-actions">
          <button type="button" disabled={pageIndex === 0} onClick={goPrev}>Prev</button>
          <button type="button" disabled={pageIndex === pages.length - 1} onClick={goNext}>Next</button>
          <button type="button" className="is-close" onClick={onClose}>Close</button>
        </div>
      </div>

      <div
        className="bf-history-reader-stage"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <button
          type="button"
          className="bf-history-reader-hit bf-history-reader-hit-prev"
          aria-label="Previous page"
          disabled={pageIndex === 0}
          onClick={goPrev}
        />
        <button
          type="button"
          className="bf-history-reader-hit bf-history-reader-hit-next"
          aria-label="Next page"
          disabled={pageIndex === pages.length - 1}
          onClick={goNext}
        />
        <div className="bf-history-reader-page">
          {page ? (
            <ArchiveImage
              page={page}
              origins={origins}
              alt={page.title || `${collection.title}, page ${pageIndex + 1}`}
            />
          ) : null}
        </div>
      </div>

      <div className="bf-history-reader-controls" aria-label="Reader page navigation">
        <button type="button" disabled={pageIndex === 0} onClick={goPrev}>Prev</button>

        {start > 0 ? (
          <button type="button" onClick={() => setPageIndex(0)} aria-label="Go to page 1">1</button>
        ) : null}

        {start > 1 ? <span className="bf-history-reader-ellipsis" aria-hidden="true">…</span> : null}

        {visiblePages.map((item, offset) => {
          const index = start + offset;
          const active = index === pageIndex;
          return (
            <button
              key={`${item.src}-${index}`}
              type="button"
              className={active ? "is-active" : ""}
              onClick={() => setPageIndex(index)}
              aria-current={active ? "page" : undefined}
              aria-label={`Go to page ${index + 1}`}
            >
              {index + 1}
            </button>
          );
        })}

        {end < pages.length - 1 ? <span className="bf-history-reader-ellipsis" aria-hidden="true">…</span> : null}

        {end < pages.length ? (
          <button
            type="button"
            onClick={() => setPageIndex(pages.length - 1)}
            aria-label={`Go to page ${pages.length}`}
          >
            {pages.length}
          </button>
        ) : null}

        <button type="button" disabled={pageIndex === pages.length - 1} onClick={goNext}>Next</button>
      </div>
    </div>
  );
}

export default function LaborHistoryArchive({ manifest }) {
  const collections = Array.isArray(manifest?.collections) ? manifest.collections : [];
  const origins = Array.isArray(manifest?.assetOrigins) ? manifest.assetOrigins : [];
  const [query, setQuery] = React.useState("");
  const [activeId, setActiveId] = React.useState(() => collections[0]?.id || "");
  const [readerOpen, setReaderOpen] = React.useState(false);
  const [pageIndex, setPageIndex] = React.useState(0);

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return collections;
    return collections.filter((collection) => {
      const pageText = (Array.isArray(collection.pages) ? collection.pages : [])
        .flatMap((page) => [page?.title, page?.summary, ...(Array.isArray(page?.keywords) ? page.keywords : [])])
        .filter(Boolean);
      const haystack = [
        collection.title,
        collection.year,
        collection.event,
        collection.description,
        ...(Array.isArray(collection.tags) ? collection.tags : []),
        ...pageText,
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
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search year, event, page keyword…" />
          </label>
          <div className="bf-history-collection-list">
            {filtered.map((collection) => (
              <button
                key={collection.id}
                type="button"
                className={collection.id === active?.id ? "is-active" : ""}
                onClick={() => { setActiveId(collection.id); setPageIndex(0); }}
              >
                <span>{collection.year || "Archive"}</span>
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
