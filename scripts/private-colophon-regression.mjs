import assert from "node:assert/strict";
import { env, sql, call } from "./private-storage-regression.mjs";
import { encryptPrivate } from "../src/lib/privateCrypto.js";
import { onRequestGet as readPublicPublication } from "../functions/api/public/publication.js";
import { PRIVATE_CONTENT } from "../shared/privateContent.js";

const org = sql.prepare("SELECT org_id FROM org_private_mode WHERE state='enabled' AND org_id NOT IN ('legacy','file-legacy') ORDER BY completed_at LIMIT 1").get().org_id;
const base = `/api/orgs/${org}`;
const key = crypto.getRandomValues(new Uint8Array(32));

function setModules(modules) {
  sql.prepare(`INSERT INTO org_module_configs(org_id,enabled_modules_json,version,updated_at) VALUES(?,?,1,0)
    ON CONFLICT(org_id) DO UPDATE SET enabled_modules_json=excluded.enabled_modules_json,version=version+1`)
    .run(org, JSON.stringify(modules));
}
setModules(["people","public-site","publishing-colophon"]);

assert.equal(PRIVATE_CONTENT["colophon/content"].write, "member");
assert.equal(PRIVATE_CONTENT["colophon/content"].remove, "admin");
assert.equal(PRIVATE_CONTENT["colophon/config"].write, "admin");

const draftId = crypto.randomUUID();
const draftCiphertext = await encryptPrivate(key, {
  id: draftId,
  title: "SECRET draft",
  body: "SECRET body",
  status: "draft",
}, org, "colophon/content", draftId);

await call(`${base}/colophon/content`, {
  user: "viewer",
  body: { id: draftId, ciphertext: draftCiphertext, revision: 0 },
}, 403);
await call(`${base}/colophon/content`, {
  user: "member",
  body: { id: draftId, ciphertext: draftCiphertext, revision: 0 },
});
const memberRead = await call(`${base}/colophon/content`, { user: "member" });
assert.equal(memberRead.items.length, 1);
assert.equal(memberRead.items[0].ciphertext, draftCiphertext);
assert(!JSON.stringify(sql.prepare("SELECT * FROM org_private_records WHERE org_id=? AND kind LIKE 'colophon/%'").all(org)).includes("SECRET"));
await call(`${base}/colophon/content/${draftId}`, {
  user: "member",
  method: "DELETE",
  body: { id: draftId, revision: 1 },
}, 403);

const configId = "config";
const configCiphertext = await encryptPrivate(key, { title: "SECRET publication config" }, org, "colophon/config", configId);
await call(`${base}/colophon/config`, {
  user: "member",
  body: { id: configId, ciphertext: configCiphertext, revision: 0 },
}, 403);
await call(`${base}/colophon/config`, {
  body: { id: configId, ciphertext: configCiphertext, revision: 0 },
});

await call(`${base}/privacy/colophon-publish`, {
  user: "member",
  body: { kind: "content", id: draftId, public: { id: draftId, slug: "secret-draft", title: "Nope", status: "published" } },
}, 403);
await call(`${base}/privacy/colophon-publish`, {
  body: { kind: "config", public: { title: "Red Harbor Bulletin", description: "Public branch bulletin", privateSecret: "DROP_ME" } },
});
await call(`${base}/privacy/colophon-publish`, {
  body: { kind: "content", id: draftId, public: { id: draftId, slug: "first-post", title: "First public post", body: "Public body", status: "published", privateSecret: "DROP_ME" } },
});

const publicResponse = await readPublicPublication({
  env,
  request: new Request(`https://bulletin.example.test/api/public/publication?org=${encodeURIComponent(org)}`),
});
assert.equal(publicResponse.status, 200);
const publicData = await publicResponse.json();
assert.equal(publicData.private_source, true);
assert.equal(publicData.publication.name, "Red Harbor Bulletin");
assert.equal(publicData.items.length, 1);
assert.equal(publicData.items[0].title, "First public post");
assert(!JSON.stringify(publicData).includes("DROP_ME"));
assert(!JSON.stringify(publicData).includes("SECRET body"));

const oneResponse = await readPublicPublication({
  env,
  request: new Request(`https://bulletin.example.test/api/public/publication?org=${encodeURIComponent(org)}&slug=first-post`),
});
const oneData = await oneResponse.json();
assert.equal(oneData.item.title, "First public post");

setModules(["people","public-site"]);
await call(`${base}/colophon/content`, { user: "member" }, 403);
await call(`${base}/privacy/colophon-publish`, {
  body: { kind: "content", id: draftId, public: null },
}, 403);

setModules(["people","public-site","publishing-colophon"]);
await call(`${base}/colophon/content/${draftId}`, {
  method: "DELETE",
  body: { id: draftId, revision: 1 },
});

console.log("PASS: encrypted Colophon roles, module boundary, ciphertext authority and explicit sanitized publication projection.");
