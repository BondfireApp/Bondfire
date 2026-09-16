import { json } from "../../../_lib/http.js";
import { requireOrgRole } from "../../../_lib/auth.js";
import { isOrgModuleEnabled } from "../../../_lib/orgModules.js";
import { privateRequestGate } from "../../../_lib/privateGate.js";
import {
  createColophonGatewayRequest,
  createColophonScopedEnv,
  ensureColophonGatewayActor,
} from "../../../_lib/colophonScopedRuntime.js";

import * as accountSecurity from "../../../../../node_modules/colophon/functions/api/account-security.js";
import * as analyticsCollect from "../../../../../node_modules/colophon/functions/api/analytics/collect.js";
import * as analyticsReport from "../../../../../node_modules/colophon/functions/api/analytics/report.js";
import * as audioLabMedia from "../../../../../node_modules/colophon/functions/api/audiolab/media.js";
import * as audioLabTranscribe from "../../../../../node_modules/colophon/functions/api/audiolab/transcribe.js";
import * as auditLog from "../../../../../node_modules/colophon/functions/api/audit-log.js";
import * as backupStatus from "../../../../../node_modules/colophon/functions/api/backup-status.js";
import * as campaignContributorAuth from "../../../../../node_modules/colophon/functions/api/campaign-contributor-auth.js";
import * as campaignContributorMedia from "../../../../../node_modules/colophon/functions/api/campaign-contributor-media.js";
import * as campaignCorrespondence from "../../../../../node_modules/colophon/functions/api/campaign-correspondence.js";
import * as campaignCoverage from "../../../../../node_modules/colophon/functions/api/campaign-coverage.js";
import * as campaignInstagramAuth from "../../../../../node_modules/colophon/functions/api/campaign-instagram-auth.js";
import * as campaignInstagramCallback from "../../../../../node_modules/colophon/functions/api/campaign-instagram-callback.js";
import * as campaignInstagramSync from "../../../../../node_modules/colophon/functions/api/campaign-instagram-sync.js";
import * as campaignMonitor from "../../../../../node_modules/colophon/functions/api/campaign-monitor.js";
import * as campaignRevisions from "../../../../../node_modules/colophon/functions/api/campaign-revisions.js";
import * as campaignSignatures from "../../../../../node_modules/colophon/functions/api/campaign-signatures.js";
import * as campaignSocial from "../../../../../node_modules/colophon/functions/api/campaign-social.js";
import * as campaigns from "../../../../../node_modules/colophon/functions/api/campaigns.js";
import * as collections from "../../../../../node_modules/colophon/functions/api/collections.js";
import * as courses from "../../../../../node_modules/colophon/functions/api/courses.js";
import * as editorRoles from "../../../../../node_modules/colophon/functions/api/editor-roles.js";
import * as editorialComments from "../../../../../node_modules/colophon/functions/api/editorial-comments.js";
import * as editorialReview from "../../../../../node_modules/colophon/functions/api/editorial-review.js";
import * as feedManifest from "../../../../../node_modules/colophon/functions/api/feed-manifest.js";
import * as feedSettings from "../../../../../node_modules/colophon/functions/api/feed-settings.js";
import * as investigationRevisions from "../../../../../node_modules/colophon/functions/api/investigation-revisions.js";
import * as investigations from "../../../../../node_modules/colophon/functions/api/investigations.js";
import * as mediaAssets from "../../../../../node_modules/colophon/functions/api/media-assets.js";
import * as mediaFiles from "../../../../../node_modules/colophon/functions/api/media/files.js";
import * as nativeContent from "../../../../../node_modules/colophon/functions/api/native-content.js";
import * as nativeContentRevisions from "../../../../../node_modules/colophon/functions/api/native-content-revisions.js";
import * as nativeContentSources from "../../../../../node_modules/colophon/functions/api/native-content-sources.js";
import * as nativeContentTaxonomy from "../../../../../node_modules/colophon/functions/api/native-content-taxonomy.js";
import * as nativeTranslations from "../../../../../node_modules/colophon/functions/api/native-translations.js";
import * as podcastHosting from "../../../../../node_modules/colophon/functions/api/podcast-hosting.js";
import * as podcastImport from "../../../../../node_modules/colophon/functions/api/podcast-import.js";
import * as podcastMedia from "../../../../../node_modules/colophon/functions/api/podcast-media.js";
import * as podcastSettings from "../../../../../node_modules/colophon/functions/api/podcast-settings.js";
import * as podcastSourceRefresh from "../../../../../node_modules/colophon/functions/api/podcast-source-refresh.js";
import * as publicSiteConfig from "../../../../../node_modules/colophon/functions/api/public-site-config.js";
import * as publications from "../../../../../node_modules/colophon/functions/api/publications.js";
import * as publishingSetup from "../../../../../node_modules/colophon/functions/api/publishing-setup.js";
import * as siteHealth from "../../../../../node_modules/colophon/functions/api/site-health.js";
import * as sites from "../../../../../node_modules/colophon/functions/api/sites.js";
import * as taxonomy from "../../../../../node_modules/colophon/functions/api/taxonomy.js";
import * as users from "../../../../../node_modules/colophon/functions/api/users.js";

