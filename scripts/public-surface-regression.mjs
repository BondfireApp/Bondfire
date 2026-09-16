import assert from "node:assert/strict";
import {
  normalizeConnectedPublication,
  projectOrganizationPageConfig,
} from "../functions/api/_lib/publicSurface.js";
import {
  normalizeHostname,
  normalizePublicSurface,
  parsePublicDomainScope,
  publicDomainScope,
} from "../functions/api/_lib/publicSiteDomains.js";

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

const organizing = projectOrganizationPageConfig({
  enabled: true,
  template: "organizing",
  branch_label: "Harbor Workers Local",
  hero_headline: "Build worker power.",
  hero_text: "Organize together.",
  membership_title: "Join the union",
  membership_url: "https://example.org/join",
  membership_dues_items: ["Low income", "Regular", "Sustainer"],
  archive_title: "Our history",
  archive_items: [
    { title: "Strike", image_url: "https://example.org/strike.jpg", caption: "Workers on the line." },
  ],
  section_order: ["hero", "membership", "archive"],
  section_visibility: { hero: true, membership: true, archive: false },
  private_member_roster: ["must never leak"],
});
assert.equal(organizing.template, "organizing");
assert.equal(organizing.branch_label, "Harbor Workers Local");
assert.equal(organizing.hero_headline, "Build worker power.");
assert.equal(organizing.membership_url, "https://example.org/join");
assert.deepEqual(organizing.membership_dues_items, ["Low income", "Regular", "Sustainer"]);
assert.equal(organizing.archive_items[0].image_url, "https://example.org/strike.jpg");
assert.deepEqual(organizing.section_order, ["hero", "membership", "archive"]);
assert.equal(organizing.section_visibility.archive, false);
assert.equal(Object.hasOwn(organizing, "private_member_roster"), false);

const unknownTemplate = projectOrganizationPageConfig({ enabled: true, template: "red-harbor-special" });
assert.equal(unknownTemplate.template, "default");

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

assert.equal(publicDomainScope("org-123", "organization"), "org:org-123:organization");
assert.equal(publicDomainScope("org-123", "publication"), "org:org-123:publication");
assert.deepEqual(parsePublicDomainScope("org:org-123:publication"), {
  orgId: "org-123",
  surface: "publication",
  legacy: false,
});
assert.equal(normalizePublicSurface("not-real"), "organization");
assert.equal(normalizeHostname("https://WWW.Example.org:443/path"), "www.example.org");

console.log("public-surface regression checks passed");
