import * as React from "react";
import { useParams } from "react-router-dom";
import { api } from "../utils/api.js";

const PROFILE_VERSION = 1;
const SAFE_FIELDS = new Set([
  "enabled", "newsletter_enabled", "pledges_enabled", "show_action_strip", "show_needs", "show_meetings",
  "show_what_we_do", "show_get_involved", "show_newsletter_card", "show_website_button", "show_available_supplies",
  "slug", "template", "title", "location", "about", "branch_label", "hero_headline", "hero_text", "about_intro",
  "purpose_title", "about_title", "join_title", "bulletin_title", "events_title", "contact_title", "about_card_title",
  "about_card_body", "location_card_title", "location_card_body", "join_intro", "contact_intro", "events_intro",
  "hero_image_url", "logo_url", "logo_data_url", "font_family", "accent_color", "theme_mode", "website_link",
  "meeting_rsvp_url", "what_we_do", "site_purpose_items", "join_cards", "events_items", "contact_card_title",
  "contact_card_body", "member_access_title", "member_access_body", "membership_title", "membership_intro",
  "membership_details_title", "membership_details_body", "membership_includes_title", "membership_includes_items",
  "membership_dues_title", "membership_dues_items", "membership_cta_title", "membership_cta_body",
  "membership_poster_url", "membership_url", "archive_title", "archive_intro", "archive_items", "primary_actions",
  "get_involved_links", "section_order", "section_visibility",
]);

function exportableConfig(input) {
  const src = input && typeof input === "object" ? input : {};
  return Object.fromEntries(Object.entries(src).filter(([key]) => SAFE_FIELDS.has(key)));
}

function normalizeProfile(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Profile must be a JSON object.");
  const version = Number(parsed.version || PROFILE_VERSION);
  if (version !== PROFILE_VERSION) throw new Error(`Unsupported profile version: ${version}`);
  const config = parsed.public_site || parsed.publicSite || parsed.config || parsed;
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("Profile does not contain public-site settings.");
  const safe = exportableConfig(config);
  if (!Object.keys(safe).length) throw new Error("Profile contains no recognized public-site settings.");
  return safe;
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function PublicSiteProfileTransfer({ onImported }) {
  const { orgId } = useParams();
  const inputRef = React.useRef(null);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState("");

  async function exportProfile() {
    if (!orgId) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await api(`/api/orgs/${encodeURIComponent(orgId)}/public/get`, { method: "GET" });
      const config = exportableConfig(result?.public || {});
      const slug = String(config.slug || "organization").replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "") || "organization";
      downloadJson(`${slug}-bondfire-public-site.json`, {
        format: "bondfire-public-site-profile",
        version: PROFILE_VERSION,
        exported_at: new Date().toISOString(),
        public_site: config,
      });
      setMessage("Public-site profile exported.");
    } catch (error) {
      setMessage(error?.message || "Unable to export public-site profile.");
    } finally {
      setBusy(false);
    }
  }

  async function importFile(file) {
    if (!orgId || !file) return;
    setBusy(true);
    setMessage("");
    try {
      if (file.size > 2_000_000) throw new Error("Profile is too large. Keep imports under 2 MB.");
      const parsed = JSON.parse(await file.text());
      const config = normalizeProfile(parsed);
      await api(`/api/orgs/${encodeURIComponent(orgId)}/public/save`, {
        method: "POST",
        body: JSON.stringify(config),
      });
      setMessage("Public-site profile imported. Review the site before publishing or changing domains.");
      onImported?.();
    } catch (error) {
      setMessage(error?.message || "Unable to import public-site profile.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <section className="card" style={{ padding: 16 }}>
      <h3 style={{ marginTop: 0 }}>Move or reuse a public-site profile</h3>
      <p className="helper">
        Export the public Organization Page configuration as portable JSON, or import a profile into this organization. Private workspace data, members, keys, and Connected Publication credentials are never included.
      </p>
      <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        <button className="btn" type="button" onClick={exportProfile} disabled={busy}>Export profile</button>
        <button className="btn" type="button" onClick={() => inputRef.current?.click()} disabled={busy}>Import profile</button>
        <input
          ref={inputRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(event) => importFile(event.target.files?.[0])}
        />
      </div>
      {message ? <p className="helper" style={{ marginBottom: 0 }}>{message}</p> : null}
    </section>
  );
}