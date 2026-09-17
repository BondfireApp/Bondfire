import React from "react";

const CANONICAL_APP_ORIGIN = "https://bondfireapp.org";
const PRIVATE_HASH_ROUTE = /^\/(?:orgs(?:\/|$)|org\/|security(?:\/|$)|support(?:\/|$)|signin(?:\?|$)|build(?:\?|$))/;

function isLocalDevelopmentHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

export default function CanonicalPrivateOriginGuard() {
  React.useEffect(() => {
    if (typeof window === "undefined") return;

    const hashRoute = String(window.location.hash || "").replace(/^#/, "") || "/";
    if (!PRIVATE_HASH_ROUTE.test(hashRoute)) return;
    if (isLocalDevelopmentHost(window.location.hostname)) return;
    if (window.location.origin === CANONICAL_APP_ORIGIN) return;

    // Device encryption keys live in origin-scoped browser storage. Allowing a
    // private workspace to run on www, a Pages preview, or a publication domain
    // silently creates a different device identity with no scoped key wraps.
    // Keep every production private/admin route on one canonical origin.
    const target = `${CANONICAL_APP_ORIGIN}${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.location.replace(target);
  }, []);

  return null;
}
