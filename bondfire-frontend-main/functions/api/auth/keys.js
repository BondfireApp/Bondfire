import { registerDeviceKey } from '../_lib/deviceKeys.js';
import { validPublicKey } from '../_lib/wrappedKeyValidation.js';
import { requireCookieCsrf } from '../_lib/csrf.js';
import { json, bad, readJSON, requireMethod } from "../_lib/http.js";
import { getDb, requireUser } from "../_lib/auth.js";

export async function onRequestGet({ env, request }) {
  const auth = await requireUser({ env, request });
  if (!auth.ok) return auth.resp;
  const userId = auth.user?.sub;
  if (!userId) return bad(401, "UNAUTHORIZED");
  const db = getDb(env);
  const row = await db.prepare("SELECT public_key FROM users WHERE id = ?").bind(userId).first();
  return json({ ok: true, public_key: row?.public_key || null });
}

export async function onRequestPost({ env, request }) {
  const csrf = requireCookieCsrf(request); if (csrf) return csrf;
  const auth = await requireUser({ env, request });
  if (!auth.ok) return auth.resp;
  const userId = auth.user?.sub;
  if (!userId) return bad(401, "UNAUTHORIZED");
  const methodError = requireMethod(request, "POST");
  if (methodError) return methodError;
  const body = await readJSON(request);
  const publicKey = String(body?.public_key || "");
  if (!publicKey) return bad(400, "MISSING_PUBLIC_KEY");
  try { if (!validPublicKey(JSON.parse(publicKey))) return bad(400, "INVALID_PUBLIC_KEY"); }
  catch { return bad(400, "INVALID_PUBLIC_KEY"); }

  const db = getDb(env);
  await registerDeviceKey(db, userId, publicKey);
  await db.prepare("UPDATE users SET public_key = ? WHERE id = ?").bind(publicKey, userId).run();
  return json({ ok: true });
}
