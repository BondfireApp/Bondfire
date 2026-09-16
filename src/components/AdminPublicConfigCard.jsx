import * as React from "react";
import { useParams } from "react-router-dom";
import { api } from "../utils/api.js";
import { PublicSiteContentCard } from "./PublicSiteContentCard.jsx";
import { PublicSiteProfileTransfer } from "./PublicSiteProfileTransfer.jsx";

function normalizeHttpUrl(value) {
  let raw = String(value || "").trim();
  if (!raw) return "";
  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) raw = `https://${raw}`;
  try {
    const parsed = new URL(raw);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function errorMessage(error, fallback) {
  const code = String(error?.code || error?.message || "");
  if (code.includes("INSUFFICIENT_ROLE")) return "Bondfire admins manage Connected Publication settings.";
  if (code.includes("MODULE_DISABLED")) return "Colophon is not enabled for this Organization Workspace.";
  return error?.message || fallback;
}

export function AdminPublicConfigCard() {
  const { orgId } = useParams();
  const [connection, setConnection] = React.useState({
    publication_id: "",
    publication_name: "",
    url: "",
    available: true,
  });
  const [organizationPage, setOrganizationPage] = React.useState({
    slug: "",
    available: false,
    path: "",
  });
  const [suggestion, setSuggestion] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const [canManageConnection, setCanManageConnection] = React.useState(true);
  const [profileRevision, setProfileRevision] = React.useState(0);

  const relationPath = React.useMemo(
    () => `/api/orgs/${encodeURIComponent(orgId || "")}/public/publication`,
    [orgId]
  );
  const colophonConfigPath = React.useMemo(
    () => `/api/orgs/${encodeURIComponent(orgId || "")}/colophon/public-site-config`,
    [orgId]
  );

  const load = React.useCallback(async () => {
    if (!orgId) return;
    setMessage("");

    try {
      const relation = await api(relationPath, { method: "GET" });
      const linked = relation?.connected_publication;
      if (linked) {
        setConnection({
          publication_id: String(linked.publication_id || ""),
          publication_name: String(linked.publication_name || ""),
          url: String(linked.url || ""),
          available: linked.available !== false,
        });
      }
      setOrganizationPage(relation?.organization_page || { slug: "", available: false, path: "" });
      setCanManageConnection(true);
    } catch (error) {
      setCanManageConnection(false);
      setMessage(errorMessage(error, "Unable to load Connected Publication settings."));
    }

    try {
      const site = await api(colophonConfigPath, { method: "GET" });
      const identity = site?.config?.identity || {};
      const url = normalizeHttpUrl(identity.siteUrl);
      const name = String(identity.publicationName || identity.shortName || "").trim();
      if (url || name) setSuggestion({ name, url });
    } catch {
      setSuggestion(null);
    }
  }, [orgId, relationPath, colophonConfigPath]);

  React.useEffect(() => {
    load();
  }, [load]);

  const saveConnection = async () => {
    if (!orgId || !canManageConnection) return;
    const url = normalizeHttpUrl(connection.url);
    if (!url) {
      setMessage("Enter a valid http:// or https:// Publication Site URL.");
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      const result = await api(relationPath, {
        method: "PUT",
        body: JSON.stringify({
          connected_publication: {
            publication_id: connection.publication_id,
            publication_name: String(connection.publication_name || "").trim() || "Publication Site",
            url,
            available: !!connection.available,
          },
        }),
      });
      const linked = result?.connected_publication || {};
      setConnection({
        publication_id: String(linked.publication_id || ""),
        publication_name: String(linked.publication_name || ""),
        url: String(linked.url || url),
        available: linked.available !== false,
      });
      setOrganizationPage(result?.organization_page || organizationPage);
      setMessage("Connected Publication saved.");
    } catch (error) {
      setMessage(errorMessage(error, "Unable to save Connected Publication."));
    } finally {
      setBusy(false);
    }
  };

  const disconnectPublication = async () => {
    if (!orgId || !canManageConnection) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await api(relationPath, { method: "DELETE" });
      setConnection({ publication_id: "", publication_name: "", url: "", available: true });
      setOrganizationPage(result?.organization_page || organizationPage);
      setMessage("Connected Publication removed. Publication Site navigation was not changed.");
    } catch (error) {
      setMessage(errorMessage(error, "Unable to disconnect Publication Site."));
    } finally {
      setBusy(false);
    }
  };

  const useColophonIdentity = () => {
    if (!suggestion) return;
    setConnection((current) => ({
      ...current,
      publication_name: suggestion.name || current.publication_name || "Publication Site",
      url: suggestion.url || current.url,
    }));
    setMessage("Loaded Colophon identity. Save to create the explicit connection.");
  };

  const syncOrganizationPageBacklink = async () => {
    if (!orgId) return;
    if (!connection.publication_id) {
      setMessage("Save the Connected Publication before syncing a backlink.");
      return;
    }
    if (!organizationPage?.available || !organizationPage?.slug) {
      setMessage("Enable and save the Organization Page before syncing its Publication Site backlink.");
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      const site = await api(colophonConfigPath, { method: "GET" });
      const config = site?.config || {};
      const existingItems = Array.isArray(config?.navigation?.items) ? config.navigation.items : [];
      const href = `${window.location.origin}/#/public/${encodeURIComponent(organizationPage.slug)}`;
      const backlink = {
        id: "bondfire-organization-page",
        label: "Organization Page",
        href,
        enabled: true,
        module: "",
      };
      let replaced = false;
      const items = existingItems.map((item) => {
        if (item?.id !== backlink.id) return item;
        replaced = true;
        return backlink;
      });
      if (!replaced) items.push(backlink);

      await api(colophonConfigPath, {
        method: "PUT",
        body: JSON.stringify({
          publicSite: {
            ...config,
            navigation: {
              ...(config.navigation || {}),
              items,
            },
          },
        }),
      });
      setMessage("Organization Page link synced to the Publication Site.");
    } catch (error) {
      setMessage(errorMessage(error, "Unable to update Publication Site navigation."));
    } finally {
      setBusy(false);
    }
  };

  const hasConnection = Boolean(connection.publication_id || connection.url);

  return (
    <>
      <section className="card" style={{ padding: 16 }}>
        <h2 style={{ marginTop: 0 }}>Organization Page</h2>
        <p className="helper">
          This is Bondfire&apos;s public organization and mutual-aid surface. Choose the standard layout or build a richer organizing and membership site without changing code.
        </p>
        <p className="helper" style={{ marginTop: 8 }}>
          Publication Sites remain separate and optional. Custom domains are managed in the domain setup card below these public-page settings.
        </p>

        <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", marginTop: 16, paddingTop: 16 }}>
          <h3 style={{ margin: "0 0 6px" }}>Connected Publication</h3>
          <p className="helper" style={{ marginTop: 0 }}>
            Connect a separate Publication Site when this organization also publishes through Colophon. The relationship is explicit; matching names or slugs never create it automatically.
          </p>

          <div className="grid" style={{ gap: 10, marginTop: 12 }}>
            <label className="grid" style={{ gap: 6 }}>
              <span className="helper">Publication name</span>
              <input
                className="input"
                value={connection.publication_name}
                onChange={(event) => setConnection((current) => ({ ...current, publication_name: event.target.value }))}
                placeholder="Publication name"
                disabled={!canManageConnection || busy}
              />
            </label>

            <label className="grid" style={{ gap: 6 }}>
              <span className="helper">Publication Site URL</span>
              <input
                className="input"
                value={connection.url}
                onChange={(event) => setConnection((current) => ({ ...current, url: event.target.value }))}
                placeholder="https://publication.example.org"
                disabled={!canManageConnection || busy}
              />
            </label>

            <label className="row" style={{ gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={!!connection.available}
                onChange={(event) => setConnection((current) => ({ ...current, available: event.target.checked }))}
                disabled={!canManageConnection || busy}
              />
              <span>Publication Site is publicly available</span>
            </label>

            {suggestion ? (
              <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <button className="btn" type="button" onClick={useColophonIdentity} disabled={busy || !canManageConnection}>
                  Use Colophon identity
                </button>
                <span className="helper">
                  {suggestion.name || "Publication Site"}{suggestion.url ? ` · ${suggestion.url}` : ""}
                </span>
              </div>
            ) : null}

            <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button className="btn-red" type="button" onClick={saveConnection} disabled={busy || !canManageConnection}>
                {busy ? "Saving…" : "Save Connected Publication"}
              </button>
              {hasConnection ? <button className="btn" type="button" onClick={disconnectPublication} disabled={busy || !canManageConnection}>Disconnect</button> : null}
              {hasConnection ? <button className="btn" type="button" onClick={syncOrganizationPageBacklink} disabled={busy}>Sync Organization Page link to Publication Site</button> : null}
            </div>

            {hasConnection ? <div className="helper">Bondfire will show the Publication Site only while this connection is marked publicly available and its URL is valid.</div> : null}
            {message ? <div className="helper">{message}</div> : null}
          </div>
        </div>
      </section>

      <PublicSiteContentCard key={profileRevision} />
      <PublicSiteProfileTransfer onImported={() => setProfileRevision((value) => value + 1)} />
    </>
  );
}
