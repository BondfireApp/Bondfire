import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import PublicPage from "../pages/PublicPage.jsx";
import PublicPublicationPage from "../pages/PublicPublicationPage.jsx";

const APP_ORIGIN = (import.meta.env.VITE_APP_ORIGIN || "https://bondfireapp.org").replace(/\/+$/, "");

function platformHostname() {
  try { return new URL(APP_ORIGIN).hostname.toLowerCase(); }
  catch { return "bondfireapp.org"; }
}

function isPlatformHost() {
  if (typeof window === "undefined") return true;
  const hostname = String(window.location.hostname || "").toLowerCase();
  return !hostname || hostname === platformHostname() || hostname === `www.${platformHostname()}` || hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith(".pages.dev") || hostname.endsWith(".workers.dev");
}

async function resolveDomain() {
  const response = await fetch("/api/public/domain", { headers: { Accept: "application/json" } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
  return data;
}

export default function HostedDomainEntry({ children }) {
  const customHost = !isPlatformHost();
  const [state, setState] = React.useState(() => customHost
    ? { loading: true, error: "", data: null }
    : { loading: false, error: "", data: null });

  React.useEffect(() => {
    if (!customHost) return undefined;
    let alive = true;
    resolveDomain()
      .then((data) => alive && setState({ loading: false, error: "", data }))
      .catch((error) => alive && setState({ loading: false, error: String(error?.message || error), data: null }));
    return () => { alive = false; };
  }, [customHost]);

  if (!customHost) return children;
  if (state.loading) return <main style={{ padding: 24 }}>Loading site…</main>;
  if (state.error || !state.data?.mapped) return <main style={{ padding: 24 }}><h1>Site not configured</h1><p>This domain is not connected to an active Bondfire public site.</p></main>;

  if (state.data.surface === "publication" && state.data.orgId) {
    return <PublicPublicationPage orgId={state.data.orgId} />;
  }

  if (state.data.surface === "organization" && state.data.slug) {
    const route = `/p/${encodeURIComponent(state.data.slug)}`;
    return (
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path="/p/:slug" element={<PublicPage />} />
          <Route path="*" element={<PublicPage />} />
        </Routes>
      </MemoryRouter>
    );
  }

  return <main style={{ padding: 24 }}><h1>Site not configured</h1><p>This public surface is not available.</p></main>;
}
