import { projectOrganizationPageConfig } from "../_lib/publicSurface.js";
import { listPublicSiteDomains, publicDomainScope } from "../_lib/publicSiteDomains.js";
import { getPrivateMode } from "../_lib/privateStore.js";
import { requireOrgRole } from "../_lib/auth.js";

function publicationFromDomain(domain, fallback = null) {
  if (!domain?.hostname) return fallback;
  return {
    ...(fallback || {}),
    available: true,
    url: `https://${domain.hostname}`,
    publication_name: fallback?.publication_name || fallback?.name || "Publication",
  };
}

export async function onRequestGet({ env, request, params }) {
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

  const projected = projectOrganizationPageConfig(cfg);
  const db = env?.BF_DB || env?.DB || null;
  let newsletter = null;
  let privateMode = false;

  try {
    privateMode = (await getPrivateMode(env, orgId))?.state === "enabled";
  } catch {
    privateMode = false;
  }
  if (db?.prepare) {
    try {
      if (projected.newsletter_enabled) {
        const newsletterRow = await db.prepare(
          "SELECT enabled, blurb FROM newsletter_settings WHERE org_id = ? LIMIT 1"
        ).bind(orgId).first();

        if (newsletterRow) {
          newsletter = {
            enabled: newsletterRow.enabled !== 0,
            blurb: String(projected.newsletter_blurb || newsletterRow.blurb || "").trim(),
            delivery: "resend",
            confirmation_email: true,
          };
        }
      }
    } catch (error) {
      console.warn("newsletter public metadata lookup failed", error);
    }

    if (projected.newsletter_enabled && !newsletter) {
      newsletter = {
        enabled: true,
        blurb: String(projected.newsletter_blurb || "").trim(),
        delivery: "resend",
        confirmation_email: true,
      };
    }

    try {
      const publicationDomains = await listPublicSiteDomains(db, publicDomainScope(orgId, "publication"));
      const primary = publicationDomains.find((domain) => domain.isPrimary && domain.verificationStatus === "verified")
        || publicationDomains.find((domain) => domain.verificationStatus === "verified")
        || null;
      if (primary) projected.connected_publication = publicationFromDomain(primary, projected.connected_publication);
    } catch (error) {
      console.warn("publication domain lookup failed", error);
    }
  }

  let editor = null;
  try {
    const auth = await requireOrgRole({ env, request, orgId, minRole: "admin" });
    if (auth.ok) editor = { allowed: true, orgId, role: auth.role };
  } catch {
    // Public visitors must still receive the public page when auth state is unavailable.
  }

  return Response.json({
    ok: true,
    editor,
    public: projected,
    newsletter,
    private_mode: privateMode,
    orgId,
  });
}
