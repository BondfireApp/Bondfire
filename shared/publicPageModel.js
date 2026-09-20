export const PUBLIC_PAGE_SCHEMA_VERSION = 1;

export const PUBLIC_PAGE_FONT_OPTIONS = [
  { value: "system", label: "System sans" },
  { value: "serif", label: "Serif" },
  { value: "sans", label: "Sans" },
  { value: "mono", label: "Monospace" },
  { value: "display", label: "Display" },
];

export const PUBLIC_PAGE_BLOCK_TYPES = [
  "hero",
  "heading",
  "text",
  "list",
  "button",
  "image",
  "quote",
  "divider",
  "spacer",
  "embed",
  "get_help",
  "newsletter",
  "needs",
  "pledges",
  "events",
];

const ALLOWED_TYPES = new Set(PUBLIC_PAGE_BLOCK_TYPES);
const SAFE_FONTS = new Set(PUBLIC_PAGE_FONT_OPTIONS.map((item) => item.value));

function text(value, max = 4000) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, max);
}

export function safePublicUrl(value, { allowActions = false, allowDataImage = false } = {}) {
  const raw = text(value, 2000);
  if (!raw) return "";
  const lower = raw.toLowerCase();
  if (allowActions && (raw.startsWith("#") || lower === "newsletter" || lower.startsWith("modal:"))) return raw;
  if (allowDataImage && raw.startsWith("data:image/") && raw.length <= 500000) return raw;
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  if (/^(mailto:|tel:|sms:|signal:)/i.test(raw)) return raw;
  try {
    const parsed = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : "https://" + raw);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function makeId(prefix = "block") {
  try {
    return prefix + "-" + crypto.randomUUID();
  } catch {
    return prefix + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  }
}

function style(value = {}) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const fontFamily = SAFE_FONTS.has(input.fontFamily) ? input.fontFamily : "system";
  const fontSize = Math.max(12, Math.min(96, Number(input.fontSize) || 18));
  const fontWeight = [400, 500, 600, 700, 800].includes(Number(input.fontWeight)) ? Number(input.fontWeight) : 400;
  const textAlign = ["left", "center", "right"].includes(input.textAlign) ? input.textAlign : "left";
  const fontStyle = input.fontStyle === "italic" ? "italic" : "normal";
  const lineHeight = Math.max(1, Math.min(2.4, Number(input.lineHeight) || 1.5));
  return {
    fontFamily,
    fontSize,
    fontWeight,
    fontStyle,
    color: text(input.color, 32) || "",
    backgroundColor: text(input.backgroundColor, 32) || "",
    textAlign,
    lineHeight,
    letterSpacing: text(input.letterSpacing, 24),
    padding: text(input.padding, 40),
    margin: text(input.margin, 40),
    borderRadius: text(input.borderRadius, 24),
    maxWidth: text(input.maxWidth, 24),
  };
}

function link(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const label = text(value.label || value.text, 160);
  const url = safePublicUrl(value.url, { allowActions: true });
  return label && url ? { label, url } : null;
}

function normalizeProps(type, value = {}) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const props = { ...input };
  if (["hero", "heading", "text", "quote"].includes(type)) props.text = text(input.text || input.title, 6000);
  if (type === "hero") {
    props.eyebrow = text(input.eyebrow, 180);
    props.title = text(input.title || input.text, 500);
    props.text = text(input.text || input.body, 3000);
    props.imageUrl = safePublicUrl(input.imageUrl || input.image_url, { allowDataImage: true });
    props.buttons = Array.isArray(input.buttons) ? input.buttons.map(link).filter(Boolean).slice(0, 4) : [];
  }
  if (type === "list") props.items = Array.isArray(input.items) ? input.items.map((item) => text(item, 500)).filter(Boolean).slice(0, 24) : [];
  if (type === "button") {
    props.label = text(input.label || "Button", 160);
    props.url = safePublicUrl(input.url, { allowActions: true });
  }
  if (type === "image") {
    props.url = safePublicUrl(input.url || input.imageUrl || input.image_url, { allowDataImage: true });
    props.alt = text(input.alt, 300);
    props.caption = text(input.caption, 1000);
  }
  if (type === "quote") {
    props.text = text(input.text, 4000);
    props.attribution = text(input.attribution, 240);
  }
  if (type === "spacer") props.height = Math.max(8, Math.min(320, Number(input.height) || 48));
  if (type === "embed") {
    props.url = safePublicUrl(input.url);
    props.title = text(input.title || "Embedded content", 200);
  }
  if (type === "get_help") {
    props.label = text(input.label || "Get Help", 160);
    props.title = text(input.title || "Get help", 240);
    props.description = text(input.description, 1200);
  }
  if (type === "newsletter") {
    props.title = text(input.title || "Stay connected", 240);
    props.description = text(input.description, 1200);
    props.buttonLabel = text(input.buttonLabel || "Subscribe", 120);
  }
  if (["needs", "pledges", "events"].includes(type)) {
    props.title = text(input.title || type[0].toUpperCase() + type.slice(1), 240);
    props.description = text(input.description, 1200);
  }
  return props;
}

