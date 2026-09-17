import React from "react";

const CANONICAL_APP_ORIGIN = "https://bondfireapp.org";
const PRIVATE_HASH_ROUTE = /^\/(?:orgs(?:\/|$)|org\/|security(?:\/|$)|support(?:\/|$)|signin(?:\?|$)|build(?:\?|$))/;

function isTrustedAppHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host === "bondfireapp.org"
    || host === "www.bondfireapp.org"
    || host === "bondfire-frontend.pages.dev"
    || host.endsWith(".bondfire-frontend.pages.dev")
    || host === "localhost"
    || host === "127.0.0.1"
    || host === "::1";
}

export default function CanonicalPrivateOriginGuard() {
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (isTrustedAppHost(window.location.hostname)) return;

    const hashRoute = String(window.location.hash || "").replace(/^#/, "") || "/";
    if (!PRIVATE_HASH_ROUTE.test(hashRoute)) return;

    const target = `${CANONICAL_APP_ORIGIN}${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.location.replace(target);
  }, []);

  return null;
}
