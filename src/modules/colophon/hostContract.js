const ROLE_CAPABILITIES = Object.freeze({
  viewer: Object.freeze([
    "content:read",
    "media:read",
  ]),
  member: Object.freeze([
    "content:read",
    "content:write",
    "media:read",
    "media:write",
  ]),
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

export function colophonCapabilitiesForRole(role) {
  return [...(ROLE_CAPABILITIES[String(role || "").toLowerCase()] || ROLE_CAPABILITIES.viewer)];
}

export function createColophonHostContext({ orgId, role, user } = {}) {
  const normalizedOrgId = String(orgId || "").trim();
  if (!normalizedOrgId) throw new Error("Colophon requires the current Bondfire organization.");

  return Object.freeze({
    mode: "bondfire",
    orgId: normalizedOrgId,
    role: String(role || "viewer").toLowerCase(),
    user: user || null,
    capabilities: colophonCapabilitiesForRole(role),
    apiBase: `/api/orgs/${encodeURIComponent(normalizedOrgId)}/colophon`,
    routeBase: `/org/${encodeURIComponent(normalizedOrgId)}/colophon`,
    standalone: false,
  });
}

export function colophonApiPath(host, path = "") {
  const suffix = String(path || "").replace(/^\/+/, "");
  return suffix ? `${host.apiBase}/${suffix}` : host.apiBase;
}
