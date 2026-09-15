import { createPrivateOrg } from '../_lib/privateCreate.js';
import { bad } from "../_lib/http.js";
import { getDb, requireUser } from "../_lib/auth.js";

export async function onRequestPost({ request, env }) {
  if (!env.JWT_SECRET) return bad(500, "JWT_SECRET_MISSING");

  const u = await requireUser({ env, request });
  if (!u.ok) return u.resp;

  const meId = u.user?.sub || u.user?.id || u.user?.userId;
  if (!meId) return bad(401, "UNAUTHORIZED");

  const db = getDb(env);
  if (!db) return bad(500, "NO_DB_BINDING");

  const body = await request.json().catch(() => ({}));
  if (body.private_mode === true) return createPrivateOrg({ db, request, userId: meId, body });
  return bad(400, 'ENCRYPTED_ORGANIZATION_REQUIRED');
}
