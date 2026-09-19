import { validPublicKey } from './wrappedKeyValidation.js';
import { contentContext, isCiphertext } from '../../../shared/privateContent.js';

const FIELD_TYPES = new Set(['text', 'paragraph', 'choice', 'checkbox', 'date']);

function cleanText(value, max) {
  return String(value || '').slice(0, max);
}

function normalizeField(field, index) {
  const type = FIELD_TYPES.has(String(field?.type || '')) ? String(field.type) : 'text';
  return {
    id: cleanText(field?.id || `field_${index + 1}`, 160) || `field_${index + 1}`,
    type,
    label: cleanText(field?.label || `Question ${index + 1}`, 500),
    required: !!field?.required,
    options: Array.isArray(field?.options)
      ? field.options.slice(0, 100).map((value) => cleanText(value, 500)).filter(Boolean)
      : [],
  };
}

export function normalizePublicDriveForm(form) {
  const fields = Array.isArray(form?.fields) ? form.fields.slice(0, 100).map(normalizeField) : [];
  return {
    type: 'bondfire-form',
    version: 2,
    title: cleanText(form?.title || 'Untitled form', 500),
    description: cleanText(form?.description || '', 10000),
    fields,
  };
}

export async function ensurePublicDriveFormsSchema(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS drive_public_forms (
    file_id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    form_json TEXT NOT NULL,
    recipient_epoch INTEGER NOT NULL,
    recipient_public_key TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS drive_public_forms_org ON drive_public_forms(org_id,updated_at DESC)`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS drive_public_form_responses (
    org_id TEXT NOT NULL,
    file_id TEXT NOT NULL,
    id TEXT NOT NULL,
    epoch INTEGER NOT NULL,
    sender_pub TEXT NOT NULL,
    salt TEXT NOT NULL,
    ciphertext TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY(org_id,file_id,id)
  )`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS drive_public_form_responses_file ON drive_public_form_responses(org_id,file_id,created_at DESC)`).run();
}

export async function hashPublicFormToken(token) {
  const raw = new TextEncoder().encode(String(token || ''));
  const digest = await crypto.subtle.digest('SHA-256', raw);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function publishPublicDriveForm(db, {
  orgId,
  fileId,
  token,
  form,
  recipientEpoch = 1,
  recipientPublicKey,
}) {
  await ensurePublicDriveFormsSchema(db);
  const cleanToken = String(token || '').trim();
  if (cleanToken.length < 12 || cleanToken.length > 512) throw new Error('INVALID_PUBLIC_FORM_TOKEN');
  const epoch = Number(recipientEpoch || 0);
  if (!Number.isSafeInteger(epoch) || epoch < 1) throw new Error('INVALID_PUBLIC_FORM_RECIPIENT');
  if (!validPublicKey(recipientPublicKey)) throw new Error('INVALID_PUBLIC_FORM_RECIPIENT');
  const projection = normalizePublicDriveForm(form);
  const tokenHash = await hashPublicFormToken(cleanToken);
  await db.prepare(`INSERT INTO drive_public_forms(file_id,org_id,token_hash,form_json,recipient_epoch,recipient_public_key,updated_at)
    VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(file_id) DO UPDATE SET
      org_id=excluded.org_id,
      token_hash=excluded.token_hash,
      form_json=excluded.form_json,
      recipient_epoch=excluded.recipient_epoch,
      recipient_public_key=excluded.recipient_public_key,
      updated_at=excluded.updated_at`)
    .bind(fileId, orgId, tokenHash, JSON.stringify(projection), epoch, JSON.stringify(recipientPublicKey), Date.now())
    .run();
  return projection;
}

export async function unpublishPublicDriveForm(db, orgId, fileId) {
  await ensurePublicDriveFormsSchema(db);
  await db.prepare('DELETE FROM drive_public_forms WHERE org_id=? AND file_id=?').bind(orgId, fileId).run();
}

export async function readPublicDriveForm(db, fileId, token) {
  await ensurePublicDriveFormsSchema(db);
  const row = await db.prepare('SELECT * FROM drive_public_forms WHERE file_id=?').bind(fileId).first();
  if (!row) return null;
  const suppliedHash = await hashPublicFormToken(token);
  if (suppliedHash !== String(row.token_hash || '')) return { forbidden: true, orgId: row.org_id };
  let form;
  let recipientPublicKey;
  try {
    form = normalizePublicDriveForm(JSON.parse(String(row.form_json || '{}')));
    recipientPublicKey = JSON.parse(String(row.recipient_public_key || '{}'));
  } catch {
    return null;
  }
  if (!validPublicKey(recipientPublicKey)) return null;
  return {
    orgId: String(row.org_id || ''),
    fileId: String(row.file_id || ''),
    form,
    recipient: {
      orgId: String(row.org_id || ''),
      epoch: Number(row.recipient_epoch || 1),
      publicKey: recipientPublicKey,
    },
    updatedAt: Number(row.updated_at || 0),
  };
}

export async function storePublicDriveFormResponse(db, record, body) {
  await ensurePublicDriveFormsSchema(db);
  const id = String(body?.id || '').trim();
  const epoch = Number(body?.epoch || 0);
  const senderPub = body?.sender_pub;
  const salt = String(body?.salt || '');
  const ciphertext = String(body?.ciphertext || '');
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('INVALID_ENCRYPTED_SUBMISSION');
  if (epoch !== Number(record?.recipient?.epoch || 0)) throw new Error('PUBLIC_FORM_KEY_CHANGED');
  if (!validPublicKey(senderPub)) throw new Error('INVALID_ENCRYPTED_SUBMISSION');
  if (!/^[A-Za-z0-9_-]{22}$/.test(salt)) throw new Error('INVALID_ENCRYPTED_SUBMISSION');
  if (!isCiphertext(ciphertext, contentContext(record.orgId, 'submission/drive-form', id))) throw new Error('INVALID_ENCRYPTED_SUBMISSION');
  if (ciphertext.length > 128 * 1024) throw new Error('SUBMISSION_TOO_LARGE');
  const result = await db.prepare(`INSERT OR IGNORE INTO drive_public_form_responses
    (org_id,file_id,id,epoch,sender_pub,salt,ciphertext,created_at)
    VALUES(?,?,?,?,?,?,?,?)`)
    .bind(record.orgId, record.fileId, id, epoch, JSON.stringify(senderPub), salt, ciphertext, Date.now())
    .run();
  if (Number(result?.meta?.changes || 0) !== 1) throw new Error('SUBMISSION_DUPLICATE');
  return id;
}

export async function deletePublicDriveFormData(db, orgId, fileId) {
  await ensurePublicDriveFormsSchema(db);
  await db.batch([
    db.prepare('DELETE FROM drive_public_forms WHERE org_id=? AND file_id=?').bind(orgId, fileId),
    db.prepare('DELETE FROM drive_public_form_responses WHERE org_id=? AND file_id=?').bind(orgId, fileId),
  ]);
}

export async function listPublicDriveFormResponses(db, orgId, fileId) {
  await ensurePublicDriveFormsSchema(db);
  const rows = await db.prepare(`SELECT id,epoch,sender_pub,salt,ciphertext,created_at
    FROM drive_public_form_responses
    WHERE org_id=? AND file_id=?
    ORDER BY created_at DESC`).bind(orgId, fileId).all();
  return (rows.results || []).map((row) => ({
    id: row.id,
    type: 'drive-form',
    epoch: Number(row.epoch || 0),
    sender_pub: row.sender_pub,
    salt: row.salt,
    ciphertext: row.ciphertext,
    created_at: Number(row.created_at || 0),
  }));
}
