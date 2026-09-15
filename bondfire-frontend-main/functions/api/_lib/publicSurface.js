const MAX_URL_LENGTH = 2000;

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

function normalizeActionUrl(value) {
  const raw = cleanText(value, MAX_URL_LENGTH);
  if (!raw) return "";

  const lower = raw.toLowerCase();
  if (raw.startsWith("#") || lower === "newsletter" || lower.startsWith("modal:")) {
    return raw;
  }
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

function cleanStrings(values, limit) {
  return Array.isArray(values)
    ? values.map((value) => cleanText(value, 500)).filter(Boolean).slice(0, limit)
    : [];
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
  const publicPublication = connectedPublication?.available && connectedPublication.url
    ? connectedPublication
    : null;

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

  const logoUrl = cleanText(input.logoUrl || input.logo_url, MAX_URL_LENGTH);
  const logoDataUrl = cleanText(input.logoDataUrl || input.logo_data_url, 500000);

  return {
    enabled: !!input.enabled,
    newsletter_enabled: !!input.newsletter_enabled,
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
    title: cleanText(input.title, 200),
    location: cleanText(input.location, 200),
    about: cleanText(input.about, 2000),
    accent_color: cleanText(input.accent_color || "#6d5efc", 32),
    theme_mode: String(input.theme_mode || "light").trim() === "dark" ? "dark" : "light",
    website_link: projectedWebsiteLink,
    meeting_rsvp_url: normalizePublicHttpUrl(input.meeting_rsvp_url),
    what_we_do: cleanStrings(input.what_we_do || input.features, 12),
    primary_actions: primaryActions,
    get_involved_links: cleanLinks(input.get_involved_links, 6, { action: true }),
    connected_publication: publicPublication,
    logoUrl: normalizePublicHttpUrl(logoUrl),
    logoDataUrl: logoDataUrl.startsWith("data:image/") ? logoDataUrl : "",
  };
}
