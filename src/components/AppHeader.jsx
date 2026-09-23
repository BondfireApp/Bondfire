// src/components/AppHeader.jsx
import React from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import "./AppHeader.css";
import { loadOrgIdentity } from "../lib/orgIdentity.js";

const homeHref = "/orgs";
const NAV_MODULE_LOGOS = Object.freeze({
  tasks: "/logos/tasks.svg",
  "working-groups": "/logos/working-groups.svg",
  decisions: "/logos/decisions.svg",
  cases: "/logos/cases.svg",
  treasury: "/logos/treasury.svg",
  people: "/logos/people.svg",
  newsletter: "/logos/newsletter.svg",
  needs: "/logos/needs.png",
  pledges: "/logos/pledges.png",
  inventory: "/logos/inventory.png",
  meetings: "/logos/meetings.png",
  drive: "/logos/drive.png",
  events: "/logos/events.png",
  "witness-archive": "/logos/rec.png",
  "bondfire-chat": "/logos/firechat.png",
  intake: "/logos/intake.png",
  studio: "/logos/studio.svg",
  "publishing-colophon": "/logos/colophon.png",
});

function useEnabledOrgModules(orgId) {
  const [enabledModules, setEnabledModules] = React.useState(null);

  React.useEffect(() => {
    let alive = true;
    setEnabledModules(null);

    const load = async () => {
      if (!orgId) return;
      try {
        const response = await fetch(`/api/orgs/${encodeURIComponent(orgId)}/modules`, {
          credentials: "include",
          headers: { Accept: "application/json" },
        });
        const payload = await response.json().catch(() => ({}));
        if (!alive || !response.ok || !Array.isArray(payload?.enabled_modules)) return;
        setEnabledModules(new Set(payload.enabled_modules.map((id) => String(id))));
      } catch {
        // Keep the full module list reachable if the module read fails during a rollout.
      }
    };

    const onModulesChanged = (event) => {
      const changedOrgId = event?.detail?.orgId;
      if (changedOrgId && String(changedOrgId) !== String(orgId)) return;
      load();
    };

    load();
    window.addEventListener("bf:modules_changed", onModulesChanged);
    return () => {
      alive = false;
      window.removeEventListener("bf:modules_changed", onModulesChanged);
    };
  }, [orgId]);

  return enabledModules;
}

