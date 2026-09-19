import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { makeSubmissionRecipient, sealSubmission, openSubmission } from '../shared/privateSubmission.js';
import {
  ensurePublicDriveFormsSchema,
  publishPublicDriveForm,
  readPublicDriveForm,
  storePublicDriveFormResponse,
  listPublicDriveFormResponses,
  unpublishPublicDriveForm,
  deletePublicDriveFormData,
} from '../functions/api/_lib/publicDriveForms.js';

const sql = new DatabaseSync(':memory:');
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
  async batch(statements) {
    sql.exec('BEGIN');
    try {
      const out = [];
      for (const statement of statements) out.push(await statement.run());
      sql.exec('COMMIT');
      return out;
    } catch (error) {
      sql.exec('ROLLBACK');
      throw error;
    }
  },
};
await ensurePublicDriveFormsSchema(db);

const orgId = 'org-public-form-test';
const fileId = 'form-file-1';
const token = 'public-form-token-that-is-not-stored-raw';
const recipient = await makeSubmissionRecipient();
const form = {
  type: 'bondfire-form',
  version: 2,
  title: 'Public encrypted form',
  description: 'Visible by design',
  fields: [
    { id: 'name', type: 'text', label: 'Name', required: true, options: [] },
    { id: 'notes', type: 'paragraph', label: 'Notes', required: false, options: [] },
  ],
  responses: [{ id: 'must-not-project', answers: { name: 'SECRET' } }],
  publicShare: { enabled: true, token: 'MUST_NOT_PROJECT' },
};

await publishPublicDriveForm(db, {
  orgId,
  fileId,
  token,
  form,
  recipientEpoch: 1,
  recipientPublicKey: recipient.publicKey,
});
const stored = sql.prepare('SELECT * FROM drive_public_forms WHERE file_id=?').get(fileId);
assert.ok(stored);
assert.notEqual(stored.token_hash, token);
assert.ok(!stored.form_json.includes('MUST_NOT_PROJECT'));
assert.ok(!stored.form_json.includes('SECRET'));
assert.ok(!stored.recipient_public_key.includes('"d":'), 'public projection must not contain recipient private key material');

const wrong = await readPublicDriveForm(db, fileId, 'wrong-token');
assert.equal(wrong?.forbidden, true);
const published = await readPublicDriveForm(db, fileId, token);
assert.equal(published.form.title, form.title);
assert.equal(published.form.fields.length, 2);
assert.deepEqual(published.recipient.publicKey, recipient.publicKey);

const secret = {
  fileId,
  submittedAt: Date.now(),
  source: 'public',
  answers: { name: 'PRIVATE RESPONSE', notes: 'This must stay ciphertext.' },
};
const sealed = await sealSubmission({ orgId, epoch: 1, publicKey: recipient.publicKey }, 'drive-form', secret);
assert.ok(!JSON.stringify(sealed).includes('PRIVATE RESPONSE'));
await storePublicDriveFormResponse(db, published, sealed);
const rows = await listPublicDriveFormResponses(db, orgId, fileId);
assert.equal(rows.length, 1);
assert.ok(!JSON.stringify(rows[0]).includes('PRIVATE RESPONSE'));
assert.deepEqual(await openSubmission(orgId, rows[0], recipient.privateKey), secret);

await assert.rejects(
  storePublicDriveFormResponse(db, published, { ...sealed, id: crypto.randomUUID(), epoch: 2 }),
  /PUBLIC_FORM_KEY_CHANGED/,
);
await unpublishPublicDriveForm(db, orgId, fileId);
assert.equal(await readPublicDriveForm(db, fileId, token), null);
assert.equal((await listPublicDriveFormResponses(db, orgId, fileId)).length, 1, 'unpublishing must not destroy encrypted responses');
await publishPublicDriveForm(db, { orgId, fileId, token, form, recipientEpoch: 1, recipientPublicKey: recipient.publicKey });
await deletePublicDriveFormData(db, orgId, fileId);
assert.equal(await readPublicDriveForm(db, fileId, token), null);
assert.equal((await listPublicDriveFormResponses(db, orgId, fileId)).length, 0, 'deleting a Drive form must remove orphaned encrypted public responses');

const drive = fs.readFileSync(new URL('../src/pages/Drive.jsx', import.meta.url), 'utf8');
const formView = fs.readFileSync(new URL('../src/components/drive/FormFileView.jsx', import.meta.url), 'utf8');
const privateGate = fs.readFileSync(new URL('../functions/api/_lib/privateGate.js', import.meta.url), 'utf8');
const privateClient = fs.readFileSync(new URL('../src/lib/privateClient.js', import.meta.url), 'utf8');
const publicHandler = fs.readFileSync(new URL('../functions/api/public/forms/[id].js', import.meta.url), 'utf8');
const privateStore = fs.readFileSync(new URL('../functions/api/_lib/privateStore.js', import.meta.url), 'utf8');
const legacyFile = fs.readFileSync(new URL('../functions/api/orgs/[orgId]/drive/files/[id].js', import.meta.url), 'utf8');

assert.match(drive, /syncPublicFormProjection/);
assert.match(drive, /drive\/forms-public/);
assert.match(drive, /if \(snapshot\.fileSubtype === "form"\) await syncPublicFormProjection\(snapshot\.id, snapshot\.content\)/);
assert.match(formView, /makeSubmissionRecipient/);
assert.match(formView, /openSubmission/);
assert.match(formView, /encrypted in their browser before Bondfire receives them/);
assert.match(privateGate, /if\(form\) return null/);
assert.match(privateGate, /route==='drive\/shares'\|\|route==='drive\/forms-public'/);
assert.match(privateClient, /tail==='drive\/forms-public'/);
assert.match(publicHandler, /storePublicDriveFormResponse/);
assert.match(publicHandler, /submission\/drive-form/);
assert.match(publicHandler, /script nonce/);
assert.match(publicHandler, /content-security-policy/);
assert.match(publicHandler, /getLegacyPublicForm[\s\S]*getPrivateMode\(env, row\.org_id\)[\s\S]*return null/);
assert.match(privateStore, /deletePublicDriveFormData/);
assert.match(legacyFile, /deletePublicDriveFormData/);

sql.close();
console.log('PASS: private Drive public forms use explicit public projections and encrypted browser submissions');
