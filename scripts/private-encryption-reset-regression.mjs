import fs from 'node:fs';
import assert from 'node:assert/strict';

const server = fs.readFileSync(new URL('../functions/api/_lib/privateReset.js', import.meta.url), 'utf8');
const endpoint = fs.readFileSync(new URL('../functions/api/orgs/[orgId]/privacy/reset.js', import.meta.url), 'utf8');
const client = fs.readFileSync(new URL('../src/lib/privateEncryptionReset.js', import.meta.url), 'utf8');
const panel = fs.readFileSync(new URL('../src/components/ScopedKeysPanel.jsx', import.meta.url), 'utf8');

assert.match(endpoint, /privateEncryptionReset/, 'reset endpoint must delegate to the guarded reset handler');
assert.match(server, /minRole: 'owner'/, 'reset must be owner-only');
assert.match(server, /RESET_REQUIRES_SINGLE_MEMBER_ORG/, 'reset must refuse multi-member organizations');
assert.match(server, /RESET_PRIVATE_FILES_PRESENT/, 'reset must refuse organizations with encrypted file blobs');
assert.match(server, /RESET ENCRYPTION/, 'reset must require an explicit destructive confirmation');
assert.match(server, /DELETE FROM org_private_records/, 'reset must discard inaccessible encrypted records');
assert.match(server, /DELETE FROM org_private_scope_wraps/, 'reset must discard old scoped wraps');
assert.match(server, /DELETE FROM org_key_recovery/, 'reset must discard old recovery material');
assert.match(server, /INSERT INTO org_private_records\(org_id,kind,id,ciphertext,revision/, 'reset must recreate the encrypted organization bootstrap record');
assert.doesNotMatch(server, /DELETE FROM orgs\b/, 'reset must preserve the organization row and ID');
assert.doesNotMatch(server, /DELETE FROM public_site_domains/, 'reset must preserve custom-domain bindings');
assert.doesNotMatch(server, /DELETE FROM org_module_configs/, 'reset must preserve enabled modules');
assert.doesNotMatch(server, /DELETE FROM org_memberships/, 'reset must preserve membership');

assert.match(client, /keyState\.roster/, 'client must wrap fresh keys to the current registered-device roster');
assert.match(client, /cacheOrgKey\(orgId, rootKey\)/, 'client must cache the fresh root key after a successful reset');
assert.match(client, /cacheOrgName\(orgId, clearName\)/, 'client must preserve the chosen organization name locally');
assert.match(panel, /Reset encryption and create new keys/, 'security UI must expose the explicit reset control');
assert.match(panel, /custom domains/, 'security UI must tell the owner that domain bindings are preserved');
assert.match(panel, /resetInventory\?\.blobCount/, 'security UI must block reset when encrypted files exist');

console.log('private encryption reset regression checks passed');
