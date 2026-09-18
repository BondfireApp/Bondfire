import { slugify, uniqueSlug, getPublicCfg, setPublicCfg, setSlugMapping, removeSlugMapping } from "../../../_lib/publicPageStore.js";
import { normalizeConnectedPublication } from "../../../_lib/publicSurface.js";
import { bad, ok } from "../../../_lib/http.js";
import { requireOrgRole } from "../../../_lib/auth.js";
import { enforceOrgWriteLockdown } from "../../../_lib/orgLockdown.js";

function cleanText(value, max = 4000) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
}

function cleanLink(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const label = cleanText(value.label || value.text, 120);
  const url = cleanText(value.url, 2000);
  if (!label || !url) return null;
  return { label, url };
}

function cleanLinks(arr, limit) {
  return Array.isArray(arr) ? arr.map(cleanLink).filter(Boolean).slice(0, limit) : [];
}

function cleanStrings(arr, limit, max = 500) {
  return Array.isArray(arr)
    ? arr.map((value) => cleanText(value, max)).filter(Boolean).slice(0, limit)
    : [];
}

function cleanJoinCards(arr) {
  return Array.isArray(arr)
    ? arr.slice(0, 6).map((item) => ({
        title: cleanText(item?.title, 180),
        body: cleanText(item?.body, 1200),
      })).filter((item) => item.title || item.body)
    : [];
}

function cleanArchiveItems(arr) {
  return Array.isArray(arr)
    ? arr.slice(0, 24).map((item) => ({
        title: cleanText(item?.title, 220),
        caption: cleanText(item?.caption, 2400),
        image_url: cleanText(item?.image_url || item?.imageUrl || item?.src, 500000),
      })).filter((item) => item.title || item.caption || item.image_url)
    : [];
}

function cleanSectionVisibility(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 30)
      .map(([key, visible]) => [cleanText(key, 64), !!visible])
      .filter(([key]) => key)
  );
}

function textField(body, prev, key, max = 4000) {
  return body?.[key] === undefined ? cleanText(prev?.[key], max) : cleanText(body[key], max);
}

function boolField(body, prev, key, fallback = false) {
  if (body?.[key] === undefined) return prev?.[key] === undefined ? fallback : !!prev[key];
  return !!body[key];
}

function arrayField(body, prev, key, limit, max = 500) {
  return body?.[key] === undefined
    ? cleanStrings(prev?.[key], limit, max)
    : cleanStrings(body[key], limit, max);
}