function useOrgIdFromPath() {
  const loc = useLocation();
  const pathname = loc.pathname || "";
  const hash = loc.hash || "";
  const m1 = pathname.match(/\/org\/([^/]+)/i);
  const m2 = hash.match(/#\/org\/([^/]+)/i);
  const raw = (m1 && m1[1]) || (m2 && m2[1]) || null;
  return raw ? decodeURIComponent(raw) : null;
}

function readOrgName(orgId) {
  if (!orgId) return "";
  try {
    const settings = JSON.parse(localStorage.getItem(`bf_org_settings_${orgId}`) || "{}");
    const orgs = JSON.parse(localStorage.getItem("bf_orgs") || "[]");
    const org = Array.isArray(orgs) ? orgs.find((item) => String(item?.id) === String(orgId)) : null;
    return String((settings?.name || org?.name || "").trim() || "");
  } catch {
    return "";
  }
}

function readOrgLogo(orgId) {
  if (!orgId) return null;
  try {
    const settings = JSON.parse(localStorage.getItem(`bf_org_settings_${orgId}`) || "{}");
    const value = settings?.logoDataUrl || settings?.logoUrl || settings?.logo || null;
    const result = String(value || "").trim();
    return result || null;
  } catch {
    return null;
  }
}

function Brand({ orgId }) {
  const [orgName, setOrgName] = React.useState(() => readOrgName(orgId));
  const [orgLogo, setOrgLogo] = React.useState(() => readOrgLogo(orgId));

  React.useEffect(() => {
    let alive = true;
    setOrgName(readOrgName(orgId));
    setOrgLogo(readOrgLogo(orgId));
    if (orgId) {
      loadOrgIdentity(orgId)
        .then((identity) => {
          if (alive && identity?.name) setOrgName(identity.name);
        })
        .catch(() => {});
    }

    const onChange = (event) => {
      const changedId = event?.detail?.orgId;
      if (!changedId || String(changedId) === String(orgId)) {
        setOrgName(readOrgName(orgId));
        setOrgLogo(readOrgLogo(orgId));
      }
    };
    const onStorage = (event) => {
      const key = event?.key || "";
      if (key === `bf_org_settings_${orgId}` || key === "bf_orgs") {
        setOrgName(readOrgName(orgId));
        setOrgLogo(readOrgLogo(orgId));
      }
    };

    window.addEventListener("bf:org_settings_changed", onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      alive = false;
      window.removeEventListener("bf:org_settings_changed", onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, [orgId]);

  const label = orgName || "Org";

  return (
    <div className="bf-globalBrandWrap">
      <Link className="bf-globalBrand" to={homeHref} aria-label="Bondfire organizations">
        <img
          src="/logos/core.png"
          alt=""
          aria-hidden="true"
          onError={(event) => {
            if (!event.currentTarget.dataset.fallback) {
              event.currentTarget.dataset.fallback = "true";
              event.currentTarget.src = "/logo-bondfire.png";
            }
          }}
        />
        <span>Bondfire</span>
      </Link>

      {orgId ? (
        <Link
          className="bf-globalOrgPill"
          to={`/org/${encodeURIComponent(orgId)}/overview`}
          title={`Open ${label} dashboard`}
          aria-label={`Open ${label} dashboard`}
        >
          {orgLogo ? (
            <img
              src={orgLogo}
              alt=""
              aria-hidden="true"
              loading="lazy"
              decoding="async"
            />
          ) : null}
          <span>{label}</span>
        </Link>
      ) : null}
    </div>
  );
}

function DrawerLink({ to, state, label, moduleId, tourId, onNavigate, isActiveOverride }) {
  const logoPath = moduleId ? NAV_MODULE_LOGOS[moduleId] || "" : "";
  return (
    <NavLink
      to={to}
      state={state}
      onClick={onNavigate}
      data-tour={tourId || undefined}
      className={({ isActive }) =>
        `bf-globalDrawerLink${(typeof isActiveOverride === "boolean" ? isActiveOverride : isActive) ? " is-active" : ""}`
      }
    >
      {logoPath ? (
        <img
          className="bf-globalDrawerModuleLogo"
          src={logoPath}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
          onError={(event) => event.currentTarget.remove()}
        />
      ) : null}
      <span>{label}</span>
    </NavLink>
  );
}

function DrawerSection({ title, children }) {
  return (
    <section className="bf-globalDrawerSection" aria-labelledby={`bf-nav-${title.toLowerCase()}`}>
      <h2 id={`bf-nav-${title.toLowerCase()}`}>{title}</h2>
      <div className="bf-globalDrawerSectionLinks">{children}</div>
    </section>
  );
}

export default function AppHeader({ onLogout, showLogout }) {
  const [open, setOpen] = React.useState(false);
  const location = useLocation();
  const orgId = useOrgIdFromPath();
  const enabledModules = useEnabledOrgModules(orgId);
  const menuButtonRef = React.useRef(null);
  const closeButtonRef = React.useRef(null);
  const drawerPanelRef = React.useRef(null);

  const closeMenu = React.useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => menuButtonRef.current?.focus());
    }
  }, []);

  React.useEffect(() => {
    setOpen(false);
  }, [location.pathname, location.hash]);

  React.useEffect(() => {
    if (!open) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.requestAnimationFrame(() => closeButtonRef.current?.focus());

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu(true);
        return;
      }

      if (event.key !== "Tab") return;
      const panel = drawerPanelRef.current;
      if (!panel) return;
      const focusable = Array.from(
        panel.querySelectorAll(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true");
      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [closeMenu, open]);

  const base = orgId ? `/org/${encodeURIComponent(orgId)}` : null;
  const path = location.pathname || "";
  const settingsParams = new URLSearchParams(location.search || "");
  const settingsTab = String(settingsParams.get("tab") || "").toLowerCase();
  const settingsSection = String(settingsParams.get("section") || "").toLowerCase();
  const securitySettingsActive =
    settingsSection === "security" || ["invites", "members", "profile", "security"].includes(settingsTab);
  const newsletterSettingsActive =
    settingsSection === "newsletter" || settingsTab === "newsletter";
  const organizationItems = base
    ? [
        { label: "Dashboard", to: `${base}/overview`, tourId: "nav-overview", active: path === base || path === `${base}/` || path === `${base}/overview` },
        { label: "Build", to: `${base}/build`, tourId: "nav-build" },
      ]
    : [];
  const moduleItems = base
    ? [
        { label: "Tasks", to: `${base}/tasks`, moduleId: "tasks" },
        { label: "Working Groups", to: `${base}/working-groups`, moduleId: "working-groups" },
        { label: "Decisions", to: `${base}/decisions`, moduleId: "decisions" },
        { label: "Cases", to: `${base}/cases`, moduleId: "cases" },
        { label: "Treasury", to: `${base}/treasury`, moduleId: "treasury" },
        { label: "People", to: `${base}/people`, tourId: "nav-people", moduleId: "people" },
        {
          label: "Newsletter",
          to: `${base}/settings?section=newsletter&tab=newsletter`,
          tourId: "nav-newsletter",
          moduleId: "newsletter",
          active: path === `${base}/settings` && settingsTab === "newsletter",
        },
        { label: "Needs", to: `${base}/needs`, tourId: "nav-needs", moduleId: "needs" },
        { label: "Pledges", to: `${base}/pledges`, tourId: "nav-pledges", moduleId: "pledges" },
        { label: "Inventory", to: `${base}/inventory`, tourId: "nav-inventory", moduleId: "inventory" },
        { label: "Meetings", to: `${base}/meetings`, tourId: "nav-meetings", moduleId: "meetings" },
        { label: "Drive", to: `${base}/drive`, tourId: "nav-drive", moduleId: "drive" },
        { label: "Events", to: `${base}/events`, tourId: "nav-events", moduleId: "events" },
        { label: "REC", to: `${base}/witness`, tourId: "nav-witness", moduleId: "witness-archive" },
        { label: "FireChat", to: `${base}/chat`, tourId: "nav-chat", moduleId: "bondfire-chat" },
        { label: "Intake", to: `${base}/intake`, tourId: "nav-intake", moduleId: "intake" },
        { label: "Studio", to: `${base}/studio`, tourId: "nav-studio", moduleId: "studio" },
        { label: "Colophon", to: `${base}/colophon`, tourId: "nav-colophon", moduleId: "publishing-colophon" },
      ].filter((item) => ["tasks", "working-groups", "decisions", "cases", "treasury"].includes(item.moduleId) ? enabledModules?.has(item.moduleId) : !enabledModules || enabledModules.has(item.moduleId))
    : [];
  const supportTo = "/support";

  return (
    <>
      <header className="bf-appHeader bf-globalHeader">
        <div className="bf-appHeader-left">
          <Brand orgId={orgId} />
        </div>

        <div className="bf-appHeader-right bf-globalHeaderActions">
          {base ? (
            <Link
              to={`${base}/settings`}
              className={`bf-globalIconButton${path === `${base}/settings` && !securitySettingsActive && !newsletterSettingsActive ? " is-active" : ""}`}
              aria-label="Organization settings"
              title="Settings"
              onClick={() => closeMenu(false)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.09a2 2 0 0 1 1 1.74v.5a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </Link>
          ) : null}

          <button
            ref={menuButtonRef}
            className="bf-globalIconButton bf-globalMenuButton"
            type="button"
            aria-label={open ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={open}
            aria-controls="bf-global-navigation-drawer"
            onClick={() => setOpen((value) => !value)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>
      </header>

      <div className={`bf-globalDrawerLayer${open ? " is-open" : ""}`} aria-hidden={!open}>
        <div className="bf-globalDrawerBackdrop" onClick={() => closeMenu(true)} aria-hidden="true" />
        <aside
          ref={drawerPanelRef}
          id="bf-global-navigation-drawer"
          className="bf-globalDrawerPanel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="bf-global-navigation-title"
        >
          <div className="bf-globalDrawerTop">
            <div>
              <div className="bf-globalDrawerEyebrow">NAVIGATION</div>
              <h1 id="bf-global-navigation-title">Bondfire</h1>
            </div>
            <button
              ref={closeButtonRef}
              className="bf-globalIconButton"
              type="button"
              aria-label="Close navigation menu"
              onClick={() => closeMenu(true)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>

          <nav className="bf-globalDrawerNav" aria-label="Bondfire navigation">
            <DrawerLink to="/orgs" label="All Orgs" onNavigate={() => closeMenu(false)} />

            {base ? (
              <DrawerSection title="ORGANIZATION">
                {organizationItems.map((item) => (
                  <DrawerLink
                    key={item.to}
                    {...item}
                    isActiveOverride={item.active}
                    onNavigate={() => closeMenu(false)}
                  />
                ))}
              </DrawerSection>
            ) : null}

            {base ? (
              <DrawerSection title="MODULES">
                {moduleItems.map((item) => (
                  <DrawerLink key={item.to} {...item} onNavigate={() => closeMenu(false)} />
                ))}
              </DrawerSection>
            ) : null}

            <DrawerSection title="ACCOUNT">
              {base ? (
                <>
                  <DrawerLink
                    to={`${base}/settings?section=security&tab=profile`}
                    label="My profile"
                    isActiveOverride={path === `${base}/settings` && settingsTab === "profile"}
                    onNavigate={() => closeMenu(false)}
                  />
                  <DrawerLink
                    to={`${base}/settings?section=security&tab=security`}
                    label="Security"
                    isActiveOverride={
                      path === `${base}/settings` &&
                      settingsTab !== "profile" &&
                      securitySettingsActive
                    }
                    onNavigate={() => closeMenu(false)}
                  />
                </>
              ) : null}
              <DrawerLink
                to={supportTo}
                state={orgId ? { supportOrgId: orgId } : undefined}
                label="Support"
                onNavigate={() => closeMenu(false)}
              />
              {showLogout ? (
                <button
                  className="bf-globalDrawerLink bf-globalDrawerLogout"
                  type="button"
                  onClick={() => {
                    closeMenu(false);
                    onLogout?.();
                  }}
                >
                  <span>Logout</span>
                </button>
              ) : null}
            </DrawerSection>
          </nav>
        </aside>
      </div>
    </>
  );
}
