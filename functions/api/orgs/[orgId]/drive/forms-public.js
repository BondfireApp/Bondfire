import { getDb, requireOrgRole } from '../../../_lib/auth.js';
import { bad, json } from '../../../_lib/http.js';
import { requireCookieCsrf } from '../../../_lib/csrf.js';
import { ensureDriveSchema } from '../../../_lib/drive.js';
import { ensurePrivateSchema, getPrivateMode } from '../../../_lib/privateStore.js';
import { driveAccessForUser } from '../../../_lib/driveShares.js';
import {
  ensurePublicDriveFormsSchema,
  publishPublicDriveForm,
  unpublishPublicDriveForm,
  listPublicDriveFormResponses,
} from '../../../_lib/publicDriveForms.js';

async function driveFileAccess({ env, request, orgId, userId, fileId, writing }) {
  const db = getDb(env);
  const privateMode = await getPrivateMode(env, orgId);
  if (privateMode) {
    if (privateMode.state !== 'enabled') return { ok: false, response: bad(409, 'PRIVATE_MODE_NOT_READY') };
    await ensurePrivateSchema(db);
    const file = await db.prepare("SELECT id FROM org_private_records WHERE org_id=? AND kind='drive/files' AND id=?")
      .bind(orgId, fileId).first();
    if (!file) return { ok: false, response: bad(404, 'NOT_FOUND') };
    const access = await driveAccessForUser(db, orgId, 'drive/files', fileId, userId);
    if (!access.allowed) return { ok: false, response: bad(403, 'DRIVE_SHARE_ACCESS_DENIED') };
    if (writing && access.restricted && access.permission === 'view') return { ok: false, response: bad(403, 'DRIVE_SHARE_READ_ONLY') };
    return { ok: true, privateMode: true };
  }

  await ensureDriveSchema(env);
  const file = await db.prepare('SELECT id FROM drive_files WHERE org_id=? AND id=?').bind(orgId, fileId).first();
  if (!file) return { ok: false, response: bad(404, 'NOT_FOUND') };
  return { ok: true, privateMode: false };
}

export async function onRequest({ env, request, params }) {
  const orgId = String(params.orgId || '');
  const db = getDb(env);
  if (!db) return bad(500, 'NO_DB_BINDING');
  await ensurePublicDriveFormsSchema(db);

  if (request.method === 'GET') {
    const gate = await requireOrgRole({ env, request, orgId, minRole: 'viewer' });
    if (!gate.ok) return gate.resp;
    const fileId = String(new URL(request.url).searchParams.get('fileId') || '').trim();
    if (!fileId) return bad(400, 'MISSING_FILE_ID');
    const access = await driveFileAccess({ env, request, orgId, userId: gate.user.sub, fileId, writing: false });
    if (!access.ok) return access.response;
    return json({ ok: true, responses: await listPublicDriveFormResponses(db, orgId, fileId) });
  }

  if (request.method !== 'POST') return bad(405, 'METHOD_NOT_ALLOWED');
  const gate = await requireOrgRole({ env, request, orgId, minRole: 'member' });
  if (!gate.ok) return gate.resp;
  const csrf = requireCookieCsrf(request);
  if (csrf) return csrf;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return bad(400, 'INVALID_PUBLIC_FORM_REQUEST');
  if (Object.keys(body).some((key) => !['fileId', 'enabled', 'token', 'form', 'recipientEpoch', 'recipientPublicKey'].includes(key))) {
    return bad(400, 'INVALID_PUBLIC_FORM_REQUEST');
  }
  const fileId = String(body.fileId || '').trim();
  if (!fileId) return bad(400, 'MISSING_FILE_ID');
  const access = await driveFileAccess({ env, request, orgId, userId: gate.user.sub, fileId, writing: true });
  if (!access.ok) return access.response;

  if (!body.enabled) {
    await unpublishPublicDriveForm(db, orgId, fileId);
    return json({ ok: true, enabled: false });
  }

  try {
    const form = await publishPublicDriveForm(db, {
      orgId,
      fileId,
      token: body.token,
      form: body.form,
      recipientEpoch: body.recipientEpoch,
      recipientPublicKey: body.recipientPublicKey,
    });
    return json({ ok: true, enabled: true, form });
  } catch (error) {
    const code = String(error?.message || 'INVALID_PUBLIC_FORM_REQUEST');
    return bad(code === 'INVALID_PUBLIC_FORM_TOKEN' || code === 'INVALID_PUBLIC_FORM_RECIPIENT' ? 400 : 400, code);
  }
}
