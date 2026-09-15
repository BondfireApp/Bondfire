import { projectOrganizationPageConfig } from "../_lib/publicSurface.js";

export async function onRequestGet({ env, params }) {
  const slug = params.slug;

  const orgId = await env.BF_PUBLIC.get(`slug:${slug}`);
  if (!orgId) {
    return Response.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  }

  const cfgRaw = await env.BF_PUBLIC.get(`org:${orgId}`);
  const cfg = cfgRaw ? JSON.parse(cfgRaw) : null;
  if (!cfg || !cfg.enabled) {
    return Response.json({ ok: false, error: "NOT_PUBLIC" }, { status: 404 });
  }

  return Response.json({
    ok: true,
    public: projectOrganizationPageConfig(cfg),
    orgId,
  });
}