export function normalizePublicPage(input = {}) {
  const raw = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const blocks = Array.isArray(raw.blocks)
    ? raw.blocks.map((block, index) => {
        const type = ALLOWED_TYPES.has(block?.type) ? block.type : "text";
        return {
          id: text(block?.id, 120) || "block-" + (index + 1),
          type,
          hidden: !!block?.hidden,
          props: normalizeProps(type, block?.props || {}),
          style: style(block?.style),
        };
      })
    : [];
  const theme = raw.theme && typeof raw.theme === "object" ? raw.theme : {};
  const fontFamily = SAFE_FONTS.has(theme.fontFamily) ? theme.fontFamily : "system";
  return {
    schemaVersion: PUBLIC_PAGE_SCHEMA_VERSION,
    meta: {
      title: text(raw.meta?.title, 240),
      description: text(raw.meta?.description, 2000),
      socialImage: safePublicUrl(raw.meta?.socialImage),
    },
    theme: {
      fontFamily,
      accentColor: text(theme.accentColor, 32) || "#6d5efc",
      backgroundColor: text(theme.backgroundColor, 32) || "#f6f7fb",
      textColor: text(theme.textColor, 32) || "#232947",
      maxWidth: text(theme.maxWidth, 24) || "1120px",
    },
    blocks: blocks.slice(0, 100),
  };
}

export function createBlock(type = "text") {
  const defaults = {
    hero: { eyebrow: "", title: "New headline", text: "Add an introduction.", imageUrl: "", buttons: [] },
    heading: { text: "New heading" },
    text: { text: "Add text here." },
    list: { items: ["First item"] },
    button: { label: "Learn more", url: "#" },
    image: { url: "", alt: "", caption: "" },
    quote: { text: "Add a quote.", attribution: "" },
    divider: {},
    spacer: { height: 48 },
    embed: { url: "", title: "Embedded content" },
    get_help: { label: "Get Help", title: "Get help", description: "" },
    newsletter: { title: "Stay connected", description: "", buttonLabel: "Subscribe" },
    needs: { title: "Current needs", description: "" },
    pledges: { title: "Offer help", description: "" },
    events: { title: "Events", description: "" },
  };
  const cleanType = ALLOWED_TYPES.has(type) ? type : "text";
  return { id: makeId(cleanType), type: cleanType, hidden: false, props: normalizeProps(cleanType, defaults[cleanType] || defaults.text), style: style({}) };
}

export function legacyPageFromConfig(config = {}) {
  const blocks = [];
  const title = text(config.title || config.hero_headline || "Public page", 500);
  const heroText = text(config.hero_text || config.about || "", 3000);
  blocks.push({
    ...createBlock("hero"),
    props: normalizeProps("hero", {
      eyebrow: config.branch_label || config.location || "",
      title,
      text: heroText,
      imageUrl: config.hero_image_url,
      buttons: Array.isArray(config.primary_actions) ? config.primary_actions : [],
    }),
  });
  if (config.about_title || config.about_intro || config.about_card_body || config.location_card_body) {
    blocks.push({ ...createBlock("heading"), props: normalizeProps("heading", { text: config.about_title || "About" }) });
    blocks.push({ ...createBlock("text"), props: normalizeProps("text", { text: config.about_intro || config.about_card_body || config.location_card_body || "" }) });
  }
  if (Array.isArray(config.what_we_do) && config.what_we_do.length) {
    blocks.push({ ...createBlock("list"), props: normalizeProps("list", { items: config.what_we_do }) });
  }
  blocks.push({
    ...createBlock("get_help"),
    props: normalizeProps("get_help", { label: "Get Help", title: config.contact_title || "Get help", description: config.contact_intro || "" }),
  });
  if (config.newsletter_enabled || config.show_newsletter_card) {
    blocks.push({
      ...createBlock("newsletter"),
      props: normalizeProps("newsletter", { title: config.newsletter_blurb ? "Stay connected" : "Newsletter", description: config.newsletter_blurb || "" }),
    });
  }
  if (config.show_needs !== false) blocks.push(createBlock("needs"));
  if (config.pledges_enabled !== false) blocks.push(createBlock("pledges"));
  if (config.show_meetings !== false) blocks.push(createBlock("events"));
  return normalizePublicPage({
    meta: { title: config.title || title, description: config.about || heroText },
    theme: {
      fontFamily: config.font_family,
      accentColor: config.accent_color,
      backgroundColor: config.theme_mode === "dark" ? "#0f1220" : "#f6f7fb",
      textColor: config.theme_mode === "dark" ? "#f5f7ff" : "#232947",
    },
    blocks,
  });
}

export function pageHasBlocks(value) {
  return normalizePublicPage(value).blocks.length > 0;
}