const HANDLERS = Object.freeze({
  "account-security": accountSecurity,
  "analytics/collect": analyticsCollect,
  "analytics/report": analyticsReport,
  "audiolab/media": audioLabMedia,
  "audiolab/transcribe": audioLabTranscribe,
  "audit-log": auditLog,
  "backup-status": backupStatus,
  "campaign-contributor-auth": campaignContributorAuth,
  "campaign-contributor-media": campaignContributorMedia,
  "campaign-correspondence": campaignCorrespondence,
  "campaign-coverage": campaignCoverage,
  "campaign-instagram-auth": campaignInstagramAuth,
  "campaign-instagram-callback": campaignInstagramCallback,
  "campaign-instagram-sync": campaignInstagramSync,
  "campaign-monitor": campaignMonitor,
  "campaign-revisions": campaignRevisions,
  "campaign-signatures": campaignSignatures,
  "campaign-social": campaignSocial,
  campaigns,
  collections,
  courses,
  "editor-roles": editorRoles,
  "editorial-comments": editorialComments,
  "editorial-review": editorialReview,
  "feed-manifest": feedManifest,
  "feed-settings": feedSettings,
  "investigation-revisions": investigationRevisions,
  investigations,
  "media-assets": mediaAssets,
  "media/files": mediaFiles,
  "native-content": nativeContent,
  "native-content-revisions": nativeContentRevisions,
  "native-content-sources": nativeContentSources,
  "native-content-taxonomy": nativeContentTaxonomy,
  "native-translations": nativeTranslations,
  "podcast-hosting": podcastHosting,
  "podcast-import": podcastImport,
  "podcast-media": podcastMedia,
  "podcast-settings": podcastSettings,
  "podcast-source-refresh": podcastSourceRefresh,
  "public-site-config": publicSiteConfig,
  publications,
  "publishing-setup": publishingSetup,
  "site-health": siteHealth,
  sites,
  taxonomy,
  users,
});

const ADMIN_READ_PREFIXES = Object.freeze([
  "account-security",
  "analytics/report",
  "audit-log",
  "backup-status",
  "editor-roles",
  "site-health",
  "sites",
  "users",
]);

const MEMBER_WRITE_PREFIXES = Object.freeze([
  "analytics/collect",
  "audiolab/media",
  "editorial-comments",
  "media-assets",
  "media/files",
  "native-content",
  "native-content-revisions",
  "native-content-sources",
  "native-content-taxonomy",
  "podcast-media",
]);

function normalizedPath(params) {
  const raw = params?.path;
  if (Array.isArray(raw)) return raw.map(String).join("/").replace(/^\/+|\/+$/g, "");
  return String(raw || "").replace(/^\/+|\/+$/g, "");
}

