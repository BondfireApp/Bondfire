import fs from 'node:fs';
import assert from 'node:assert/strict';

const security = fs.readFileSync(new URL('../src/pages/Security.jsx', import.meta.url), 'utf8');
const scoped = fs.readFileSync(new URL('../src/components/ScopedKeysPanel.jsx', import.meta.url), 'utf8');
const storage = fs.readFileSync(new URL('../src/components/PrivateStoragePanel.jsx', import.meta.url), 'utf8');
const emergency = fs.readFileSync(new URL('../src/components/EmergencyProtocolPanel.jsx', import.meta.url), 'utf8');

assert.match(security, /Two-factor authentication/, 'security page must expose account MFA');
assert.match(security, /mfa_enabled/, 'MFA UI must use server-truth enabled state');
assert.match(security, /result\?\.otpauth/, 'MFA setup must use the backend otpauth field');
assert.doesNotMatch(security, /otpauth_url/, 'obsolete MFA otpauth_url field must not return');
assert.match(security, /ScopedKeysPanel/, 'security page must expose current scoped-key recovery');
assert.match(security, /PrivateStoragePanel/, 'security page must expose encrypted-storage state');
assert.match(security, /EmergencyProtocolPanel/, 'security page must expose organization emergency controls');
assert.match(security, /AccountDestructionPanel/, 'security page must keep personal account deletion available');
assert.doesNotMatch(security, /Organization encryption keys/, 'legacy root-key controls must not be shown');
assert.doesNotMatch(security, /enableZkForOrg|saveRecoveryToServer|loadRecoveryFromServer|unwrapOrgKeyFromRecovery/, 'legacy duplicate key/recovery handlers must not return to Security');

assert.match(scoped, /Encryption keys & recovery/, 'current key lifecycle should have one clear heading');
assert.match(scoped, /!missingCurrentDevice&&<form/, 'rotation controls must be hidden when this browser lacks current keys');
assert.match(scoped, /Reset encryption/, 'lost-passphrase reset flow must remain available to eligible owners');
assert.match(scoped, /Reader key:/, 'scope meanings must be explained');
assert.match(scoped, /Member key:/, 'scope meanings must be explained');
assert.match(scoped, /Administrator key:/, 'scope meanings must be explained');

assert.match(storage, /Public organization pages and Colophon publications are separate, explicit public projections or copies/, 'encrypted-storage copy must accurately describe explicit publication');
assert.doesNotMatch(storage, /Public pages, public submissions, external chat, and server-side publishing are unavailable/, 'obsolete private-mode limitation copy must not return');
assert.match(storage, /Legacy organization conversion/, 'old conversion path should be clearly labeled as legacy-only');

assert.doesNotMatch(emergency, /AccountDestructionPanel/, 'organization emergency protocol must not embed personal account deletion');
assert.doesNotMatch(emergency, /step === 5/, 'dead post-destruction account-deletion step must not return');
assert.match(emergency, /Personal account deletion is separate/, 'emergency protocol should make the organization/account boundary explicit');

console.log('security page regression checks passed');
