import React from "react";
import { ColophonWorkspace } from "colophon/workspace";
import colophonNativeStyles from "../modules/colophon/colophon-native.css?inline";
import { createPublicColophonFetchBridge } from "../lib/publicColophonBridge.js";
import { usePublicDocumentBrand } from "../lib/publicDocumentBrand.js";

const PUBLIC_SESSION = Object.freeze({
  authenticated: false,
  role: "public",
  capabilities: [],
  privateMode: false,
  mode: "bondfire-public",
});

function PublicColophonStyles() {
  React.useLayoutEffect(() => {
    const style = document.createElement("style");
    style.setAttribute("data-bondfire-public-colophon-styles", "true");
    style.textContent = colophonNativeStyles;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  return null;
}

export default function PublicPublicationPage({ orgId }) {
  const [bridgeReady, setBridgeReady] = React.useState(false);
  const [brandPublication, setBrandPublication] = React.useState({});
  const [brandManifest, setBrandManifest] = React.useState(null);
  const originalFetchRef = React.useRef(null);

  const host = React.useMemo(() => ({
    mode: "bondfire-public",
    embedded: true,
    standalone: false,
    routeBase: "",
    apiBase: "/api/public/colophon-runtime",
    session: PUBLIC_SESSION,
  }), []);

  React.useLayoutEffect(() => {
    if (typeof window === "undefined" || typeof window.fetch !== "function" || !orgId) return undefined;

    let alive = true;
    const originalFetch = window.fetch.bind(window);
    originalFetchRef.current = originalFetch;
    window.fetch = createPublicColophonFetchBridge({
      orgId,
      baseFetch: originalFetch,
      origin: window.location.origin,
      onProjection: (projection) => {
        if (alive) setBrandPublication(projection?.publication || {});
      },
    });
    setBridgeReady(true);

    return () => {
      alive = false;
      if (originalFetchRef.current) window.fetch = originalFetchRef.current;
      originalFetchRef.current = null;
      setBridgeReady(false);
    };
  }, [orgId]);

  React.useEffect(() => {
    const organizationSlug = String(brandPublication?.organizationSlug || "").trim();
    if (!organizationSlug) {
      setBrandManifest(null);
      return undefined;
    }

    let alive = true;
    fetch(`/${encodeURIComponent(organizationSlug)}/brand.json`, { headers: { Accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (alive) setBrandManifest(data && typeof data === "object" ? data : null);
      })
      .catch(() => {
        if (alive) setBrandManifest(null);
      });

    return () => { alive = false; };
  }, [brandPublication?.organizationSlug]);

  const brandConfig = brandPublication?.config || {};
  const brandSite = brandConfig.site && typeof brandConfig.site === "object" ? brandConfig.site : {};
  usePublicDocumentBrand(
    brandPublication?.name || brandManifest?.title || "",
    brandPublication?.logoUrl || brandSite.logoUrl || brandSite.logoURL || brandConfig.logoUrl || brandConfig.logoURL || brandManifest?.iconUrl || "",
  );

  if (!bridgeReady) {
    return <main style={{ padding: 24 }}>Loading publication…</main>;
  }

  return (
    <div className="bondfire-colophon-native-shell bondfire-colophon-public-shell">
      <PublicColophonStyles />
      <ColophonWorkspace
        host={host}
        session={PUBLIC_SESSION}
        orgId={orgId}
        embedded
      />
    </div>
  );
}
