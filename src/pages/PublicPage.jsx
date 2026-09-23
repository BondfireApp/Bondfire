import { TreasuryPublicLink } from "../modules/work/WorkIntegrations.jsx";
import React from "react";
import { useParams } from "react-router-dom";
import PublicPageDefault from "./PublicPageDefault.jsx";
import OrganizingPublicPage from "./OrganizingPublicPage.jsx";
import BlockPublicPage from "./BlockPublicPage.jsx";
import PublicPageAdminBar from "../components/PublicPageAdminBar.jsx";
import { api } from "../utils/api.js";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");

async function loadPublicPage(slug) {
  return api("/api/public/" + encodeURIComponent(slug), { method: "GET" });
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

  let pageContent;
  if (state.data?.public?.page?.blocks?.length) {
    pageContent = <BlockPublicPage slug={publicSlug} initialData={state.data} />;
  } else if (!state.data?.public || state.data.public.template !== "organizing") {
    pageContent = <PublicPageDefault />;
  } else {
    pageContent = <OrganizingPublicPage slug={publicSlug} initialData={state.data} />;
  }

  return (
    <PublicPageAdminBar
      slug={publicSlug}
      initialData={state.data}
      onPublished={(page) => {
        setState((current) => ({
          ...current,
          data: {
            ...current.data,
            public: { ...(current.data?.public || {}), page },
          },
        }));
      }}
    >
      {pageContent}
      <TreasuryPublicLink slug={publicSlug} />
    </PublicPageAdminBar>
  );
}
