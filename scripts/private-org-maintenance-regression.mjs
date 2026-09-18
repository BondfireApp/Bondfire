import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const boundary = read('src/components/PrivateOrgBoundary.jsx');
const client = read('src/lib/privateClient.js');
const scopes = read('functions/api/_lib/privateKeyScopes.js');

// Roster/key maintenance is organization-wide. Individual modules must not be
// left to discover the write barrier independently through failed save buttons.
assert.match(scopes, /rotationRequired:/, 'key status must expose organization-wide rotation state');
assert.match(client, /key\.rotationRequired[\s\S]*Membership or devices changed/, 'private writes must enforce the rotation barrier centrally');
assert.match(boundary, /privacy\/keys\?device_id=/, 'private org boundary must load key-maintenance state');
assert.match(boundary, /rotationRequired/, 'private org boundary must track rotation-required state');
assert.match(boundary, /Encrypted writes are paused for this organization/, 'UI must explain the org-wide write pause');
assert.match(boundary, /organization-wide, not a problem with the module/, 'UI must make clear this is not a per-module failure');
assert.match(boundary, /Rotate encryption keys/, 'owners must get a direct recovery action');
assert.match(boundary, /settings\?tab=security/, 'recovery action must route to organization Security');
assert.match(boundary, /needs\|inventory\|people\|meetings\|events\|drive\|witness\|chat\|chat-module\|studio\|colophon/, 'maintenance warning must cover encrypted module routes');

console.log('Private organization maintenance regression checks passed');
