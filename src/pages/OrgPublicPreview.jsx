import React from "react";
import { useParams } from "react-router-dom";
import { api } from "../utils/api.js";

function Item({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/10 py-3">
      <div className="text-sm text-white/60">{label}</div>
      <div className="text-sm text-white text-right">{children}</div>
    </div>
  );
}

export default function OrgPublicPreview({ orgName, onClose }) {
  const { orgId } = useParams();
  const [state, setState] = React.useState({ loading: true, error: "", public: null });

  React.useEffect(() => {
    let alive = true;
    if (!orgId) {
      setState({ loading: false, error: "Missing organization.", public: null });
      return () => {
        alive = false;
      };
    }

    api(`/api/orgs/${encodeURIComponent(orgId)}/public/get`, { method: "GET" })
      .then((result) => {
        if (alive) setState({ loading: false, error: "", public: result?.public || {} });
      })
      .catch((error) => {
        if (alive) setState({ loading: false, error: error?.message || "Unable to load Organization Page settings.", public: null });
      });

    return () => {
      alive = false;
    };
  }, [orgId]);

  const pub = state.public || {};
  const publication = pub?.connected_publication;
  const publicationVisible = Boolean(publication?.available && publication?.url);
  const websiteVisible = Boolean(pub?.show_website_button && pub?.website_link?.url);
  const organizationPageUrl = pub?.slug ? `${window.location.origin}/#/public/${encodeURIComponent(pub.slug)}` : "";
  const destinations = [
    publicationVisible ? { label: "Publication Site", name: publication.publication_name || "Publication Site", url: publication.url } : null,
    websiteVisible && pub.website_link.url !== publication?.url
      ? { label: pub.website_link.label || "Website", name: pub.website_link.label || "Website", url: pub.website_link.url }
      : null,
  ].filter(Boolean);

  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
        <div>
          <div className="text-sm font-semibold">Organization Page preview</div>
          <div className="text-xs text-white/50">Bondfire&apos;s public mutual-aid surface</div>
        </div>
        {onClose ? (
          <button onClick={onClose} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm hover:bg-white/10 transition">
            Close
          </button>
        ) : null}
      </div>

      <div className="p-5">
        <div className="rounded-2xl border border-white/10 bg-black/15 p-5">
          <div className="text-lg font-bold">{pub?.title || orgName || "Organization"}</div>
          <div className="mt-1 text-sm text-white/60">
            {pub?.about || "Public needs, meetings, supplies, and participation options appear here when configured."}
          </div>

          {state.loading ? <div className="mt-5 text-sm text-white/60">Loading Organization Page settings…</div> : null}
          {state.error ? <div className="mt-5 text-sm text-red-300">{state.error}</div> : null}

          {!state.loading && !state.error ? (
            <div className="mt-5">
              <Item label="Status">{pub?.enabled ? "Published" : "Not published"}</Item>
              {organizationPageUrl ? (
                <Item label="Organization Page">
                  <a href={`/#/public/${encodeURIComponent(pub.slug)}`} target="_blank" rel="noreferrer" className="underline">
                    {organizationPageUrl}
                  </a>
                </Item>
              ) : null}
              {destinations.map((destination) => (
                <Item key={`${destination.label}-${destination.url}`} label={destination.label}>
                  <a href={destination.url} target="_blank" rel="noreferrer" className="underline">
                    {destination.name}
                  </a>
                </Item>
              ))}
              {destinations.length === 0 ? (
                <div className="py-3 text-sm text-white/50">No external public destinations are configured.</div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}