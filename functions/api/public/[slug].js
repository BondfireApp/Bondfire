import { projectOrganizationPageConfig } from "../_lib/publicSurface.js";
import { listPublicSiteDomains, publicDomainScope } from "../_lib/publicSiteDomains.js";

function riseupSubscribeUrl(address) {
  const value = String(address || "").trim().toLowerCase();
  const match = value.match(/^([^@\s]+)@lists\.riseup\.net$/i);
  return match ? `https://lists.riseup.net/www/subscribe/${encodeURIComponent(match[1])}` : "";
}

function publicationFromDomain(domain, fallback = null) {
  if (!domain?.hostname) return fallback;
  return {
    ...(fallback || {}),
    available: true,
    url: `https://${domain.hostname}`,
    publication_name: fallback?.publication_name || fallback?.name || "Publication",
  };
}

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

  const projected = projectOrganizationPageConfig(cfg);
  const db = env?.BF_DB || env?.DB || null;
  let newsletter = null;
  if (db?.prepare) {
    try {
      if (projected.newsletter_enabled) {
        const newsletterRow = await db.prepare(
          "SELECT enabled, list_address, blurb FROM newsletter_settings WHERE org_id = ? LIMIT 1"
        ).bind(orgId).first();

        if (newsletterRow) {
          newsletter = {
            enabled: newsletterRow.enabled !== 0,
            blurb: String(newsletterRow.blurb || "").trim(),
            subscribe_url: riseupSubscribeUrl(newsletterRow.list_address),
          };
        }
      }
    } catch (error) {
      console.warn("newsletter public metadata lookup failed", error);
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

  return Response.json({
    ok: true,
    public: projected,
    newsletter,
    orgId,
  });
}
