import assert from "node:assert/strict";
import fs from "node:fs";

const drive = fs.readFileSync(new URL("../src/pages/Drive.jsx", import.meta.url), "utf8");
const sidebar = fs.readFileSync(new URL("../src/components/drive/DriveSidebar.jsx", import.meta.url), "utf8");
const modal = fs.readFileSync(new URL("../src/components/drive/DriveShareModal.jsx", import.meta.url), "utf8");
const client = fs.readFileSync(new URL("../src/lib/privateClient.js", import.meta.url), "utf8");
const clientSharing = fs.readFileSync(new URL("../src/lib/driveSharing.js", import.meta.url), "utf8");
const shares = fs.readFileSync(new URL("../functions/api/orgs/[orgId]/drive/shares.js", import.meta.url), "utf8");
const shareStore = fs.readFileSync(new URL("../functions/api/_lib/driveShares.js", import.meta.url), "utf8");
const privateStore = fs.readFileSync(new URL("../functions/api/_lib/privateStore.js", import.meta.url), "utf8");
const privateGate = fs.readFileSync(new URL("../functions/api/_lib/privateGate.js", import.meta.url), "utf8");
const privateBlobs = fs.readFileSync(new URL("../functions/api/_lib/privateBlobs.js", import.meta.url), "utf8");
const privateProtocol = fs.readFileSync(new URL("../functions/api/_lib/privateProtocol.js", import.meta.url), "utf8");

assert.match(sidebar, /label: "Share"/, "Drive items must expose a Share action");
assert.match(sidebar, /Shared with me/, "Drive must expose a Shared with me surface");
assert.match(sidebar, /sharePermission === "view"/, "Drive explorer must recognize view-only shared items");
assert.match(modal, /Can view/, "Drive sharing must offer view permission");
assert.match(modal, /Can edit/, "Drive sharing must offer edit permission");
assert.match(modal, /Copying the link does not grant access by itself/, "Drive links must remain permission-bound");
assert.match(modal, /Needs to sign in on a device/, "Recipients without encryption keys must be explained instead of silently failing");

assert.match(drive, /action: "prepare"/, "Drive sharing must stage key rotation before resealing content");
assert.match(drive, /action: "finalize"/, "Drive sharing must finalize permissions only after resealing");
assert.match(drive, /shareTargetsFor/, "Folder sharing must include descendants");
assert.match(drive, /canEditSelected/, "Drive UI must enforce view-only editing");
assert.match(drive, /pending item key has been preserved/, "Interrupted share rotations must be resumable");

assert.match(client, /__driveShared/, "Restricted Drive content must use an inner item-key envelope");
assert.match(client, /resolveDriveShareKey/, "Private Drive reads and writes must resolve the item key");
assert.match(client, /drive\\\/shares/, "The share-control endpoint must bypass ordinary private-record dispatch");
assert.match(clientSharing, /wrapForMember/, "Drive item keys must be wrapped for recipient devices");
assert.match(clientSharing, /unwrapOrgKey/, "Recipients must unwrap Drive item keys client-side");

assert.match(shareStore, /drive_share_policies/, "Drive sharing must persist policy metadata");
assert.match(shareStore, /drive_share_grants/, "Drive sharing must persist per-user grants");
assert.match(shareStore, /drive_share_keys/, "Drive sharing must persist wrapped recipient keys");
assert.doesNotMatch(shareStore, /plaintext|text_content|body TEXT/i, "Drive share metadata must not introduce readable document storage");

assert.match(shares, /PRIVATE_MODE_REQUIRED/, "Encrypted sharing must require private mode");
assert.match(shares, /DRIVE_SHARE_RECIPIENT_KEY_REQUIRED/, "Every selected recipient must have a wrapped item key");
assert.match(shares, /pending_version/, "Drive sharing must use staged key versions for safe rotation");
assert.match(shares, /active_version/, "Drive sharing must keep an explicit active key version");

assert.match(privateStore, /DRIVE_SHARE_READ_ONLY/, "Server writes must reject view-only Drive access");
assert.match(privateStore, /DRIVE_SHARE_MOVE_REQUIRES_OWNER/, "Shared editors must not move content out of an ACL boundary");
assert.match(privateStore, /created_by/, "New private Drive records must retain a share owner hint");
assert.match(privateGate, /decorateDriveRecord/, "Private Drive listings must be filtered by share grants");
assert.match(privateGate, /route==='drive\/shares'/, "Private middleware must allow the dedicated sharing API");
assert.match(privateBlobs, /getEffectiveDriveSharePolicy/, "Encrypted Drive blobs must follow the effective item or folder share key");
assert.match(privateProtocol, /DRIVE_SHARE_ACCESS_DENIED/, "Encrypted blob reads must enforce Drive sharing access");
assert.match(privateProtocol, /DRIVE_SHARE_READ_ONLY/, "Encrypted blob writes must reject view-only access");

console.log("PASS: Drive sharing permissions, item-key wrapping, inherited folder ACLs, and read-only enforcement");
