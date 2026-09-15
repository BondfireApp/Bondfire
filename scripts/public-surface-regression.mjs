import assert from "node:assert/strict";
import {
  normalizeConnectedPublication,
  projectOrganizationPageConfig,
} from "../functions/api/_lib/publicSurface.js";

const connected = normalizeConnectedPublication({
  publication_id: "pub-1",
  publication_name: "Field Notes",
  url: "publication.example.org",
  available: true,
});
assert.equal(connected.url, "https://publication.example.org/");
assert.equal(connected.available, true);

const hiddenInvalid = normalizeConnectedPublication({
  publication_id: "pub-2",
  publication_name: "Bad URL",
  url: "javascript:alert(1)",
  available: true,
});
assert.equal(hiddenInvalid.available, false);
assert.equal(hiddenInvalid.url, "");

const projected = projectOrganizationPageConfig({
  enabled: true,
  title: "Mutual Aid",
  private_notes: "never publish this",
  connected_publication: connected,
});
assert.equal(projected.connected_publication.publication_id, "pub-1");
assert.deepEqual(projected.website_link, {
  label: "Publication Site",
  url: "https://publication.example.org/",
});
assert.equal(projected.show_website_button, true);
assert.equal(Object.hasOwn(projected, "private_notes"), false);

const withExistingWebsite = projectOrganizationPageConfig({
  enabled: true,
  show_action_strip: false,
  show_website_button: true,
  website_link: { label: "Main site", url: "https://example.org" },
  primary_actions: [{ label: "Get Help", url: "modal:get_help" }],
  connected_publication: connected,
});
assert.deepEqual(withExistingWebsite.website_link, {
  label: "Main site",
  url: "https://example.org/",
});
assert.deepEqual(withExistingWebsite.primary_actions[0], {
  label: "Publication Site",
  url: "https://publication.example.org/",
});
assert.equal(withExistingWebsite.show_action_strip, true);

const unavailable = projectOrganizationPageConfig({
  enabled: true,
  connected_publication: { ...connected, available: false },
});
assert.equal(unavailable.connected_publication, null);
assert.equal(unavailable.website_link, null);

console.log("public-surface regression checks passed");