export async function onRequestPost({ env, request, params }) {
  const orgId = String(params?.orgId || "").trim();
  if (!orgId) return bad(400, "MISSING_ORG_ID");

  const auth = await requireOrgRole({ env, request, orgId, minRole: "admin" });
  if (!auth.ok) return auth.resp;

  const lockdown = await enforceOrgWriteLockdown({ env, orgId });
  if (!lockdown.ok) return lockdown.resp;

  const body = await request.json().catch(() => ({}));
  const prev = await getPublicCfg(env, orgId);
  let newSlug = String(prev?.slug || "").trim();

  if (typeof body.slug === "string" && body.slug.trim()) {
    const base = slugify(body.slug);
    if (!base) return bad(400, "BAD_SLUG");

    if (prev?.slug && prev.slug !== base) {
      const mapped = await env.BF_PUBLIC.get(`slug:${prev.slug}`);
      if (mapped === orgId) await removeSlugMapping(env, prev.slug);
    }

    const final = await uniqueSlug(env, base, orgId);
    await setSlugMapping(env, final, orgId);
    newSlug = final;
  } else if (!newSlug) {
    const base = slugify(body.title || body.hero_headline || orgId) || "org";
    const final = await uniqueSlug(env, base, orgId);
    await setSlugMapping(env, final, orgId);
    newSlug = final;
  }

  const template = textField(body, prev, "template", 40) || "default";
  const cleaned = {
    ...prev,
    enabled: boolField(body, prev, "enabled", false),
    newsletter_enabled: boolField(body, prev, "newsletter_enabled", false),
    pledges_enabled: body?.pledges_enabled === undefined ? prev?.pledges_enabled !== false : body.pledges_enabled !== false,
    show_action_strip: body?.show_action_strip === undefined ? prev?.show_action_strip !== false : body.show_action_strip !== false,
    show_needs: body?.show_needs === undefined ? prev?.show_needs !== false : body.show_needs !== false,
    show_meetings: body?.show_meetings === undefined ? prev?.show_meetings !== false : body.show_meetings !== false,
    show_what_we_do: body?.show_what_we_do === undefined ? prev?.show_what_we_do !== false : body.show_what_we_do !== false,
    show_get_involved: boolField(body, prev, "show_get_involved", false),
    show_newsletter_card: boolField(body, prev, "show_newsletter_card", false),
    show_website_button: boolField(body, prev, "show_website_button", false),
    show_available_supplies: body?.show_available_supplies === undefined ? prev?.show_available_supplies !== false : body.show_available_supplies !== false,
    slug: newSlug,
    template: ["default", "organizing"].includes(template) ? template : "default",
    title: textField(body, prev, "title", 200),
    location: textField(body, prev, "location", 200),
    about: textField(body, prev, "about", 2000),
    branch_label: textField(body, prev, "branch_label", 200),
    hero_headline: textField(body, prev, "hero_headline", 300),
    hero_text: textField(body, prev, "hero_text", 3000),
    about_intro: textField(body, prev, "about_intro", 3000),
    purpose_title: textField(body, prev, "purpose_title", 200),
    about_title: textField(body, prev, "about_title", 200),
    join_title: textField(body, prev, "join_title", 200),
    bulletin_title: textField(body, prev, "bulletin_title", 200),
    events_title: textField(body, prev, "events_title", 200),
    contact_title: textField(body, prev, "contact_title", 200),
    about_card_title: textField(body, prev, "about_card_title", 200),
    about_card_body: textField(body, prev, "about_card_body", 3000),
    location_card_title: textField(body, prev, "location_card_title", 200),
    location_card_body: textField(body, prev, "location_card_body", 1200),
    join_intro: textField(body, prev, "join_intro", 3000),
    contact_intro: textField(body, prev, "contact_intro", 3000),
    events_intro: textField(body, prev, "events_intro", 3000),
    hero_image_url: textField(body, prev, "hero_image_url", 500000),
    logo_url: textField(body, prev, "logo_url", 500000),
    logo_data_url: textField(body, prev, "logo_data_url", 500000),
    font_family: textField(body, prev, "font_family", 80) || "system",
    accent_color: textField(body, prev, "accent_color", 32) || "#6d5efc",
    theme_mode: textField(body, prev, "theme_mode", 16) === "dark" ? "dark" : "light",
    website_link: body?.website_link === undefined ? cleanLink(prev?.website_link) : cleanLink(body.website_link),
    meeting_rsvp_url: textField(body, prev, "meeting_rsvp_url", 2000),
    what_we_do: arrayField(body, prev, "what_we_do", 12),
    site_purpose_items: arrayField(body, prev, "site_purpose_items", 8),
    join_cards: body?.join_cards === undefined ? cleanJoinCards(prev?.join_cards) : cleanJoinCards(body.join_cards),
    events_items: arrayField(body, prev, "events_items", 8),
    contact_card_title: textField(body, prev, "contact_card_title", 200),
    contact_card_body: textField(body, prev, "contact_card_body", 3000),
    member_access_title: textField(body, prev, "member_access_title", 200),
    member_access_body: textField(body, prev, "member_access_body", 3000),
    membership_title: textField(body, prev, "membership_title", 200),
    membership_intro: textField(body, prev, "membership_intro", 3000),
    membership_details_title: textField(body, prev, "membership_details_title", 200),
    membership_details_body: textField(body, prev, "membership_details_body", 4000),
    membership_includes_title: textField(body, prev, "membership_includes_title", 200),
    membership_includes_items: arrayField(body, prev, "membership_includes_items", 12),
    membership_dues_title: textField(body, prev, "membership_dues_title", 200),
    membership_dues_items: arrayField(body, prev, "membership_dues_items", 12),
    membership_cta_title: textField(body, prev, "membership_cta_title", 200),
    membership_cta_body: textField(body, prev, "membership_cta_body", 3000),
    membership_poster_url: textField(body, prev, "membership_poster_url", 500000),
    membership_url: textField(body, prev, "membership_url", 2000),
    archive_title: textField(body, prev, "archive_title", 200),
    archive_intro: textField(body, prev, "archive_intro", 3000),
    archive_items: body?.archive_items === undefined ? cleanArchiveItems(prev?.archive_items) : cleanArchiveItems(body.archive_items),
    primary_actions: body?.primary_actions === undefined ? cleanLinks(prev?.primary_actions, 3) : cleanLinks(body.primary_actions, 3),
    get_involved_links: body?.get_involved_links === undefined ? cleanLinks(prev?.get_involved_links, 6) : cleanLinks(body.get_involved_links, 6),
    section_order: body?.section_order === undefined
      ? cleanStrings(prev?.section_order, 30, 64)
      : cleanStrings(body.section_order, 30, 64),
    section_visibility: body?.section_visibility === undefined
      ? cleanSectionVisibility(prev?.section_visibility)
      : cleanSectionVisibility(body.section_visibility),
    connected_publication: normalizeConnectedPublication(prev?.connected_publication),
  };

  await setPublicCfg(env, orgId, cleaned);
  return ok({ public: cleaned });
}