import { json, bad } from "../../_lib/http.js";
import { requireUser } from "../../_lib/auth.js";

export async function onRequestPost({ env, request }) {
  const u = await requireUser({ env, request });
  if (!u.ok) return u.resp;

  const body = await request.json().catch(() => ({}));
  const key = String(body.key || "");
  if (!key) return bad(400, "MISSING_KEY");

  await env.BF_E2EE.put(`u:${u.user.sub}:${key}`, JSON.stringify(body.value ?? null));
  return json({ ok: true });
}
