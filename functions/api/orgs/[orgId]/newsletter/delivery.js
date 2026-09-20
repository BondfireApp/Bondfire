import { ok, err } from "../../../_lib/http.js";
import { requireOrgRole } from "../../../_lib/auth.js";
import {
  readNewsletterDeliverySettings,
  writeNewsletterDeliverySettings,
} from "../../../_lib/newsletterDelivery.js";
import { newsletterIdentity } from "../../../_lib/newsletterEmail.js";
import { getPublicCfg } from "../../../_lib/publicPageStore.js";
import { getDB } from "../../../_bf.js";

function runtimeDiagnostics(env, request) {
  let requestUrl = null;
  try {
    requestUrl = new URL(request.url);
  } catch {
    requestUrl = null;
  }

  const hasOwn = (key) => Object.prototype.hasOwnProperty.call(env || {}, key);
  const nonEmpty = (key) => !!String(env?.[key] || "").trim();

  return {
    request_hostname: requestUrl?.hostname || "",
    request_origin: requestUrl?.origin || "",
    cf_ray: String(request.headers.get("cf-ray") || ""),
    cf_colo: String(request?.cf?.colo || ""),
    resend_api_key_binding_present: hasOwn("RESEND_API_KEY"),
    resend_api_key_nonempty: nonEmpty("RESEND_API_KEY"),
    jwt_secret_binding_present: hasOwn("JWT_SECRET"),
    d1_binding_present: hasOwn("DB") || hasOwn("BF_DB"),
    bf_public_binding_present: hasOwn("BF_PUBLIC"),
    cf_pages: nonEmpty("CF_PAGES") ? String(env.CF_PAGES) : "",
    cf_pages_branch: String(env?.CF_PAGES_BRANCH || ""),
    cf_pages_commit_sha: String(env?.CF_PAGES_COMMIT_SHA || ""),
    cf_pages_url: String(env?.CF_PAGES_URL || ""),
  };
}

async function publicNewsletterBlurb(env, orgId) {
  const cfg = await getPublicCfg(env, orgId).catch(() => ({}));
  const current = String(cfg?.newsletter_blurb || "").trim();
  if (current) return current;

  const db = getDB(env);
  if (!db?.prepare) return "";
  try {
    const row = await db.prepare(
      "SELECT blurb FROM newsletter_settings WHERE org_id = ? LIMIT 1"
    ).bind(orgId).first();
    return String(row?.blurb || "").trim();
  } catch {
    return "";
  }
}

export async function onRequestGet({ env, request, params }) {
  const orgId = String(params?.orgId || "").trim();
  if (!orgId) return err(400, "BAD_ORG_ID");

  const gate = await requireOrgRole({ env, request, orgId, minRole: "member" });
  if (!gate.ok) return gate.resp;

  const delivery = await readNewsletterDeliverySettings(env, orgId);
  let identity = null;
  try {
    identity = await newsletterIdentity(env, orgId, request.url);
  } catch {
    identity = null;
  }

  return ok({
    delivery: {
      ...(delivery || {}),
      provider: "resend",
      resend_configured: !!String(env?.RESEND_API_KEY || "").trim(),
      effective_from: identity?.from || "",
      effective_sender_email: identity?.senderEmail || "",
      public_blurb: await publicNewsletterBlurb(env, orgId),
      runtime: runtimeDiagnostics(env, request),
    },
  });
}

export async function onRequestPut({ env, request, params }) {
  const orgId = String(params?.orgId || "").trim();
  if (!orgId) return err(400, "BAD_ORG_ID");

  const gate = await requireOrgRole({ env, request, orgId, minRole: "admin" });
  if (!gate.ok) return gate.resp;

  const body = await request.json().catch(() => ({}));
  let delivery;
  try {
    delivery = await writeNewsletterDeliverySettings(env, orgId, body);
  } catch (error) {
    return err(
      error?.code === "DB_NOT_CONFIGURED" ? 500 : 400,
      String(error?.code || error?.message || "NEWSLETTER_DELIVERY_SETTINGS_FAILED")
    );
  }

  let identity = null;
  try {
    identity = await newsletterIdentity(env, orgId, request.url);
  } catch {
    identity = null;
  }

  return ok({
    delivery: {
      ...delivery,
      provider: "resend",
      resend_configured: !!String(env?.RESEND_API_KEY || "").trim(),
      effective_from: identity?.from || "",
      effective_sender_email: identity?.senderEmail || "",
      runtime: runtimeDiagnostics(env, request),
    },
  });
}
