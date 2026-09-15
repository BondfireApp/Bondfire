import { slugify, uniqueSlug, getPublicCfg, setPublicCfg, setSlugMapping, removeSlugMapping } from "../../../_lib/publicPageStore.js";
import { normalizeConnectedPublication } from "../../../_lib/publicSurface.js";
import { bad, ok } from "../../../_lib/http.js";
import { enforceOrgWriteLockdown } from "../../../_lib/orgLockdown.js";

function authOk(env, request) {
  if (env.BF_WRITE_LOCKED === "true") {
    const auth = request.headers.get("authorization") || "";
    return auth.startsWith("Bearer ");
  }
  return true;
}

function cleanLink(value) {
  if (!value || typeof value !== "object") return null;
  const label = String(value.label || value.text || "").trim();
  const url = String(value.url || "").trim();
  if (!label || !url) return null;
  return { label, url };
}

function cleanLinks(arr, limit) {
  return Array.isArray(arr)
    ? arr.map(cleanLink).filter(Boolean).slice(0, limit)
    : [];
}

function cleanStrings(arr, limit) {
  return Array.isArray(arr)
    ? arr.map((s) => String(s || "").trim()).filter(Boolean).slice(0, limit)
    : [];
}

export async function onRequestPost({ env, request, params }) {
  if (!authOk(env, request)) {
    return bad(401, "UNAUTHORIZED");
  }

  const orgId = params.orgId;
  const lockdown = await enforceOrgWriteLockdown({ env, orgId });
  if (!lockdown.ok) return lockdown.resp;

  const body = await request.json().catch(() => ({}));
  const {
    enabled,
    newsletter_enabled,
    pledges_enabled,
    show_action_strip,
    show_needs,
    show_meetings,
    show_what_we_do,
    show_get_involved,
    show_newsletter_card,
    show_website_button,
    title,
    location,
    about,
    accent_color,
    theme_mode,
    website_link,
    meeting_rsvp_url,
    what_we_do,
    primary_actions,
    get_involved_links,
    slug,
  } = body || {};

  const prev = await getPublicCfg(env, orgId);
  let newSlug = prev.slug;

  if (typeof slug === "string" && slug.trim()) {
    const base = slugify(slug);
    if (!base) return bad(400, "BAD_SLUG");

    if (prev.slug) {
      const mapped = await env.BF_PUBLIC.get(`slug:${prev.slug}`);
      if (mapped === orgId) await removeSlugMapping(env, prev.slug);
    }

    const final = await uniqueSlug(env, base, orgId);
    await setSlugMapping(env, final, orgId);
    newSlug = final;
  } else if (!prev.slug) {
    const base = slugify(title) || slugify(orgId) || "org";
    const final = await uniqueSlug(env, base, orgId);
    await setSlugMapping(env, final, orgId);
    newSlug = final;
  }

  const cleaned = {
    enabled: !!enabled,
    newsletter_enabled: !!newsletter_enabled,
    pledges_enabled: pledges_enabled !== false,
    show_action_strip: show_action_strip !== false,
    show_needs: show_needs !== false,
    show_meetings: show_meetings !== false,
    show_what_we_do: show_what_we_do !== false,
    show_get_involved: !!show_get_involved,
    show_newsletter_card: !!show_newsletter_card,
    show_website_button: !!show_website_button,
    slug: newSlug,
    title: String(title || "").trim(),
    location: String(location || "").trim(),
    about: String(about || "").trim(),
    accent_color: String(accent_color || "#6d5efc").trim(),
    theme_mode: String(theme_mode || "light").trim() === "dark" ? "dark" : "light",
    website_link: cleanLink(website_link),
    meeting_rsvp_url: String(meeting_rsvp_url || "").trim(),
    what_we_do: cleanStrings(what_we_do, 12),
    primary_actions: cleanLinks(primary_actions, 3),
    get_involved_links: cleanLinks(get_involved_links, 4),
    connected_publication: normalizeConnectedPublication(prev?.connected_publication),
  };

  await setPublicCfg(env, orgId, cleaned);
  return ok({ public: cleaned });
}
