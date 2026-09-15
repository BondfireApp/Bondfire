import { json, bad } from "../../_lib/http.js";
import { requireUser } from "../../_lib/auth.js";

export async function onRequestGet({ env, request }) {
  const u = await requireUser({ env, request });
  if (!u.ok) return u.resp;

  const url = new URL(request.url);
  const key = url.searchParams.get("key");
  if (!key) return bad(400, "MISSING_KEY");

  const v = await env.BF_E2EE.get(`u:${u.user.sub}:${key}`);
  return json({ ok: true, value: v ? JSON.parse(v) : null });
}
