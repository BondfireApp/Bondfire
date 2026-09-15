const STORAGE_KEY = "bf_public_customizer_v1";

const DEFAULTS = {
  siteTitle: "",
  tagline: "",
  logoUrl: "",
  mastheadSize: "medium",
  menuItems: [],
  postsPerPage: 10,
  layout: "default",
};

function clampPostsPerPage(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULTS.postsPerPage;
  return Math.max(1, Math.min(50, Math.floor(n)));
}

function cleanText(value, max = 120) {
  return String(value || "").trim().slice(0, max);
}

function normalizeUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^(https?:\/\/|mailto:|tel:|sms:|signal:)/i.test(raw)) return raw;
  if (raw.startsWith("/") || raw.startsWith("#")) return raw;
  return `https://${raw}`;
}

function cleanMenuItem(item) {
  const label = cleanText(item?.label || item?.text, 40);
  const url = normalizeUrl(item?.url);
  if (!label || !url) return null;
  return { label, url };
}

function sanitizeCustomizer(input) {
  const next = input && typeof input === "object" ? input : {};
  const masthead = String(next.mastheadSize || DEFAULTS.mastheadSize).toLowerCase();
  const mastheadSize = ["small", "medium", "large"].includes(masthead) ? masthead : DEFAULTS.mastheadSize;
  const layout = ["default", "stacked", "compact"].includes(String(next.layout || "").toLowerCase())
    ? String(next.layout).toLowerCase()
    : DEFAULTS.layout;

  return {
    siteTitle: cleanText(next.siteTitle, 80),
    tagline: cleanText(next.tagline, 160),
    logoUrl: normalizeUrl(next.logoUrl),
    mastheadSize,
    menuItems: (Array.isArray(next.menuItems) ? next.menuItems : []).map(cleanMenuItem).filter(Boolean).slice(0, 8),
    postsPerPage: clampPostsPerPage(next.postsPerPage),
    layout,
  };
}

export function readPublicCustomizerSettings() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...sanitizeCustomizer(JSON.parse(raw)) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writePublicCustomizerSettings(input) {
  const safe = sanitizeCustomizer(input);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
  return safe;
}

export function publicCustomizerStorageKey() {
  return STORAGE_KEY;
}

export function publicCustomizerDefaults() {
  return { ...DEFAULTS };
}
