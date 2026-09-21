import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { ensureDriveShareSchema, driveAccessForUser } from "../functions/api/_lib/driveShares.js";
import { onRequest as driveSharesEndpoint } from "../functions/api/orgs/[orgId]/drive/shares.js";

const drive = fs.readFileSync(new URL("../src/pages/Drive.jsx", import.meta.url), "utf8");
const sidebar = fs.readFileSync(new URL("../src/components/drive/DriveSidebar.jsx", import.meta.url), "utf8");
const modal = fs.readFileSync(new URL("../src/components/drive/DriveShareModal.jsx", import.meta.url), "utf8");
const client = fs.readFileSync(new URL("../src/lib/privateClient.js", import.meta.url), "utf8");
const clientSharing = fs.readFileSync(new URL("../src/lib/driveSharing.js", import.meta.url), "utf8");
const zkClient = fs.readFileSync(new URL("../src/lib/zk.js", import.meta.url), "utf8");
const apiClient = fs.readFileSync(new URL("../src/utils/api.js", import.meta.url), "utf8");
const shares = fs.readFileSync(new URL("../functions/api/orgs/[orgId]/drive/shares.js", import.meta.url), "utf8");
const shareStore = fs.readFileSync(new URL("../functions/api/_lib/driveShares.js", import.meta.url), "utf8");
const privateStore = fs.readFileSync(new URL("../functions/api/_lib/privateStore.js", import.meta.url), "utf8");
const privateGate = fs.readFileSync(new URL("../functions/api/_lib/privateGate.js", import.meta.url), "utf8");
const privateBlobs = fs.readFileSync(new URL("../functions/api/_lib/privateBlobs.js", import.meta.url), "utf8");
const privateProtocol = fs.readFileSync(new URL("../functions/api/_lib/privateProtocol.js", import.meta.url), "utf8");

assert.equal(typeof driveSharesEndpoint, "function", "Drive share endpoint must import successfully");

const sql = new DatabaseSync(":memory:");
const db = {
  prepare(query) {
    const stmt = sql.prepare(query);
    let values = [];
    return {
      bind(...next) { values = next; return this; },
      async run() { return { success: true, meta: stmt.run(...values) }; },
      async first() { return stmt.get(...values) || null; },
      async all() { return { results: stmt.all(...values) }; },
    };
  },
};
sql.exec(`CREATE TABLE org_private_records(
  org_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  parent_id TEXT,
  ciphertext TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  deleting INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(org_id,kind,id)
);`);
await ensureDriveShareSchema(db);
sql.prepare("INSERT INTO org_private_records(org_id,kind,id,parent_id,ciphertext,created_at,updated_at,created_by) VALUES(?,?,?,?,?,?,?,?)")
  .run("org-1","drive/folders","folder-1",null,"cipher",1,1,"owner");
sql.prepare("INSERT INTO org_private_records(org_id,kind,id,parent_id,ciphertext,created_at,updated_at,created_by) VALUES(?,?,?,?,?,?,?,?)")
  .run("org-1","drive/notes","note-1","folder-1","cipher",1,1,"owner");
