import React from "react";
import { ColophonWorkspace } from "colophon/workspace";
import colophonNativeStyles from "../modules/colophon/colophon-native.css?inline";
import { createPublicColophonFetchBridge } from "../lib/publicColophonBridge.js";

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
  const originalFetchRef = React.useRef(null);

  const host = React.useMemo(() => ({
    mode: "bondfire-public",
    embedded: true,
    standalone: false,
    routeBase: "",
    apiBase: "/api",
    session: PUBLIC_SESSION,
  }), []);

  React.useLayoutEffect(() => {
    if (typeof window === "undefined" || typeof window.fetch !== "function" || !orgId) return undefined;

    const originalFetch = window.fetch.bind(window);
    originalFetchRef.current = originalFetch;
    window.fetch = createPublicColophonFetchBridge({
      orgId,
      baseFetch: originalFetch,
      origin: window.location.origin,
    });
    setBridgeReady(true);

    return () => {
      if (originalFetchRef.current) window.fetch = originalFetchRef.current;
      originalFetchRef.current = null;
      setBridgeReady(false);
    };
  }, [orgId]);

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
