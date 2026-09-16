import React from "react";
import { createPortal } from "react-dom";
import { Link, UNSAFE_RouteContext as RouteContext, useLocation, useParams } from "react-router-dom";
import colophonNativeStyles from "./colophon-native.css?inline";
import { createBondfireColophonAdapter } from "./bondfireAdapter.js";
import { createColophonHostContext, colophonCapabilitiesForRole } from "./hostContract.js";
import { handlePrivateColophonFetch } from "./privateColophonRuntime.js";
import { api } from "../../utils/api.js";

let originalFetch = null;
let activeApiBase = "";
let activePrivateHost = null;

const EMPTY_COLOPHON_ROUTE_CONTEXT = Object.freeze({
  outlet: null,
  matches: [],
  isDataRoute: false,
});

function ColophonNativeStyles() {
  React.useLayoutEffect(() => {
    const style = document.createElement("style");
    style.setAttribute("data-bondfire-colophon-native-styles", "true");
    style.textContent = colophonNativeStyles;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  return null;
}

function readCookie(name) {
  if (typeof document === "undefined") return "";
  const safe = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = document.cookie.match(new RegExp(`(?:^|; )${safe}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

function addCsrfHeader(input, init) {
  const method = String(init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return { input, init };

  const token = readCookie("bf_csrf");
  if (!token) return { input, init };

  const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
  if (!headers.has("X-CSRF")) headers.set("X-CSRF", token);

  if (input instanceof Request) {
    return { input: new Request(input, { headers }), init };
  }
  return { input, init: { ...init, headers } };
}

function ensureHostFetchBridge(apiBase, privateHost = null) {
  activeApiBase = String(apiBase || "").replace(/\/+$/, "");
  activePrivateHost = privateHost || null;
  if (originalFetch || typeof window === "undefined" || typeof window.fetch !== "function") return;

  originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (!activeApiBase) {
      const request = addCsrfHeader(input, init);
      return originalFetch(request.input, request.init);
    }

    const raw = input instanceof Request ? input.url : String(input || "");
    const url = new URL(raw, window.location.origin);
    const sameOrigin = url.origin === window.location.origin;
    const isBondfireOwned =
      url.pathname.startsWith("/api/orgs/") ||
      url.pathname.startsWith("/api/auth/") ||
      url.pathname.startsWith("/api/support/");

    if (activePrivateHost && sameOrigin) {
      const hostedPrefix = `${activeApiBase}/`;
      let suffix = "";
      if (url.pathname.startsWith(hostedPrefix)) suffix = url.pathname.slice(hostedPrefix.length);
      else if (url.pathname.startsWith("/api/") && !isBondfireOwned) suffix = url.pathname.replace(/^\/api\/?/, "");
      if (suffix) {
        return handlePrivateColophonFetch({
          orgId: activePrivateHost.orgId,
          session: activePrivateHost.session,
          input,
          init,
          suffix,
        });
      }
    }

    if (!sameOrigin || !url.pathname.startsWith("/api/") || isBondfireOwned) {
      const request = addCsrfHeader(input, init);
      return originalFetch(request.input, request.init);
    }

    const suffix = url.pathname.replace(/^\/api\/?/, "");
    url.pathname = `${activeApiBase}/${suffix}`.replace(/\/{2,}/g, "/");

    const request = addCsrfHeader(
      input instanceof Request ? new Request(url.toString(), input) : url.toString(),
      init,
    );
    return originalFetch(request.input, request.init);
  };
}

function setControlledInputValue(input, value) {
  if (!input) return;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function NativeLogoUploadControl({ targetInput }) {
  const [state, setState] = React.useState("idle");
  const [message, setMessage] = React.useState("");
  const [previewUrl, setPreviewUrl] = React.useState(() => String(targetInput?.value || ""));

  React.useEffect(() => {
    const sync = () => setPreviewUrl(String(targetInput?.value || ""));
    sync();
    targetInput?.addEventListener("input", sync);
    targetInput?.addEventListener("change", sync);
    return () => {
      targetInput?.removeEventListener("input", sync);
      targetInput?.removeEventListener("change", sync);
    };
  }, [targetInput]);

  async function uploadLogo(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!String(file.type || "").startsWith("image/")) {
      setState("error");
      setMessage("Choose an image file for the publication logo.");
      return;
    }

    setState("uploading");
    setMessage("");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("filename", file.name);
      form.append("title", "Publication logo");
      form.append("folder", "logos");
      form.append("role", "publication-logo");
      form.append("mimeType", file.type || "application/octet-stream");

      const response = await fetch("/api/media/files", {
        method: "POST",
        credentials: "include",
        body: form,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) {
        throw new Error(data?.error || `Logo upload failed (${response.status})`);
      }

      const media = data.media || data.asset || data.item || {};
      const url = String(media.publicUrl || media.url || media.downloadUrl || "").trim();
      if (!url) throw new Error("Logo uploaded but no usable media URL was returned.");

      setControlledInputValue(targetInput, url);
      setPreviewUrl(url);
      setState("saved");
      setMessage("Logo uploaded. Publish changes to make it live on the Publication Site.");
    } catch (error) {
      setState("error");
      setMessage(String(error?.message || error));
    } finally {
      event.target.value = "";
    }
  }

  return (
    <div className="bondfire-colophon-logo-upload">
      <div className="bondfire-colophon-logo-upload__picker">
        <span>Upload logo image</span>
        <input
          type="file"
          accept="image/*"
          aria-label="Upload publication logo image"
          disabled={state === "uploading"}
          onChange={uploadLogo}
        />
      </div>
      {previewUrl ? (
        <div className="bondfire-colophon-logo-upload__preview">
          <img src={previewUrl} alt="Current publication logo preview" />
        </div>
      ) : null}
      <small className={state === "error" ? "is-error" : ""}>
        {message || "Upload PNG, JPG, WebP, GIF, or SVG. The Logo URL field remains available for remote images."}
      </small>
    </div>
  );
}

function NativeLogoUploadBridge() {
  const [target, setTarget] = React.useState({ host: null, input: null });

  React.useEffect(() => {
    if (typeof document === "undefined") return undefined;

    const locate = () => {
      const fields = Array.from(document.querySelectorAll(
        ".bondfire-colophon-native-shell .admin-public-config-card__identity label.native-content-editor__field",
      ));
      const field = fields.find((candidate) => {
        const label = candidate.querySelector("span");
        return String(label?.textContent || "").trim() === "Logo URL";
      });
      const input = field?.querySelector('input[type="url"], input');
      if (!field || !input) return;

      let host = field.querySelector("[data-bondfire-colophon-logo-upload-host]");
      if (!host) {
        host = document.createElement("div");
        host.setAttribute("data-bondfire-colophon-logo-upload-host", "true");
        field.appendChild(host);
      }

      setTarget((current) => (
        current.host === host && current.input === input ? current : { host, input }
      ));
    };

    locate();
    const observer = new MutationObserver(locate);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  if (!target.host || !target.input) return null;
  return createPortal(<NativeLogoUploadControl targetInput={target.input} />, target.host);
}

function NativePublicAdminToolbarBridge({ routeBase, capabilities }) {
  const location = useLocation();
  const [target, setTarget] = React.useState(null);
  const canEdit = Array.isArray(capabilities)
    && (capabilities.includes("*") || capabilities.includes("content:write") || capabilities.includes("site:manage"));

  React.useEffect(() => {
    if (!canEdit || typeof document === "undefined") {
      setTarget(null);
      return undefined;
    }

    let currentHost = null;
    const locate = () => {
      const shell = document.querySelector(".bondfire-colophon-native-shell .public-route-shell");
      if (!shell) {
        setTarget(null);
        return;
      }

      const nativeToolbar = shell.querySelector(".wp-public-admin-bar:not(.bondfire-colophon-public-admin-bar)");
      if (nativeToolbar) {
        currentHost?.remove();
        currentHost = null;
        setTarget(null);
        return;
      }

      let host = shell.querySelector(":scope > [data-bondfire-colophon-public-toolbar-host]");
      if (!host) {
        host = document.createElement("div");
        host.setAttribute("data-bondfire-colophon-public-toolbar-host", "true");
        shell.prepend(host);
      }
      currentHost = host;
      setTarget((current) => (current === host ? current : host));
    };

    locate();
    const observer = new MutationObserver(locate);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      currentHost?.remove();
    };
  }, [canEdit, location.pathname]);

  if (!canEdit || !target) return null;

  const base = String(routeBase || "").replace(/\/+$/, "");
  const editSiteParams = new URLSearchParams(location.search);
  editSiteParams.set("edit", "site");
  const editSiteLink = `${location.pathname}?${editSiteParams.toString()}`;

  return createPortal(
    <div className="wp-public-admin-bar bondfire-colophon-public-admin-bar" role="navigation" aria-label="Editor toolbar">
      <div className="wp-public-admin-bar__left">
        <Link className="wp-public-admin-bar__item" to={`${base}/wp-admin`}>Dashboard</Link>
        <Link className="wp-public-admin-bar__item" to={`${base}/wp-admin/add-new`}>New</Link>
        <Link className="wp-public-admin-bar__item" to={`${base}/wp-admin/posts`}>Posts</Link>
        <Link className="wp-public-admin-bar__item" to={`${base}/wp-admin/media`}>Media</Link>
        <Link className="wp-public-admin-bar__item" to={`${base}/wp-admin/settings`}>Settings</Link>
        <Link className="wp-public-admin-bar__item" to={editSiteLink}>Edit Site</Link>
      </div>
    </div>,
    target,
  );
}

function NativeColophonFooterLinkBridge() {
  React.useEffect(() => {
    if (typeof document === "undefined") return undefined;

    const apply = () => {
      const nodes = document.querySelectorAll(
        ".bondfire-colophon-native-shell .publication-footer__software",
      );

      nodes.forEach((node) => {
        if (node.querySelector("a[data-bondfire-colophon-repo-link]")) return;
        const text = String(node.textContent || "");
        const phrase = "Powered by Colophon";
        const phraseIndex = text.lastIndexOf(phrase);
        if (phraseIndex < 0) return;

        const colophonIndex = phraseIndex + "Powered by ".length;
        const prefix = text.slice(0, colophonIndex);
        const suffix = text.slice(colophonIndex + "Colophon".length);
        const link = document.createElement("a");
        link.href = "https://github.com/colophon-hub/colophon";
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "Colophon";
        link.setAttribute("data-bondfire-colophon-repo-link", "true");
        node.replaceChildren(
          document.createTextNode(prefix),
          link,
          document.createTextNode(suffix),
        );
      });
    };

    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}

function ColophonPublicLinkGuard({ routeBase }) {
  React.useEffect(() => {
    const base = String(routeBase || "").replace(/\/+$/, "");
    if (!base) return undefined;

    const onClick = (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target?.closest?.("a[href]");
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;

      let url;
      try { url = new URL(anchor.href, window.location.origin); } catch { return; }
      if (url.origin !== window.location.origin) return;

      const publicPath = /^\/(?:post|piece|project|projects|archive|search|publications|reader|campaigns|collections|press|about|security|contact|submit|support|updates)(?:\/|$)/.test(url.pathname) || url.pathname === "/";
      const adminPath = /^\/wp-admin(?:\/|$)/.test(url.pathname);
      if ((!publicPath && !adminPath) || url.pathname.startsWith(base)) return;

      event.preventDefault();
      window.history.pushState({}, "", `${base}${url.pathname === "/" ? "/" : url.pathname}${url.search}${url.hash}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [routeBase]);

  return null;
}

export default function ColophonNativeModule({ Workspace }) {
  const { orgId } = useParams();
  const [state, setState] = React.useState({ loading: true, session: null, error: "" });

  React.useEffect(() => {
    let alive = true;
    const encodedOrgId = encodeURIComponent(String(orgId || ""));

    async function load() {
      try {
        const modules = await api(`/api/orgs/${encodedOrgId}/modules`);
        if (Array.isArray(modules?.enabled_modules) && !modules.enabled_modules.includes("publishing-colophon")) {
          throw new Error("Colophon is not enabled for this organization.");
        }
        const privacy = await api(`/api/orgs/${encodedOrgId}/privacy`).catch(() => null);
        if (privacy?.state === "enabled") {
          const role = String(privacy.role || "viewer").toLowerCase();
          const session = {
            authenticated: true,
            role,
            capabilities: colophonCapabilitiesForRole(role),
            user: { id: privacy.userId || "", userId: privacy.userId || "" },
            privateMode: true,
            mode: "bondfire-private",
          };
          if (alive) setState({ loading: false, session, error: "" });
          return;
        }

        const response = await fetch(`/api/orgs/${encodedOrgId}/colophon/session`, {
          credentials: "include",
          headers: { Accept: "application/json" },
        });
        const session = await response.json().catch(() => null);
        if (!response.ok || !session?.authenticated) {
          throw new Error(session?.error || "Unable to open the Colophon workspace.");
        }
        if (alive) setState({ loading: false, session, error: "" });
      } catch (error) {
        if (alive) setState({ loading: false, session: null, error: String(error?.message || error) });
      }
    }

    load();
    return () => { alive = false; };
  }, [orgId]);

  const host = React.useMemo(() => {
    if (!state.session) return null;
    return createColophonHostContext({
      orgId,
      role: state.session.role,
      user: state.session.user,
    });
  }, [orgId, state.session]);

  React.useEffect(() => {
    if (!host?.apiBase) return undefined;
    ensureHostFetchBridge(host.apiBase, state.session?.privateMode ? { orgId, session: state.session } : null);
    return () => { activeApiBase = ""; activePrivateHost = null; };
  }, [host?.apiBase, orgId, state.session]);

  if (state.loading) {
    return <main className="page"><p className="helper">Opening publishing workspace…</p></main>;
  }

  if (state.error || !state.session || !host) {
    return (
      <main className="page">
        <div className="card" style={{ padding: 20 }}>
          <h1>Colophon</h1>
          <p className="helper">{state.error || "Publishing workspace unavailable."}</p>
        </div>
      </main>
    );
  }

  const adapter = createBondfireColophonAdapter(host);

  if (!Workspace) {
    return (
      <main className="page">
        <div className="card" style={{ padding: 20 }}>
          <h1>Colophon</h1>
          <p className="helper">The native Colophon workspace export is not available in this build.</p>
        </div>
      </main>
    );
  }

  ensureHostFetchBridge(host.apiBase, state.session?.privateMode ? { orgId, session: state.session } : null);

  return (
    <div className="bondfire-colophon-native-shell">
      <ColophonNativeStyles />
      <NativeLogoUploadBridge />
      <NativePublicAdminToolbarBridge routeBase={host.routeBase} capabilities={host.capabilities} />
      <NativeColophonFooterLinkBridge />
      <ColophonPublicLinkGuard routeBase={host.routeBase} />
      <RouteContext.Provider value={EMPTY_COLOPHON_ROUTE_CONTEXT}>
        <Workspace
          host={host}
          adapter={adapter}
          session={state.session}
          orgId={orgId}
          embedded
        />
      </RouteContext.Provider>
    </div>
  );
}
