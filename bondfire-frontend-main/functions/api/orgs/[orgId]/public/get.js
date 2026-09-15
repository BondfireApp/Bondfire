import { getPublicCfg } from "../../../_lib/publicPageStore.js";
import { normalizeConnectedPublication } from "../../../_lib/publicSurface.js";
import { bad, ok } from "../../../_lib/http.js";

function authOk(env, request) {
  if (env.BF_WRITE_LOCKED === "true") {
    const auth = request.headers.get("authorization") || "";
    return auth.startsWith("Bearer ");
  }
  return true;
}

export async function onRequestGet({ env, request, params }) {
  if (!authOk(env, request)) {
    return bad(401, "UNAUTHORIZED");
  }

  const orgId = params.orgId;
  const cfg = await getPublicCfg(env, orgId);

  const cleaned = {
    enabled: !!cfg?.enabled,
    newsletter_enabled: !!cfg?.newsletter_enabled,
    pledges_enabled: cfg?.pledges_enabled !== false,
    show_action_strip: cfg?.show_action_strip !== false,
    show_needs: cfg?.show_needs !== false,
    show_meetings: cfg?.show_meetings !== false,
    show_what_we_do: cfg?.show_what_we_do !== false,
    show_get_involved: !!cfg?.show_get_involved,
    show_newsletter_card: !!cfg?.show_newsletter_card,
    show_website_button: !!cfg?.show_website_button,
    slug: String(cfg?.slug || ""),
    title: String(cfg?.title || ""),
    location: String(cfg?.location || ""),
    about: String(cfg?.about || ""),
    accent_color: String(cfg?.accent_color || "#6d5efc"),
    theme_mode: String(cfg?.theme_mode || "light"),
    website_link: cfg?.website_link || null,
    meeting_rsvp_url: String(cfg?.meeting_rsvp_url || ""),
    what_we_do: Array.isArray(cfg?.what_we_do) ? cfg.what_we_do : [],
    primary_actions: Array.isArray(cfg?.primary_actions) ? cfg.primary_actions : [],
    get_involved_links: Array.isArray(cfg?.get_involved_links) ? cfg.get_involved_links : [],
    connected_publication: normalizeConnectedPublication(cfg?.connected_publication),
  };

  return ok({ public: cleaned });
}
