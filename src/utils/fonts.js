export const GOOGLE_FONT_CATALOG = [
  "Inter", "Roboto", "Open Sans", "Lato", "Montserrat", "Poppins", "Oswald", "Merriweather",
  "Playfair Display", "Bebas Neue", "Work Sans", "Nunito", "DM Sans", "Archivo", "Manrope",
  "Rubik", "Fira Sans", "Source Sans 3", "Source Serif 4", "Libre Baskerville", "Lora",
  "PT Sans", "PT Serif", "Raleway", "Ubuntu", "Cabin", "Barlow", "Karla", "Inconsolata",
  "IBM Plex Sans", "IBM Plex Serif", "Anton", "League Spartan", "Archivo Black", "Permanent Marker",
  "Space Grotesk", "Space Mono", "Quicksand", "Heebo", "Noto Sans", "Noto Serif", "Mukta",
  "Hind", "Bitter", "Arvo", "Cormorant Garamond", "Crimson Pro", "Alegreya", "Libre Franklin",
  "Assistant", "Exo 2", "Titillium Web", "Teko", "Sora", "Urbanist", "Plus Jakarta Sans",
  "Josefin Sans", "Merriweather Sans", "Public Sans", "Fraunces", "Caveat", "Pacifico",
];

export function buildGoogleFontHref(family) {
  const safe = String(family || "").trim();
  if (!safe) return "";
  const encoded = safe.replace(/ /g, "+");
  return `https://fonts.googleapis.com/css2?family=${encoded}:wght@400;500;600;700;800&display=swap`;
}

export function normalizeFontFamilyName(input) {
  return String(input || "")
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function detectFontFormat(file) {
  const name = String(file?.name || "").toLowerCase();
  if (name.endsWith(".woff2")) return "woff2";
  if (name.endsWith(".woff")) return "woff";
  if (name.endsWith(".ttf")) return "truetype";
  if (name.endsWith(".otf")) return "opentype";
  return "";
}

export function uploadedFontsStorageKey(orgId) {
  return `bf_studio_uploaded_fonts_${orgId || "global"}`;
}

export function recentFontsStorageKey(orgId) {
  return `bf_studio_font_recent_${orgId || "global"}`;
}

export function readStoredJson(key, fallback) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

export function saveStoredJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}
