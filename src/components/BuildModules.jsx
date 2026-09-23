import { api } from '../utils/api.js';
import { createEncryptedOrg } from '../lib/createEncryptedOrg.js';
import * as React from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { isDemoMode } from "../demo/demoMode.js";
import {
  getAvailablePlatformModules,
  getDefaultEnabledModuleIds,
  getPlatformModules,
  getStarterPacks,
  normalizeSelectedModuleIds,
} from "../platform/moduleRegistry.js";
import {
  clearPendingBuild,
  readPendingBuild,
  readPendingBuildName,
  writePendingBuild,
  writePendingBuildName,
} from "../platform/pendingBuild.js";

const CORE_LOGO_PATH = "/logos/core.png";
const MODULE_LOGO_PATHS = Object.freeze({
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

function modulePath(orgId) {
  return "/api/orgs/" + encodeURIComponent(orgId) + "/modules";
}

async function requestModuleConfig(orgId, options = {}) {
  return api(modulePath(orgId), {...options, body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body});
}

function sameIds(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function buildErrorMessage(error, fallback) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return "You are offline. Your staged build is still saved in this browser. Reconnect and try again.";
  }
  if (error?.status === 401) return "Your session expired. Sign in again; your staged build is still saved in this browser.";
  if (error?.status === 403) return "You do not have permission to change this build. Ask an organization admin or owner.";
  if (error?.status === 404) return "This organization could not be found. Return to the organization dashboard and choose an available workspace.";
  return String(error?.message || fallback);
}

export default function BuildModules() {
  const { orgId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const queryParams = React.useMemo(
    () => new URLSearchParams(location.search || ""),
    [location.search]
  );
  const isNewOrg = !orgId && queryParams.get("new") === "1";
  const isStandalone = !orgId && !isNewOrg;
  const isOnboarding = queryParams.get("first") === "1";
  const liveModules = React.useMemo(() => getAvailablePlatformModules(), []);
  const onDeckModules = React.useMemo(
    () => getPlatformModules().filter((moduleDef) => !moduleDef.available),
    []
  );
  const starterPacks = React.useMemo(() => getStarterPacks(), []);
  const defaults = React.useMemo(() => getDefaultEnabledModuleIds(), []);

  const initialIds = React.useMemo(() => {
    const pending = !orgId ? readPendingBuild() : [];
    return normalizeSelectedModuleIds(pending.length ? pending : defaults);
  }, [defaults, orgId]);

  const [selected, setSelected] = React.useState(() => new Set(initialIds));
  const [savedIds, setSavedIds] = React.useState(() => initialIds);
  const [canEdit, setCanEdit] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const [error, setError] = React.useState("");
  const [recovery, setRecovery] = React.useState("");
  const [recoveryAgain, setRecoveryAgain] = React.useState("");
  const [orgName, setOrgName] = React.useState(() => readPendingBuildName() || "New Bondfire");

  const selectedIds = React.useMemo(
    () => normalizeSelectedModuleIds([...selected]),
    [selected]
  );
  const selectedVisibleIds = React.useMemo(() => {
    const visible = new Set(liveModules.map((moduleDef) => moduleDef.id));
    return selectedIds.filter((id) => visible.has(id));
  }, [liveModules, selectedIds]);
  const dirty = !sameIds(selectedIds, savedIds);
  const filterText = query.trim().toLowerCase();
  const visibleModules = liveModules.filter((moduleDef) => {
    if (!filterText) return true;
    return [moduleDef.label, moduleDef.name, moduleDef.description]
      .join(" ")
      .toLowerCase()
      .includes(filterText);
  });

  const loadConfig = React.useCallback(async () => {
    setLoading(true);
    setError("");
    setNotice("");

    if (!orgId) {
      const pending = readPendingBuild();
      const nextIds = normalizeSelectedModuleIds(
        pending.length ? pending : defaults
      );
      setSelected(new Set(nextIds));
      setSavedIds(nextIds);
      setCanEdit(true);
      setLoading(false);
      return;
    }

    if (isDemoMode()) {
      setSelected(new Set(defaults));
      setSavedIds(defaults);
      setCanEdit(true);
      setLoading(false);
      return;
    }

    try {
      if (isOnboarding) {
        const pending = readPendingBuild();
        if (pending.length) {
          const nextIds = normalizeSelectedModuleIds(pending);
          setSelected(new Set(nextIds));
          setSavedIds(nextIds);
          setCanEdit(true);
          setLoading(false);
          return;
        }
      }

      const payload = await requestModuleConfig(orgId, { method: "GET" });
      const nextIds = normalizeSelectedModuleIds(
        payload?.enabled_modules || defaults
      );
      setSelected(new Set(nextIds));
      setSavedIds(nextIds);
      setCanEdit(payload?.can_edit !== false);
    } catch (loadError) {
      if (isOnboarding) {
        const pending = readPendingBuild();
        if (pending.length) {
          const nextIds = normalizeSelectedModuleIds(pending);
          setSelected(new Set(nextIds));
          setSavedIds(nextIds);
          setCanEdit(true);
          setLoading(false);
          return;
        }
      }
      setSelected(new Set(defaults));
      setSavedIds(defaults);
      setCanEdit(false);
      setError(buildErrorMessage(loadError, "Could not load this Bondfire build."));
    } finally {
      setLoading(false);
    }
  }, [defaults, isOnboarding, orgId]);

  React.useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  React.useEffect(() => {
    if (!orgId && !loading) writePendingBuild(selectedIds);
  }, [loading, orgId, selectedIds]);

  React.useEffect(() => {
    if (isNewOrg) writePendingBuildName(orgName);
  }, [isNewOrg, orgName]);

  const toggleModule = (moduleId) => {
    if (!canEdit) return;
    setNotice("");
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(moduleId)) next.delete(moduleId);
      else next.add(moduleId);
      return next;
    });
  };

  const choosePack = (pack) => {
    if (!canEdit) return;
    setNotice("");
    setSelected(new Set(normalizeSelectedModuleIds(pack.modules)));
  };

  const saveBuild = async () => {
    if (!canEdit || busy || loading) return;
    if (orgId && !dirty && !isOnboarding) return;

    setBusy(true);
    setError("");
    setNotice("");
    let createdOrgId = "";

    try {
      if (isStandalone) {
        writePendingBuild(selectedIds);
        setSavedIds(selectedIds);
        navigate("/signin?mode=register&from=builder");
        return;
      }

      if (isNewOrg) {
        const trimmedName = String(orgName || "").trim();
        if (!trimmedName) {
          setError("Give this new organization a name first.");
          return;
        }

        const orgPayload = await createEncryptedOrg({name: trimmedName, passphrase: recovery, confirmation: recoveryAgain, modules: selectedIds});
        createdOrgId = String(orgPayload.org.id);
        clearPendingBuild();

        try {
          const orgsResponse = await fetch("/api/orgs", {
            credentials: "include",
            headers: { Accept: "application/json" },
          });
          const orgsPayload = await orgsResponse.json().catch(() => ({}));
          if (
            orgsResponse.ok &&
            orgsPayload?.ok &&
            Array.isArray(orgsPayload.orgs)
          ) {
            localStorage.setItem("bf_orgs", JSON.stringify(orgsPayload.orgs));
          }
        } catch {}

        setSavedIds(selectedIds);
        window.dispatchEvent(
          new CustomEvent("bf:modules_changed", {
            detail: { orgId: createdOrgId, enabled_modules: selectedIds },
          })
        );
        navigate("/org/" + encodeURIComponent(createdOrgId) + "/overview", {
          replace: true,
        });
        return;
      }

      await requestModuleConfig(orgId, {
        method: "PUT",
        body: { enabled_modules: selectedIds },
      });
      clearPendingBuild();
      setSavedIds(selectedIds);

      if (isOnboarding) {
        navigate("/org/" + encodeURIComponent(orgId) + "/overview", {
          replace: true,
        });
        return;
      }

      setNotice("Build saved.");
      window.dispatchEvent(
        new CustomEvent("bf:modules_changed", {
          detail: { orgId, enabled_modules: selectedIds },
        })
      );
    } catch (saveError) {
      if (createdOrgId) {
        writePendingBuild(selectedIds);
        writePendingBuildName(orgName);
        navigate(
          "/org/" + encodeURIComponent(createdOrgId) + "/build?first=1",
          { replace: true }
        );
        return;
      }
      setError(buildErrorMessage(saveError, "Could not save this build. Your staged choices are still saved in this browser."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bf-build-page">
      <header className="bf-build-hero">
        <div>
          <p className="bf-build-eyebrow">BONDFIRE // V3</p>
          <h1>Build the space around the work.</h1>
          <p className="bf-build-lede">
            {isStandalone
              ? "Choose what your group needs. When you build, Bondfire will ask for the account that owns this space."
              : isNewOrg
                ? "Name the new organization, choose its modules, and Bondfire will open the new workspace when you build."
                : "Start with the core. Keep the pieces that serve the group. Add more when the work asks for it."}
          </p>
        </div>
        <div className="bf-build-counter" aria-live="polite">
          <span>LIVE MODULES</span>
          <strong>{selectedVisibleIds.length}</strong>
          <small>
            {loading
              ? "syncing"
              : dirty
                ? "changes staged"
                : "in this build"}
          </small>
        </div>
      </header>

      <div className="bf-build-layout">
        <aside className="bf-build-rail">
          <div className="bf-build-rail-brand">
            <img
              className="bf-build-core-logo"
              src={CORE_LOGO_PATH}
              alt=""
              aria-hidden="true"
              onError={(event) => event.currentTarget.remove()}
            />
            <span className="bf-build-mark">BF</span>
            <span>Bondfire</span>
          </div>
          <div className="bf-build-rule" />
          <p className="bf-build-label">THE CORE</p>
          <h2>One room.<br />Many ways to move.</h2>
          <p className="bf-build-rail-copy">
            The core stays present: dashboard, settings, security, and the build room. Everything else is yours to shape.
          </p>
          {isNewOrg ? (
            <label
              style={{
                display: "grid",
                gap: 6,
                margin: "18px 0",
              }}
            >
              <span className="bf-build-label">NEW ORGANIZATION</span>
              <input
                className="input"
                value={orgName}
                onChange={(event) => setOrgName(event.target.value)}
                placeholder="Organization name"
              />
            </label>
          ) : null}
          {isNewOrg && <div style={{display:'grid',gap:8}}>
            <label>Recovery passphrase<input className="input" type="password" autoComplete="new-password" minLength={20} value={recovery} onChange={e=>setRecovery(e.target.value)} disabled={busy}/></label>
            <label>Confirm recovery passphrase<input className="input" type="password" autoComplete="new-password" value={recoveryAgain} onChange={e=>setRecoveryAgain(e.target.value)} disabled={busy}/></label>
            <p>Use at least 20 characters and keep this separate from your login password. Keep a safe copy: the server cannot recover your encrypted content.</p>
          </div>}
          <ul className="bf-build-core-list">
            <li><span>01</span>Overview</li>
            <li><span>02</span>Settings</li>
            <li><span>03</span>Emergency</li>
            <li><span>04</span>Build</li>
          </ul>
          <div className="bf-build-rail-bottom">
            <div className="bf-build-selection-line">
              <span>Selected</span>
              <strong>{selectedVisibleIds.length} / {liveModules.length}</strong>
            </div>
            <button
              className="bf-build-action"
              type="button"
              onClick={saveBuild}
              disabled={
                !canEdit ||
                loading ||
                busy ||
                (Boolean(orgId) && !dirty && !isOnboarding) ||
                (isNewOrg && !orgName.trim())
              }
            >
              {busy
                ? "Building…"
                : isStandalone
                  ? "Build & continue"
                  : isNewOrg
                    ? "Create this Bondfire"
                    : dirty || isOnboarding
                      ? "Build this Bondfire"
                      : "Build is current"}
            </button>
            {!canEdit && !loading ? (
              <p className="bf-build-permission">
                Admin or owner access is needed to change the build.
              </p>
            ) : null}
            {error ? (
              <p className="bf-build-message is-error" role="alert">{error}</p>
            ) : null}
            {notice ? <p className="bf-build-message" role="status">{notice}</p> : null}
            {isStandalone ? (
              <Link
                className="helper"
                to="/signin?mode=login&from=builder"
                style={{ display: "inline-block", marginTop: 12 }}
              >
                Already have an account? Sign in instead.
              </Link>
            ) : null}
          </div>
        </aside>

        <main className="bf-build-main">
          <div className="bf-build-toolbar">
            <div>
              <p className="bf-build-label">LIVE MODULES</p>
              <h2>Choose what belongs in the room.</h2>
            </div>
            <label className="bf-build-search">
              <span className="sr-only">Filter modules</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter modules"
              />
            </label>
          </div>

          <div className="bf-build-packs" aria-label="Starter builds">
            <span className="bf-build-pack-label">START WITH</span>
            {starterPacks.map((pack) => (
              <button
                key={pack.id}
                className="bf-build-pack"
                type="button"
                onClick={() => choosePack(pack)}
                disabled={!canEdit || loading}
                title={pack.description}
              >
                {pack.label}
              </button>
            ))}
          </div>

          <div className="bf-build-grid">
            {visibleModules.map((moduleDef) => {
              const isSelected = selected.has(moduleDef.id);
              const logoPath = MODULE_LOGO_PATHS[moduleDef.id] || "";
              return (
                <article
                  className={
                    "bf-build-module-card" + (isSelected ? " is-selected" : "")
                  }
                  key={moduleDef.id}
                  data-module-id={moduleDef.id}
                >
                  <div className="bf-build-module-meta">
                    <span className="bf-build-module-logo-wrap" aria-hidden="true">
                      {logoPath ? (
                        <img
                          className="bf-build-module-logo"
                          src={logoPath}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          onError={(event) => event.currentTarget.remove()}
                        />
                      ) : null}
                      <span className="bf-build-module-mark">{moduleDef.mark}</span>
                    </span>
                    <span className="bf-build-module-state">
                      {isSelected ? "ADDED" : "AVAILABLE"}
                    </span>
                  </div>
                  <h3>{moduleDef.label}</h3>
                  <p>{moduleDef.description}</p>
                  <div className="bf-build-module-footer">
                    <span className="bf-build-route">/{moduleDef.routeBase}</span>
                    <button
                      className="bf-build-toggle"
                      type="button"
                      onClick={() => toggleModule(moduleDef.id)}
                      disabled={!canEdit || loading}
                      aria-pressed={isSelected}
                    >
                      {isSelected ? "Remove" : "Add"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
          {!visibleModules.length ? (
            <p className="bf-build-empty">Nothing matched that filter.</p>
          ) : null}

          <section className="bf-build-on-deck">
            <div className="bf-build-on-deck-heading">
              <div>
                <p className="bf-build-label">ON DECK</p>
                <h2>Still becoming.</h2>
              </div>
              <span>Not in the initial ship</span>
            </div>
            <div className="bf-build-on-deck-grid">
              {onDeckModules.map((moduleDef) => (
                <article className="bf-build-future-card" key={moduleDef.id}>
                  <div className="bf-build-module-meta">
                    <span className="bf-build-module-mark">{moduleDef.mark}</span>
                    <span className="bf-build-module-state">
                      COMING SOON
                    </span>
                  </div>
                  <h3>{moduleDef.label}</h3>
                  <p>{moduleDef.description}</p>
                </article>
              ))}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
