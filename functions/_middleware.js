import {
  getPublicSiteDomainByHostname,
  normalizeHostname,
  parsePublicDomainScope,
} from "./api/_lib/publicSiteDomains.js";

const STATIC_FILE_RE = /\.[a-z0-9]{1,8}$/i;

export function shouldServePublicationShellRequest(request) {
  const method = String(request?.method || "GET").toUpperCase();
  if (!["GET", "HEAD"].includes(method)) return false;

  const url = new URL(request.url);
  if (url.pathname === "/") return false;
  if (url.pathname.startsWith("/api/")) return false;
  if (url.pathname.startsWith("/.well-known/")) return false;
  if (STATIC_FILE_RE.test(url.pathname)) return false;

  const accept = String(request.headers.get("accept") || "").toLowerCase();
  return accept.includes("text/html") || accept.includes("application/xhtml+xml");
}

export async function onRequest(context) {
  if (!shouldServePublicationShellRequest(context.request)) {
    return context.next();
  }

  const db = context.env?.BF_DB;
  if (!db || typeof db.prepare !== "function") return context.next();

  const requestUrl = new URL(context.request.url);
  const hostname = normalizeHostname(requestUrl.hostname || context.request.headers.get("host") || "");
  if (!hostname) return context.next();

  try {
    const domain = await getPublicSiteDomainByHostname(db, hostname);
    if (!domain) return context.next();

    const scope = parsePublicDomainScope(domain.scope);
    if (!scope.orgId || scope.surface !== "publication") return context.next();

    // Keep the browser URL untouched while asking Pages' asset server for the
    // root application shell. React Router then resolves the clean publication
    // path (/post/:slug, /archive, /about, or a publication-local 404).
    const shellUrl = new URL(context.request.url);
    shellUrl.pathname = "/";
    shellUrl.search = "";
    shellUrl.hash = "";

    const shellRequest = new Request(shellUrl.toString(), context.request);
    return context.env.ASSETS.fetch(shellRequest);
  } catch (error) {
    console.error("publication domain shell routing failed", error);
    return context.next();
  }
}
