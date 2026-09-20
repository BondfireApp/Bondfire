import { normalizePublicPage } from "../../../shared/publicPageModel.js";

const MAX_URL_LENGTH = 2000;
const MAX_DATA_URL_LENGTH = 500000;

function cleanText(value, max = 240) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, max);
}

export function normalizePublicHttpUrl(value) {
  let raw = cleanText(value, MAX_URL_LENGTH);
  if (!raw) return "";
  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) raw = `https://${raw}`;

  try {
    const parsed = new URL(raw);
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function normalizeImageSource(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("data:image/") && raw.length <= MAX_DATA_URL_LENGTH) return raw;
  if (raw.startsWith("/") && !raw.startsWith("//") && raw.length <= MAX_URL_LENGTH) return raw;
  return normalizePublicHttpUrl(raw);
}

function normalizeActionUrl(value) {
  const raw = cleanText(value, MAX_URL_LENGTH);
  if (!raw) return "";

  const lower = raw.toLowerCase();
  if (raw.startsWith("#") || lower === "newsletter" || lower.startsWith("modal:")) return raw;
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  if (/^(mailto:|tel:|sms:|signal:)/i.test(raw)) return raw;
  return normalizePublicHttpUrl(raw);
}

function cleanLink(value, { action = false } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const label = cleanText(value.label || value.text, 120);
  const url = action ? normalizeActionUrl(value.url) : normalizePublicHttpUrl(value.url);
  if (!label || !url) return null;
  return { label, url };
}

function cleanLinks(values, limit, options) {
  return Array.isArray(values)
    ? values.map((value) => cleanLink(value, options)).filter(Boolean).slice(0, limit)
    : [];
}

function cleanStrings(values, limit, max = 500) {
  return Array.isArray(values)
    ? values.map((value) => cleanText(value, max)).filter(Boolean).slice(0, limit)
    : [];
}

function cleanJoinCards(values) {
  return Array.isArray(values)
    ? values.slice(0, 6).map((item) => ({
        title: cleanText(item?.title, 180),
        body: cleanText(item?.body, 1200),
      })).filter((item) => item.title || item.body)
    : [];
}

