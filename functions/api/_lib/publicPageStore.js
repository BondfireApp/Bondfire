export function slugify(input) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export async function uniqueSlug(env, base, orgId) {
  const cleanBase = slugify(base || "org") || "org";
  let trySlug = cleanBase;
  let n = 0;

  while (true) {
    const existingOrgId = await env.BF_PUBLIC.get(`slug:${trySlug}`);
    if (!existingOrgId || existingOrgId === orgId) return trySlug;
    n += 1;
    trySlug = `${cleanBase}-${n}`;
  }
}


export async function getPublicCfg(env, orgId) {
  const raw = await env.BF_PUBLIC.get(`org:${orgId}`);
  return raw ? JSON.parse(raw) : {};
}

export async function setPublicCfg(env, orgId, cfg) {
  await env.BF_PUBLIC.put(`org:${orgId}`, JSON.stringify(cfg));
}

export async function setSlugMapping(env, slug, orgId) {
  const s = String(slug || "").trim().toLowerCase();
  await env.BF_PUBLIC.put(`slug:${s}`, orgId);
}

export async function removeSlugMapping(env, slug) {
  const s = String(slug || "").trim().toLowerCase();
  await env.BF_PUBLIC.delete(`slug:${s}`);
}


export async function getOrgIdBySlug(env, slug) {
  const s = String(slug || "").trim().toLowerCase();
  if (!s) return null;
  const orgId = await env.BF_PUBLIC.get(`slug:${s}`);
  return orgId || null;
}

// Resolve a public slug to an orgId (or null)
export async function resolveSlug(env, slug) {
  const s = String(slug || "").trim().toLowerCase();
  if (!s) return null;

  // matches your slug mapping keys used elsewhere: slug:<slug> => orgId
  const orgId = await env.BF_PUBLIC.get(`slug:${s}`);
  return orgId || null;
}

