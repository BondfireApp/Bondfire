import { ok, err } from "../../../_lib/http.js";
import { requireOrgRole } from "../../../_lib/auth.js";
import {
  readNewsletterDeliverySettings,
  writeNewsletterDeliverySettings,
} from "../../../_lib/newsletterDelivery.js";
import { newsletterIdentity } from "../../../_lib/newsletterEmail.js";

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
    },
  });
}
