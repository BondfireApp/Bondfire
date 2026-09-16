import { api } from "../utils/api.js";

const PRIVATE_PLACEHOLDER = "Private organization";

function cleanName(value) {
  return String(value || "").trim();
}

export function isPrivateOrgPlaceholder(value) {
  return cleanName(value).toLowerCase() === PRIVATE_PLACEHOLDER.toLowerCase();
}

export function readCachedOrgName(orgId) {
  const id = String(orgId || "").trim();
  if (!id) return "";
  try {
    const settings = JSON.parse(localStorage.getItem(`bf_org_settings_${id}`) || "{}");
    const orgs = JSON.parse(localStorage.getItem("bf_orgs") || "[]");
    const org = Array.isArray(orgs) ? orgs.find((item) => String(item?.id) === id) : null;
    return cleanName(settings?.name || org?.name);
  } catch {
    return "";
  }
}

export function cacheOrgName(orgId, name) {
  const id = String(orgId || "").trim();
  const nextName = cleanName(name);
  if (!id || !nextName || isPrivateOrgPlaceholder(nextName)) return nextName;

  try {
    const key = `bf_org_settings_${id}`;
    const settings = JSON.parse(localStorage.getItem(key) || "{}");
    localStorage.setItem(key, JSON.stringify({ ...settings, name: nextName }));
  } catch {}

  try {
    const orgs = JSON.parse(localStorage.getItem("bf_orgs") || "[]");
    if (Array.isArray(orgs)) {
      localStorage.setItem(
        "bf_orgs",
        JSON.stringify(orgs.map((org) => String(org?.id) === id ? { ...org, name: nextName } : org))
      );
    }
  } catch {}

  try {
    window.dispatchEvent(new CustomEvent("bf:org_settings_changed", { detail: { orgId: id, name: nextName } }));
    window.dispatchEvent(new CustomEvent("bf:org_identity_changed", { detail: { orgId: id, name: nextName } }));
  } catch {}

  return nextName;
}

export async function loadOrgIdentity(orgId, { force = false } = {}) {
  const id = String(orgId || "").trim();
  if (!id) return { id: "", name: "" };

  const cached = readCachedOrgName(id);
  if (!force && cached && !isPrivateOrgPlaceholder(cached)) return { id, name: cached };

  const result = await api(`/api/orgs/${encodeURIComponent(id)}/organization`, { method: "GET" });
  const name = cleanName(result?.organization?.name);
  if (name) cacheOrgName(id, name);
  return { id, name: name || cached };
}

export async function hydrateOrgList(orgs) {
  const list = Array.isArray(orgs) ? orgs : [];
  return Promise.all(list.map(async (org) => {
    const currentName = cleanName(org?.name);
    if (currentName && !isPrivateOrgPlaceholder(currentName)) return org;
    try {
      const identity = await loadOrgIdentity(org?.id);
      return identity.name ? { ...org, name: identity.name } : org;
    } catch {
      return org;
    }
  }));
}
