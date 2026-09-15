import { registerDeviceKey } from '../_lib/deviceKeys.js';
import { validPublicKey } from '../_lib/wrappedKeyValidation.js';
import { requireCookieCsrf } from '../_lib/csrf.js';
import { ok, bad } from "../_lib/http.js";
import { requireUser } from "../_lib/auth.js";
import { runAppMigrations } from '../_lib/migrations.js'

export async function onRequestPost({ env, request }) {
  const csrf = requireCookieCsrf(request); if (csrf) return csrf;
  const u = await requireUser({ env, request });
  if (!u.ok) return u.resp;

  const body = await request.json().catch(() => ({}));
  const publicKey = body?.public_key;
  const kid = String(body?.kid || "").trim() || crypto.randomUUID();

  if (!validPublicKey(publicKey)) return bad(400, "INVALID_PUBLIC_KEY");

  // Expect a JWK object, store as JSON.
  let serialized = "";
  try {
    serialized = JSON.stringify(publicKey);
  } catch {
    return bad(400, "INVALID_PUBLIC_KEY");
  }

  await registerDeviceKey(env.BF_DB, String(u.user.sub), publicKey);
  await env.BF_DB.prepare(
    "UPDATE users SET public_key = ? WHERE id = ?"
  ).bind(serialized, String(u.user.sub)).run();

  return ok({ saved: true, kid });
}