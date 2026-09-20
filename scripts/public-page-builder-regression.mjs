import assert from "node:assert/strict";
import {
  createBlock,
  legacyPageFromConfig,
  normalizePublicPage,
  safePublicUrl,
} from "../shared/publicPageModel.js";

const legacy = legacyPageFromConfig({
  title: "Red Harbor",
  hero_text: "A public labor and mutual-aid page.",
  newsletter_enabled: true,
  show_needs: false,
  pledges_enabled: false,
});

assert.equal(legacy.schemaVersion, 1);
assert(legacy.blocks.some((block) => block.type === "hero"));
assert(legacy.blocks.some((block) => block.type === "get_help"));
assert(legacy.blocks.some((block) => block.type === "newsletter"));
assert(!legacy.blocks.some((block) => block.type === "needs"));
assert(!legacy.blocks.some((block) => block.type === "pledges"));

const normalized = normalizePublicPage({
  meta: { title: "Test page" },
  blocks: [
    { id: "heading", type: "heading", props: { text: "Editable" }, style: { fontFamily: "serif", fontSize: 42 } },
    { id: "bad", type: "not-a-real-block", props: { text: "<script>alert(1)</script>" } },
    { id: "unsafe", type: "button", props: { label: "Unsafe", url: "javascript:alert(1)" } },
  ],
});

assert.equal(normalized.blocks[0].style.fontFamily, "serif");
assert.equal(normalized.blocks[0].style.fontSize, 42);
assert.equal(normalized.blocks[1].type, "text");
assert.equal(normalized.blocks[2].props.url, "");
assert.equal(safePublicUrl("javascript:alert(1)"), "");
assert.equal(safePublicUrl("https://example.org"), "https://example.org/");

console.log("PASS: structured public page migration, block normalization, safe URLs, and optional Red Harbor modules.");