sql.prepare("INSERT INTO drive_share_policies(org_id,kind,item_id,owner_user_id,active_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
  .run("org-1","drive/folders","folder-1","owner",1,1,1);
sql.prepare("INSERT INTO drive_share_grants(org_id,kind,item_id,version,user_id,permission) VALUES(?,?,?,?,?,?)")
  .run("org-1","drive/folders","folder-1",1,"alice","view");
assert.equal((await driveAccessForUser(db,"org-1","drive/notes","note-1","alice")).permission,"view","folder grants must inherit to descendants");
assert.equal((await driveAccessForUser(db,"org-1","drive/notes","note-1","bob")).allowed,false,"ungranted members must not inherit restricted Drive access");
assert.equal((await driveAccessForUser(db,"org-1","drive/notes","note-1","owner")).permission,"owner","share owner must retain access");

assert.match(sidebar, /label: "Manage access"/, "Drive items must describe ACL changes as access management, not ordinary sharing");
assert.match(sidebar, /Shared with me/, "Drive must expose a Shared with me surface");
assert.match(sidebar, /sharePermission === "view"/, "Drive explorer must recognize view-only shared items");
assert.match(modal, /Can view/, "Drive sharing must offer view permission");
assert.match(modal, /Can edit/, "Drive sharing must offer edit permission");
assert.match(modal, /disabled=\{String\(member\?\.role \|\| ""\) === "viewer"\}/, "Organization viewers must not be offered an effective edit grant");
assert.match(modal, /Private Drive link/, "Permission-bound Drive links must be labeled as private");
assert.match(modal, /Requires a Bondfire account with permission to this item/, "Private Drive links must explain sign-in and permission requirements");
assert.match(modal, /Everyone in this organization with Drive access can already open this item/, "Organization-wide Drive access must be explicit before restriction");
assert.match(modal, /Access inherited from Drive/, "Unrestricted member access must be described as inherited rather than selected");
assert.match(modal, /Restrict access/, "Organization-wide items must present restriction as the action");
assert.match(modal, /Copying this link does not grant access by itself/, "Drive links must remain permission-bound");
assert.match(modal, /Needs to sign in on a device/, "Recipients without encryption keys must be explained instead of silently failing");

assert.match(drive, /action: "prepare"/, "Drive sharing must stage key rotation before resealing content");
assert.match(drive, /action: "finalize"/, "Drive sharing must finalize permissions only after resealing");
assert.match(drive, /shareTargetsFor/, "Folder sharing must include descendants");
assert.match(drive, /directOverride[\s\S]*shareRootId === folder\.id/, "Parent folder rotations must preserve nested direct folder shares");
assert.match(drive, /canEditSelected/, "Drive UI must enforce view-only editing");
assert.match(drive, /pending item key has been preserved/, "Interrupted share rotations must be resumable");
assert.match(drive, /flushPendingDriveSave/, "Sharing the selected item must wait for any active Drive save");
assert.match(drive, /apiWithTimeout/, "Drive sharing requests must have bounded network waits");
assert.match(drive, /onProgress\?\./, "Drive sharing must report which encryption step is running");
assert.match(drive, /Promise\.allSettled/, "Post-share Drive refresh must not keep the sharing modal blocked");
assert.match(modal, /busyLabel/, "Share modal must show progress instead of an indefinite generic spinner");
assert.match(modal, /Preparing encrypted access/, "Share modal must expose the current sharing stage");
assert.match(modal, /ensureDeviceKeypair\(\{ register: false \}\)/, "Opening Share must not perform a CSRF-protected device-key write");
assert.match(clientSharing, /ensureDeviceKeypair\(\{ register: false \}\)/, "Resolving existing Drive share keys must remain read-only");
assert.match(zkClient, /ensureDeviceKeypair\(\{ register = true \} = \{\}\)/, "Device-key registration must be explicitly suppressible for read paths");
assert.match(zkClient, /if \(register\)[\s\S]*\/api\/auth\/keys/, "Writable key preparation must still register device keys when needed");
assert.match(apiClient, /csrfPayload\?\.error === "CSRF_REQUIRED"/, "Blocked writes must recognize stale CSRF sessions");
assert.match(apiClient, /await tryRefresh\(\)/, "Stale CSRF writes must refresh the cookie session before one safe retry");
assert.match(apiClient, /retryHeaders\.delete\("x-csrf"\)[\s\S]*applyCsrfHeader\(retryHeaders\)/, "CSRF retry must use the newly issued token instead of replaying the stale header");
assert.match(client, /inheritedSignal/, "Private Drive subrequests must inherit cancellation from the outer operation");

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
assert.match(shares, /resolvingNewItem = !item && url\.searchParams\.has\(['"]parentId['"]\)/, "New encrypted Drive items must resolve inherited access before their record exists");
assert.match(shares, /!item && !resolvingNewItem/, "Drive share lookup must still reject unknown existing-item requests");
assert.match(shares, /DRIVE_SHARE_RECIPIENT_KEY_REQUIRED/, "Every selected recipient must have a wrapped item key");
assert.match(shares, /grant\.permission === ['"]edit['"] && memberRoles\.get\(grant\.userId\) === ['"]viewer['"]/, "Drive edit grants must not exceed the recipient organization role");
assert.match(shares, /detail\.restricted && !detail\.permission/, "Restricted Drive shares must not grant implicit administrator access");
assert.match(shares, /ownerUserId && ownerUserId !== String\(gate\.user\.sub\)/, "Restricted Drive share changes must remain controlled by the cryptographic share owner");
assert.match(shares, /DRIVE_SHARE_LEGACY_MANAGER_REQUIRED/, "Creatorless legacy Drive items must not be claimable by ordinary members");

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
