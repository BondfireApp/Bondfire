import { requireOrgRole } from "../../../_lib/auth.js";
import { bad, ok, uuid } from "../../../_lib/http.js";
import { getPublicCfg, setPublicCfg } from "../../../_lib/publicPageStore.js";
import { normalizeConnectedPublication } from "../../../_lib/publicSurface.js";

function organizationPageState(cfg) {
  const slug = String(cfg?.slug || "").trim();
  return {
    slug,
    available: Boolean(cfg?.enabled && slug),
    path: slug ? `/#/public/${encodeURIComponent(slug)}` : "",
  };
}

async function requireAdmin(context) {
  return requireOrgRole({
    env: context.env,
    request: context.request,
    orgId: context.params.orgId,
    minRole: "admin",
  });
}

export async function onRequestGet(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.resp;

  const cfg = await getPublicCfg(context.env, context.params.orgId);
  return ok({
    connected_publication: normalizeConnectedPublication(cfg?.connected_publication),
    organization_page: organizationPageState(cfg),
  });
}

export async function onRequestPut(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.resp;

  const body = await context.request.json().catch(() => ({}));
  const requested = body?.connected_publication;
  if (!requested || typeof requested !== "object" || Array.isArray(requested)) {
    return bad(400, "CONNECTED_PUBLICATION_REQUIRED");
  }

  const cfg = await getPublicCfg(context.env, context.params.orgId);
  const existing = normalizeConnectedPublication(cfg?.connected_publication);
  const normalized = normalizeConnectedPublication({
    ...requested,
    publication_id: requested.publication_id || existing?.publication_id || uuid(),
  });

  if (!normalized?.url) return bad(400, "INVALID_PUBLICATION_URL");

  await setPublicCfg(context.env, context.params.orgId, {
    ...cfg,
    connected_publication: normalized,
  });

  return ok({
    connected_publication: normalized,
    organization_page: organizationPageState(cfg),
  });
}

export async function onRequestDelete(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.resp;

  const cfg = await getPublicCfg(context.env, context.params.orgId);
  const next = { ...cfg };
  delete next.connected_publication;
  await setPublicCfg(context.env, context.params.orgId, next);

  return ok({
    connected_publication: null,
    organization_page: organizationPageState(next),
  });
}
