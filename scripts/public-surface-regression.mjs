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
import { shouldServePublicationShellRequest } from "../functions/_middleware.js";
import { createPublicColophonFetchBridge } from "../src/lib/publicColophonBridge.js";

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

const htmlHeaders = { Accept: "text/html,application/xhtml+xml" };
assert.equal(shouldServePublicationShellRequest(new Request("https://publication.example.org/post/test", { headers: htmlHeaders })), true);
assert.equal(shouldServePublicationShellRequest(new Request("https://publication.example.org/post/missing", { headers: htmlHeaders })), true);
assert.equal(shouldServePublicationShellRequest(new Request("https://publication.example.org/archive", { headers: htmlHeaders })), true);
assert.equal(shouldServePublicationShellRequest(new Request("https://publication.example.org/", { headers: htmlHeaders })), false);
assert.equal(shouldServePublicationShellRequest(new Request("https://publication.example.org/api/public/domain", { headers: htmlHeaders })), false);
assert.equal(shouldServePublicationShellRequest(new Request("https://publication.example.org/assets/app.js", { headers: htmlHeaders })), false);
assert.equal(shouldServePublicationShellRequest(new Request("https://publication.example.org/post/test", { headers: { Accept: "application/json" } })), false);

const bridgeCalls = [];
const publicProjection = {
  ok: true,
  publication: {
    config: {
      schemaVersion: 4,
      identity: { publicationName: "Field Notes" },
      navigation: { items: [{ label: "Archive", href: "/archive" }] },
    },
  },
  items: [{ id: "post-1", slug: "test", title: "Test", status: "published" }],
};
const baseFetch = async (input, init = {}) => {
  bridgeCalls.push({ url: String(input), method: String(init?.method || "GET").toUpperCase() });
  return new Response(JSON.stringify(publicProjection), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
const bridge = createPublicColophonFetchBridge({
  orgId: "00000000-0000-4000-8000-000000000001",
  baseFetch,
  origin: "https://publication.example.org",
});

const contentResponse = await bridge("https://publication.example.org/api/public/colophon-runtime/native-content", { method: "GET" });
const contentPayload = await contentResponse.json();
assert.equal(contentResponse.status, 200);
assert.equal(contentPayload.mode, "d1");
assert.equal(contentPayload.publicProjection, true);
assert.equal(contentPayload.items[0].slug, "test");

const configResponse = await bridge("https://publication.example.org/api/public/colophon-runtime/public-site-config", { method: "GET" });
const configPayload = await configResponse.json();
assert.equal(configResponse.status, 200);
assert.equal(configPayload.canEdit, false);
assert.equal(configPayload.config.identity.publicationName, "Field Notes");
assert.equal(configPayload.config.navigation.items[0].href, "/archive");

const writeResponse = await bridge("https://publication.example.org/api/public/colophon-runtime/native-content", { method: "POST" });
assert.equal(writeResponse.status, 405);
assert.equal((await writeResponse.json()).error, "PUBLICATION_READ_ONLY");

const unknownRuntimeResponse = await bridge("https://publication.example.org/api/public/colophon-runtime/users", { method: "GET" });
assert.equal(unknownRuntimeResponse.status, 404);
assert.equal((await unknownRuntimeResponse.json()).error, "PUBLICATION_RUNTIME_ENDPOINT_UNAVAILABLE");

const beforePrivatePassthrough = bridgeCalls.length;
await bridge("https://publication.example.org/api/orgs/private-org/members", { method: "GET" });
assert.equal(bridgeCalls.length, beforePrivatePassthrough + 1);
assert.equal(bridgeCalls.at(-1).url, "https://publication.example.org/api/orgs/private-org/members");

// The public projection loader is cached, so canonical content + config reads
// do not fan out into repeated publication projection calls.
assert.equal(bridgeCalls.filter((call) => call.url.includes("/api/public/publication?")).length, 1);

console.log("public-surface regression checks passed");
