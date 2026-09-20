import React from "react";
import { useParams } from "react-router-dom";
import PublicPageDefault from "./PublicPageDefault.jsx";
import OrganizingPublicPage from "./OrganizingPublicPage.jsx";
import BlockPublicPage from "./BlockPublicPage.jsx";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");

async function loadPublicPage(slug) {
  const path = "/api/public/" + encodeURIComponent(slug);
  const response = await fetch(API_BASE + path, { headers: { Accept: "application/json" } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) throw new Error(data?.error || data?.message || "HTTP " + response.status);
  return data;
}

export default function PublicPage() {
  const { slug } = useParams();
  const publicSlug = String(slug || "").trim();
  const [state, setState] = React.useState({ loading: Boolean(publicSlug), data: null, error: "" });

  React.useEffect(() => {
    if (!publicSlug) {
      setState({ loading: false, data: null, error: "" });
      return undefined;
    }
    let alive = true;
    loadPublicPage(publicSlug)
      .then((data) => { if (alive) setState({ loading: false, data, error: "" }); })
      .catch((error) => { if (alive) setState({ loading: false, data: null, error: String(error?.message || error) }); });
    return () => { alive = false; };
  }, [publicSlug]);

  if (!publicSlug) return <PublicPageDefault />;
  if (state.loading) return <div style={{ padding: 24 }} className="helper">Loading public site…</div>;
  if (state.data?.public?.page?.blocks?.length) {
    return <BlockPublicPage slug={publicSlug} initialData={state.data} />;
  }
  if (!state.data?.public || state.data.public.template !== "organizing") {
    return <PublicPageDefault />;
  }
  return <OrganizingPublicPage slug={publicSlug} initialData={state.data} />;
}
