import { bad, json } from "../../../_lib/http.js";
import { requireOrgRole } from "../../../_lib/auth.js";
import { isOrgModuleEnabled } from "../../../_lib/orgModules.js";

const ROLE_CAPABILITIES = Object.freeze({
  viewer: Object.freeze(["content:read", "media:read"]),
  member: Object.freeze(["content:read", "content:write", "media:read", "media:write"]),
  admin: Object.freeze([
    "content:read",
    "content:write",
    "content:publish",
    "media:read",
    "media:write",
    "publishing:write",
    "analytics:view",
    "site:manage",
    "system:view",
  ]),
  owner: Object.freeze(["*"]),
});

function capabilitiesForRole(role) {
  return [...(ROLE_CAPABILITIES[String(role || "").toLowerCase()] || ROLE_CAPABILITIES.viewer)];
}

export async function onRequestGet({ env, request, params }) {
  const orgId = String(params?.orgId || "").trim();
  if (!orgId) return bad(400, "MISSING_ORG_ID");

  const auth = await requireOrgRole({ env, request, orgId, minRole: "viewer" });
  if (!auth.ok) return auth.resp;

  if (!(await isOrgModuleEnabled(env, orgId, "publishing-colophon"))) {
    return bad(403, "MODULE_DISABLED", { moduleId: "publishing-colophon" });
  }

  const user = auth.user || {};
  const role = String(auth.role || "viewer").toLowerCase();

  return json({
    ok: true,
    authenticated: true,
    mode: "bondfire",
    orgId,
    role,
    capabilities: capabilitiesForRole(role),
    user: {
      id: user.sub || user.id || user.userId || null,
      email: user.email || "",
      displayName: user.name || user.displayName || user.email || role,
    },
  });
}