function cleanArchiveItems(values) {
  return Array.isArray(values)
    ? values.slice(0, 24).map((item) => ({
        title: cleanText(item?.title, 220),
        caption: cleanText(item?.caption, 2400),
        image_url: normalizeImageSource(item?.image_url || item?.imageUrl || item?.src),
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

export function normalizeConnectedPublication(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const publicationId = cleanText(value.publication_id || value.publicationId, 160);
  const publicationName = cleanText(value.publication_name || value.publicationName, 160);
  const url = normalizePublicHttpUrl(value.url || value.site_url || value.siteUrl);
  const available = value.available !== false && Boolean(url);

  if (!publicationId && !publicationName && !url) return null;

  return {
    publication_id: publicationId,
    publication_name: publicationName,
    url,
    available,
  };
}

export function projectOrganizationPageConfig(input = {}) {
  const connectedPublication = normalizeConnectedPublication(input.connected_publication);
  const publicPublication = connectedPublication?.available && connectedPublication.url ? connectedPublication : null;
  const websiteLink = cleanLink(input.website_link);
  let primaryActions = cleanLinks(input.primary_actions, 3, { action: true });
  let showActionStrip = input.show_action_strip !== false;
  let showWebsiteButton = !!input.show_website_button;
  let projectedWebsiteLink = websiteLink;

  if (publicPublication) {
    const publicationLink = { label: "Publication Site", url: publicPublication.url };
    if (!projectedWebsiteLink || projectedWebsiteLink.url === publicPublication.url) {
      projectedWebsiteLink = publicationLink;
      showWebsiteButton = true;
    } else if (!primaryActions.some((link) => link.url === publicPublication.url)) {
      primaryActions = [publicationLink, ...primaryActions].slice(0, 3);
      showActionStrip = true;
    }
  }

  const template = cleanText(input.template, 40);
  const logoUrl = input.logoUrl || input.logo_url;
  const logoDataUrl = cleanText(input.logoDataUrl || input.logo_data_url, MAX_DATA_URL_LENGTH);

  return {
    enabled: !!input.enabled,
    newsletter_enabled: !!input.newsletter_enabled,
    newsletter_blurb: cleanText(input.newsletter_blurb, 3000),
    pledges_enabled: input.pledges_enabled !== false,
    show_action_strip: showActionStrip,
    show_needs: input.show_needs !== false,
    show_meetings: input.show_meetings !== false,
    show_what_we_do: input.show_what_we_do !== false,
    show_get_involved: !!input.show_get_involved,
    show_newsletter_card: !!input.show_newsletter_card,
    show_website_button: showWebsiteButton,
    show_available_supplies: input.show_available_supplies !== false,
    slug: cleanText(input.slug, 64),
    template: ["default", "organizing"].includes(template) ? template : "default",
    title: cleanText(input.title, 200),
    location: cleanText(input.location, 200),
    about: cleanText(input.about, 2000),
    branch_label: cleanText(input.branch_label, 200),
    hero_headline: cleanText(input.hero_headline, 300),
    hero_text: cleanText(input.hero_text, 3000),
    about_intro: cleanText(input.about_intro, 3000),
    purpose_title: cleanText(input.purpose_title, 200),
    about_title: cleanText(input.about_title, 200),
    join_title: cleanText(input.join_title, 200),
    bulletin_title: cleanText(input.bulletin_title, 200),
    events_title: cleanText(input.events_title, 200),
    contact_title: cleanText(input.contact_title, 200),
    about_card_title: cleanText(input.about_card_title, 200),
    about_card_body: cleanText(input.about_card_body, 3000),
    location_card_title: cleanText(input.location_card_title, 200),
    location_card_body: cleanText(input.location_card_body, 1200),
    join_intro: cleanText(input.join_intro, 3000),
    contact_intro: cleanText(input.contact_intro, 3000),
    events_intro: cleanText(input.events_intro, 3000),
    hero_image_url: normalizeImageSource(input.hero_image_url),
    font_family: cleanText(input.font_family || "system", 80),
    accent_color: cleanText(input.accent_color || "#6d5efc", 32),
    theme_mode: String(input.theme_mode || "light").trim() === "dark" ? "dark" : "light",
    website_link: projectedWebsiteLink,
    meeting_rsvp_url: normalizePublicHttpUrl(input.meeting_rsvp_url),
    what_we_do: cleanStrings(input.what_we_do || input.features, 12),
    site_purpose_items: cleanStrings(input.site_purpose_items, 8),
    join_cards: cleanJoinCards(input.join_cards),
    events_items: cleanStrings(input.events_items, 8),
    contact_card_title: cleanText(input.contact_card_title, 200),
    contact_card_body: cleanText(input.contact_card_body, 3000),
    member_access_title: cleanText(input.member_access_title, 200),
    member_access_body: cleanText(input.member_access_body, 3000),
    membership_title: cleanText(input.membership_title, 200),
    membership_intro: cleanText(input.membership_intro, 3000),
    membership_details_title: cleanText(input.membership_details_title, 200),
    membership_details_body: cleanText(input.membership_details_body, 4000),
    membership_includes_title: cleanText(input.membership_includes_title, 200),
    membership_includes_items: cleanStrings(input.membership_includes_items, 12),
    membership_dues_title: cleanText(input.membership_dues_title, 200),
    membership_dues_items: cleanStrings(input.membership_dues_items, 12),
    membership_cta_title: cleanText(input.membership_cta_title, 200),
    membership_cta_body: cleanText(input.membership_cta_body, 3000),
    membership_poster_url: normalizeImageSource(input.membership_poster_url),
    membership_url: normalizePublicHttpUrl(input.membership_url),
    archive_title: cleanText(input.archive_title, 200),
    archive_intro: cleanText(input.archive_intro, 3000),
    archive_items: cleanArchiveItems(input.archive_items),
    primary_actions: primaryActions,
    get_involved_links: cleanLinks(input.get_involved_links, 6, { action: true }),
    section_order: cleanStrings(input.section_order, 30, 64),
    section_visibility: cleanSectionVisibility(input.section_visibility),
    page: normalizePublicPage(input.page || input.published_page || {}),
    connected_publication: publicPublication,
    logoUrl: normalizeImageSource(logoUrl),
    logoDataUrl: logoDataUrl.startsWith("data:image/") ? logoDataUrl : "",
  };
}