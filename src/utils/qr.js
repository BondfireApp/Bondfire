export function buildQrCodeUrl(value, options = {}) {
  const text = String(value || "").trim();
  if (!text) return "";
  const size = Number(options.size || 800);
  const fg = normalizeHex(options.fg || "#000000");
  const bg = normalizeHex(options.bg || "#ffffff");
  const url = new URL("https://api.qrserver.com/v1/create-qr-code/");
  url.searchParams.set("size", `${size}x${size}`);
  url.searchParams.set("format", "png");
  url.searchParams.set("data", text);
  url.searchParams.set("color", fg.replace("#", ""));
  url.searchParams.set("bgcolor", bg.replace("#", ""));
  url.searchParams.set("margin", "0");
  return url.toString();
}

function normalizeHex(input) {
  const value = String(input || "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value;
  return "#000000";
}
