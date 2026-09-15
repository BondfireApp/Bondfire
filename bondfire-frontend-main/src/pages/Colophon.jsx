import React from "react";
import {
  UNSAFE_LocationContext as LocationContext,
  useParams,
} from "react-router-dom";
import { ColophonWorkspace } from "colophon/workspace";
import ColophonNativeModule from "../modules/colophon/ColophonNativeModule.jsx";

const COLOPHON_ROUTE_RE = /^\/(?:wp-admin|post|piece|project|projects|archive|search|publications|reader|campaigns|collections|investigations|courses|feeds|gallery|press|about|security|contact|submit|support|updates|print|zine)(?:\/|$)/;

function routeFromAnchor(anchor) {
  const raw = String(anchor?.getAttribute?.("href") || "").trim();
  if (!raw || raw === "#" || /^(?:mailto|tel|javascript):/i.test(raw)) return "";
  if (raw.startsWith("#/") || raw.startsWith("#/")) return raw.slice(1);
  if (raw.startsWith("#")) return "";

  try {
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin) return "";
    if (url.hash.startsWith("#/")) return url.hash.slice(1);
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "";
  }
}

function NativeColophonBoundary({ children }) {
  const { orgId } = useParams();
  const locationContext = React.useContext(LocationContext);
  const routeBase = `/org/${encodeURIComponent(String(orgId || ""))}/colophon`;
  const bondfireHome = `/org/${encodeURIComponent(String(orgId || ""))}/overview`;

  const embeddedLocationContext = React.useMemo(() => {
    if (!locationContext?.location || locationContext.location.pathname !== routeBase) {
      return locationContext;
    }

    return {
      ...locationContext,
      location: {
        ...locationContext.location,
        pathname: `${routeBase}/`,
      },
    };
  }, [locationContext, routeBase]);

  React.useLayoutEffect(() => {
    const root = document.documentElement;
    const previousTheme = root.getAttribute("data-ui-theme");
    const previousPreference = root.getAttribute("data-ui-theme-preference");
    const previousColorScheme = root.style.colorScheme;

    let requestedTheme = "dark";
    try {
      const stored = window.localStorage.getItem("colophon-ui-appearance-v1");
      if (stored === "light" || stored === "dark") requestedTheme = stored;
    } catch {
      // Use Bondfire's dark workspace default when no Colophon preference exists.
    }

    root.dataset.uiThemePreference = requestedTheme;
    root.dataset.uiTheme = requestedTheme;
    root.style.colorScheme = requestedTheme;

    return () => {
      if (previousTheme == null) root.removeAttribute("data-ui-theme");
      else root.setAttribute("data-ui-theme", previousTheme);

      if (previousPreference == null) root.removeAttribute("data-ui-theme-preference");
      else root.setAttribute("data-ui-theme-preference", previousPreference);

      root.style.colorScheme = previousColorScheme;
    };
  }, []);

  React.useLayoutEffect(() => {
    if (!routeBase || typeof window === "undefined") return undefined;

    const history = window.history;
    const originalPushState = history.pushState;

    history.pushState = function bondfireColophonPushState(state, title, url) {
      const target = typeof url === "string" ? url : "";

      // The embedded Colophon public-link guard was written for BrowserRouter.
      // Bondfire uses HashRouter, so translate only its native Colophon route
      // writes into hash navigation instead of changing the real document path.
      if (target === routeBase || target.startsWith(`${routeBase}/`)) {
        const destination = new URL(target, window.location.origin);
        const current = new URL(window.location.href);
        current.hash = `#${destination.pathname}${destination.search}${destination.hash}`;
        return originalPushState.call(history, state, title, current.toString());
      }

      return originalPushState.call(history, state, title, url);
    };

    return () => {
      history.pushState = originalPushState;
    };
  }, [routeBase]);

  React.useLayoutEffect(() => {
    if (!routeBase || typeof document === "undefined") return undefined;

    const onClick = (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target?.closest?.("a[href]");
      if (!anchor || !anchor.closest(".bondfire-colophon-native-shell")) return;
      if (anchor.target === "_blank" || anchor.hasAttribute("download")) return;

      let target = routeFromAnchor(anchor);
      if (!target) return;

      const pathname = target.split(/[?#]/, 1)[0] || "/";
      if (target === routeBase || target.startsWith(`${routeBase}/`)) {
        // Already an absolute Bondfire-hosted Colophon route.
      } else if (target === bondfireHome || target.startsWith(`/org/${encodeURIComponent(String(orgId || ""))}/`)) {
        // Explicit navigation back into Bondfire stays outside Colophon.
      } else if (pathname === "/" || COLOPHON_ROUTE_RE.test(pathname)) {
        target = `${routeBase}${target === "/" ? "/" : target}`;
      } else {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      const nextHash = `#${target}`;
      if (window.location.hash !== nextHash) window.location.hash = nextHash;
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [bondfireHome, orgId, routeBase]);

  React.useLayoutEffect(() => {
    if (!routeBase || typeof document === "undefined") return undefined;

    const addExitLink = (parent, className) => {
      if (!parent || parent.querySelector("[data-bondfire-colophon-exit]")) return;
      const link = document.createElement("a");
      link.href = `#${bondfireHome}`;
      link.className = className;
      link.textContent = "← Bondfire";
      link.setAttribute("data-bondfire-colophon-exit", "true");
      link.setAttribute("aria-label", "Back to Bondfire organization workspace");
      parent.prepend(link);
    };

    const apply = () => {
      const shell = document.querySelector(".bondfire-colophon-native-shell");
      if (!shell) return;
      addExitLink(shell.querySelector(".wp-public-admin-bar__left"), "wp-public-admin-bar__item bondfire-colophon-exit-link");
      addExitLink(shell.querySelector(".wp-admin-topbar__left"), "wp-admin-topbar__link bondfire-colophon-exit-link");
    };

    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [bondfireHome, routeBase]);

  if (!locationContext || embeddedLocationContext === locationContext) return children;
  return (
    <LocationContext.Provider value={embeddedLocationContext}>
      {children}
    </LocationContext.Provider>
  );
}

export default function Colophon() {
  return (
    <NativeColophonBoundary>
      <ColophonNativeModule Workspace={ColophonWorkspace} />
    </NativeColophonBoundary>
  );
}