function pathStartsWith(path, prefixes) {
  return prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function roleRank(role) {
  return ({ viewer: 0, member: 1, admin: 2, owner: 3 })[String(role || "").toLowerCase()] ?? 0;
}

async function requestAttemptsPublication(request) {
  const contentType = String(request.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("application/json")) return false;
  try {
    const data = await request.clone().json();
    const status = String(data?.status || "").toLowerCase();
    const workflow = String(data?.workflowStage || data?.workflow_stage || "").toLowerCase();
    return status === "published" || workflow === "published" || Boolean(data?.publishNow);
  } catch {
    return false;
  }
}

async function authorizeGatewayRequest({ request, path, role }) {
  const method = String(request.method || "GET").toUpperCase();
  const rank = roleRank(role);

  if (method === "OPTIONS") return null;
  if (["GET", "HEAD"].includes(method)) {
    if (rank < 2 && pathStartsWith(path, ADMIN_READ_PREFIXES)) {
      return json({ ok: false, error: "Colophon admin capability required." }, 403);
    }
    return null;
  }

  if (path === "analytics/collect") return null;
  if (rank < 1) return json({ ok: false, error: "Colophon write capability required." }, 403);
  if (rank >= 2) return null;
  if (method === "DELETE") return json({ ok: false, error: "Editor capability required for deletion." }, 403);
  if (!pathStartsWith(path, MEMBER_WRITE_PREFIXES)) {
    return json({ ok: false, error: "Editor capability required for this publishing action." }, 403);
  }
  if (pathStartsWith(path, ["native-content"]) && await requestAttemptsPublication(request)) {
    return json({ ok: false, error: "Editors publish submitted work; contributors may save or submit drafts." }, 403);
  }
  return null;
}

function methodHandler(module, method) {
  if (!module) return null;
  const normalized = String(method || "GET").toUpperCase();
  return module[`onRequest${normalized[0]}${normalized.slice(1).toLowerCase()}`] || module.onRequest || null;
}

function rewriteEmbeddedUrlString(value, requestUrl, orgId) {
  if (typeof value !== "string") return value;
  const origin = new URL(requestUrl).origin;
  const base = `/api/orgs/${encodeURIComponent(orgId)}/colophon`;
  const paths = ["/api/media/files", "/api/audiolab/media", "/api/podcast-media"];
  let next = value;
  for (const path of paths) {
    next = next.split(`${origin}${path}`).join(`${origin}${base}${path.slice(4)}`);
    if (next.startsWith(path)) next = `${base}${path.slice(4)}${next.slice(path.length)}`;
  }
  return next;
}

function rewriteEmbeddedPayload(value, requestUrl, orgId) {
  if (Array.isArray(value)) return value.map((item) => rewriteEmbeddedPayload(item, requestUrl, orgId));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewriteEmbeddedPayload(item, requestUrl, orgId)]));
  }
  return rewriteEmbeddedUrlString(value, requestUrl, orgId);
}

async function rewriteEmbeddedResponse(response, requestUrl, orgId) {
  const contentType = String(response?.headers?.get("content-type") || "").toLowerCase();
  if (!contentType.includes("application/json")) return response;
  try {
    const data = await response.clone().json();
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    return new Response(JSON.stringify(rewriteEmbeddedPayload(data, requestUrl, orgId)), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch {
    return response;
  }
}

async function dispatch(context) {
  const orgId = String(context.params?.orgId || "").trim();
  if (!orgId) return json({ ok: false, error: "MISSING_ORG_ID" }, 400);

  // Internal Colophon storage traffic must never enter the readable Colophon
  // gateway. Re-run the private gate here as a route-level backstop because
  // this catch-all Function is more specific than the generic org routes.
  const requestUrl = new URL(context.request.url);
  if (requestUrl.searchParams.get("__bf_colophon_storage") === "1") {
    const privateResponse = await privateRequestGate({ env: context.env, request: context.request });
    if (privateResponse) return privateResponse;
    return json({ ok: false, error: "PRIVATE_STORAGE_ROUTE_UNAVAILABLE" }, 409);
  }

  const path = normalizedPath(context.params);
  const handlerModule = HANDLERS[path];
  if (!handlerModule) return json({ ok: false, error: "UNKNOWN_COLOPHON_ENDPOINT", path }, 404);

  const auth = await requireOrgRole({ env: context.env, request: context.request, orgId, minRole: "viewer" });
  if (!auth.ok) return auth.resp;

  if (!(await isOrgModuleEnabled(context.env, orgId, "publishing-colophon"))) {
    return json({ ok: false, error: "MODULE_DISABLED", moduleId: "publishing-colophon" }, 403);
  }

  const role = String(auth.role || "viewer").toLowerCase();
  const denied = await authorizeGatewayRequest({ request: context.request, path, role });
  if (denied) return denied;

  const handler = methodHandler(handlerModule, context.request.method);
  if (!handler) return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const actor = {
    id: auth.user?.sub || auth.user?.id || auth.user?.userId || "",
    email: auth.user?.email || "",
    role,
  };
  const scopedEnv = createColophonScopedEnv(context.env, orgId);
  const colophonActor = await ensureColophonGatewayActor(scopedEnv, orgId, actor);
  const gatewayRequest = await createColophonGatewayRequest(
    context.request,
    orgId,
    { ...colophonActor, bondfireRole: role },
    context.env,
  );
  const response = await handler({
    ...context,
    env: scopedEnv,
    request: gatewayRequest,
  });
  return rewriteEmbeddedResponse(response, context.request.url, orgId);
}

export const onRequestGet = dispatch;
export const onRequestHead = dispatch;
export const onRequestPost = dispatch;
export const onRequestPut = dispatch;
export const onRequestPatch = dispatch;
export const onRequestDelete = dispatch;
export const onRequestOptions = dispatch;
