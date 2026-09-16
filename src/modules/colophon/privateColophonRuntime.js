import { api } from "../../utils/api.js";

const MAX_INLINE_MEDIA = 300_000;
const SINGLETON = Object.freeze({ setup: "setup", config: "config", feed: "feed", podcast: "podcast" });
const KIND = Object.freeze({
  content: "colophon/content",
  revisions: "colophon/revisions",
  media: "colophon/media",
  comments: "colophon/comments",
  taxonomy: "colophon/taxonomy",
  sources: "colophon/sources",
  setup: "colophon/setup",
  config: "colophon/config",
  collections: "colophon/collections",
  publications: "colophon/publications",
  campaigns: "colophon/campaigns",
  campaignRevisions: "colophon/campaign-revisions",
  investigations: "colophon/investigations",
  investigationRevisions: "colophon/investigation-revisions",
  courses: "colophon/courses",
  translations: "colophon/translations",
  feed: "colophon/feed-settings",
  podcast: "colophon/podcast-settings",
});

function response(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
function roleRank(role) {
  return ({ viewer: 0, member: 1, admin: 2, owner: 3 })[String(role || "").toLowerCase()] ?? 0;
}
function nowIso() { return new Date().toISOString(); }
function makeId(prefix = "item") { return `${prefix}-${crypto.randomUUID()}`; }
function slugify(value = "") {
  return String(value || "").toLowerCase().trim().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || makeId("post");
}
function methodOf(input, init = {}) {
  return String(init.method || (input instanceof Request ? input.method : "GET") || "GET").toUpperCase();
}
async function bodyJson(input, init = {}) {
  if (typeof init.body === "string") return JSON.parse(init.body || "{}");
  if (input instanceof Request) return input.clone().json().catch(() => ({}));
  return {};
}
async function bodyForm(input, init = {}) {
  if (init.body instanceof FormData) return init.body;
  if (input instanceof Request) return input.clone().formData().catch(() => new FormData());
  return new FormData();
}
function privatePath(orgId, kind, id = "") {
  const base = `/api/orgs/${encodeURIComponent(orgId)}/${kind}`;
  const path = id ? `${base}/${encodeURIComponent(id)}` : base;
  return `${path}?__bf_colophon_storage=1`;
}
async function listRecords(orgId, kind) {
  const data = await api(privatePath(orgId, kind));
  return Array.isArray(data?.items) ? data.items : [];
}
async function getRecord(orgId, kind, id) {
  const data = await api(privatePath(orgId, kind, id));
  return data?.item || null;
}
async function recordExists(orgId, kind, id) {
  try { return await getRecord(orgId, kind, id); }
  catch (error) { if (Number(error?.status) === 404) return null; throw error; }
}
async function saveRecord(orgId, kind, value, id = "") {
  const recordId = String(id || value?.id || makeId("item"));
  const existing = await recordExists(orgId, kind, recordId);
  const payload = { ...(value || {}), id: recordId };
  const result = await api(existing ? privatePath(orgId, kind, recordId) : privatePath(orgId, kind), {
    method: existing ? "PUT" : "POST",
    body: JSON.stringify(payload),
  });
  return result?.item || payload;
}
async function removeRecord(orgId, kind, id) {
  await api(privatePath(orgId, kind, id), { method: "DELETE", body: "{}" });
}
async function readSingleton(orgId, kind, id, fallback) {
  const row = await recordExists(orgId, kind, id);
  return row || structuredClone(fallback);
}
async function saveSingleton(orgId, kind, id, value) {
  return saveRecord(orgId, kind, value, id);
}
function filterItems(items, url) {
  let next = [...items];
  const id = url.searchParams.get("id");
  const slug = url.searchParams.get("slug");
  const type = url.searchParams.get("type");
  const status = url.searchParams.get("status");
  if (id) next = next.filter((item) => String(item.id) === id);
  if (slug) next = next.filter((item) => String(item.slug) === slug);
  if (type) next = next.filter((item) => String(item.type || item.contentType || "article") === type);
  if (status) next = next.filter((item) => String(item.status || "draft") === status);
  return next;
}
async function publish(orgId, body) {
  return api(`/api/orgs/${encodeURIComponent(orgId)}/privacy/colophon-publish`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
function forbidden(message = "This publishing action requires a higher organization role.") {
  return response({ ok: false, error: message }, 403);
}

const contentWriteLocks = new Map();
const recentContentWrites = new Map();

async function withContentWriteLock(key, task) {
  const previous = contentWriteLocks.get(key) || Promise.resolve();
  const run = previous.catch(() => {}).then(task);
  contentWriteLocks.set(key, run);
  try { return await run; }
  finally { if (contentWriteLocks.get(key) === run) contentWriteLocks.delete(key); }
}

function recentContentWrite(key) {
  const entry = recentContentWrites.get(key);
  if (!entry || Date.now() - entry.at > 15_000) {
    recentContentWrites.delete(key);
    return null;
  }
  return entry;
}

const DEFAULT_SETUP = Object.freeze({
  firstRunComplete: false,
  preset: "simple",
  modules: ["articles"],
  identity: { name: "Publication", description: "", logoUrl: "", primaryEditor: "" },
});
const DEFAULT_CONFIG = Object.freeze({ text: {}, styles: {}, blocks: {} });
const DEFAULT_PODCAST = Object.freeze({ shows: [], defaultShowId: "" });

async function handleNativeContent(orgId, url, input, init, session) {
  const method = methodOf(input, init);
  const rank = roleRank(session?.role);
  if (method === "OPTIONS") return response({ ok: true, canEdit: rank >= 1, mode: "member-only" });
  if (method === "GET") {
    const items = filterItems(await listRecords(orgId, KIND.content), url)
      .sort((a,b) => new Date(b.updatedAt || b.publishedAt || 0) - new Date(a.updatedAt || a.publishedAt || 0));
    const single = url.searchParams.has("id") || url.searchParams.has("slug");
    return response({ ok: true, items, item: single ? items[0] || null : undefined, mode: "member-only" });
  }
  if (rank < 1) return forbidden("Colophon write capability required.");
  if (["POST","PUT"].includes(method)) {
    const body = await bodyJson(input, init);
    const incoming = body.item || body.entry || body;
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) return response({ ok: false, error: "INVALID_CONTENT" }, 400);
    if (String(incoming.status || "").toLowerCase() === "published" && rank < 2) return forbidden("Editor capability required to publish.");
    const id = String(incoming.id || makeId("native"));
    const writeKey = `${orgId}:${id}`;
    return withContentWriteLock(writeKey, async () => {
      const existing = await recordExists(orgId, KIND.content, id);
      const note = String(body.revisionNote || "save").toLowerCase();
      const statusOnlyMutation = ["trash", "bulk trash", "restore", "bulk restore"].includes(note);
      if (statusOnlyMutation && !existing) {
        return response({ ok: false, error: "CONTENT_NOT_FOUND" }, 404);
      }
      const expectedUpdatedAt = String(body.expectedUpdatedAt || "");
      const currentUpdatedAt = String(existing?.updatedAt || "");
      const recent = recentContentWrite(writeKey);
      if (existing && expectedUpdatedAt && currentUpdatedAt !== expectedUpdatedAt && !statusOnlyMutation) {
        const locallyAdvanced = recent
          && String(recent.previousUpdatedAt || "") === expectedUpdatedAt
          && String(recent.updatedAt || "") === currentUpdatedAt;
        if (note === "autosave" && recent && String(recent.updatedAt || "") === currentUpdatedAt) {
          return response({ ok: true, item: existing, saved: false, skipped: true, mode: "member-only" });
        }
        if (!locallyAdvanced) {
          return response({ ok: false, conflict: true, error: "This content changed since you opened it. Reload the latest version before saving over it.", current: existing }, 409);
        }
      }
      const now = nowIso();
      const requestedStatus = String(incoming.status || existing?.status || "draft");
      const status = rank < 2 && String(existing?.status || "").toLowerCase() === "published" ? "draft" : requestedStatus;
      const incomingForSave = statusOnlyMutation && existing
        ? {
            status,
            workflowState: status.toLowerCase() === "trash" ? "trash" : status.toLowerCase() === "draft" ? "draft" : String(existing.workflowState || incoming.workflowState || status),
          }
        : incoming;
      const derivedSource = statusOnlyMutation && existing ? existing : incoming;
      const item = {
        ...(existing || {}), ...incomingForSave,
        id,
        slug: String(derivedSource.slug || existing?.slug || slugify(derivedSource.title || id)),
        type: String(derivedSource.type || derivedSource.contentType || existing?.type || "article"),
        status,
        createdAt: String(existing?.createdAt || derivedSource.createdAt || now),
        updatedAt: now,
        ...(status.toLowerCase() === "published" ? { publishedAt: String(derivedSource.publishedAt || existing?.publishedAt || now) } : {}),
      };
      const saved = await saveRecord(orgId, KIND.content, item, id);
      recentContentWrites.set(writeKey, {
        previousUpdatedAt: expectedUpdatedAt || currentUpdatedAt,
        updatedAt: String(saved?.updatedAt || item.updatedAt || ""),
        revisionNote: String(body.revisionNote || "save"),
        at: Date.now(),
      });
      const revision = {
        id: makeId("revision"),
        nativeContentId: id,
        snapshot: item,
        revisionNote: String(body.revisionNote || "save"),
        createdAt: now,
      };
      try { await saveRecord(orgId, KIND.revisions, revision, revision.id); } catch {}
      if (rank >= 2) {
        try {
          await publish(orgId, { kind: "content", id, public: status.toLowerCase() === "published" ? item : null });
        } catch (error) {
          return response({ ok: false, saved: true, item: saved, error: `Encrypted draft saved, but the public copy could not be updated: ${error.message}` }, 502);
        }
      }
      return response({ ok: true, item: saved, saved: true, mode: "member-only" });
    });
  }
  if (method === "DELETE") {
    if (rank < 2) return forbidden("Editor capability required for deletion.");
    const body = await bodyJson(input, init).catch(() => ({}));
    const key = String(url.searchParams.get("id") || url.searchParams.get("slug") || body.id || "");
    const items = await listRecords(orgId, KIND.content);
    const item = items.find((row) => String(row.id) === key || String(row.slug) === key) || null;
    if (!item) return response({ ok: true, removed: false, mode: "member-only" });
    await removeRecord(orgId, KIND.content, item.id);
    await publish(orgId, { kind: "content", id: item.id, public: null });
    return response({ ok: true, removed: true, mode: "member-only" });
  }
  return response({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
}

async function handleRevisions(orgId, url, input, init, session, kind = KIND.revisions, targetKind = KIND.content, foreignKey = "nativeContentId") {
  const method = methodOf(input, init);
  const rank = roleRank(session?.role);
  if (method === "GET") {
    const targetId = url.searchParams.get("nativeId") || url.searchParams.get("contentId") || url.searchParams.get("campaignId") || url.searchParams.get("investigationId") || "";
    const items = (await listRecords(orgId, kind))
      .filter((item) => !targetId || String(item[foreignKey] || "") === targetId)
      .sort((a,b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    return response({ ok: true, items, mode: "member-only" });
  }
  if (method === "POST") {
    if (rank < 1) return forbidden("Colophon write capability required.");
    const body = await bodyJson(input, init);
    const revisions = await listRecords(orgId, kind);
    const revision = revisions.find((item) => String(item.id) === String(body.revisionId || body.id || ""));
    if (!revision?.snapshot?.id) return response({ ok: false, error: "REVISION_NOT_FOUND" }, 404);
    const restored = { ...revision.snapshot, updatedAt: nowIso() };
    if (targetKind === KIND.content && rank < 2 && String(restored.status || "").toLowerCase() === "published") restored.status = "draft";
    const saved = await saveRecord(orgId, targetKind, restored, restored.id);
    if (targetKind === KIND.content && rank >= 2) {
      await publish(orgId, { kind: "content", id: saved.id, public: String(saved.status || "").toLowerCase() === "published" ? saved : null });
    }
    return response({ ok: true, item: saved, mode: "member-only" });
  }
  return response({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
}

async function handleGeneric(orgId, url, input, init, session, kind, bodyField = "item", minWriteRank = 2) {
  const method = methodOf(input, init);
  const rank = roleRank(session?.role);
  if (method === "GET") {
    const items = filterItems(await listRecords(orgId, kind), url);
    const single = url.searchParams.has("id") || url.searchParams.has("slug");
    return response({ ok: true, items, item: single ? items[0] || null : undefined, [bodyField]: single ? items[0] || null : undefined, mode: "member-only" });
  }
  if (["POST","PUT","PATCH"].includes(method)) {
    if (rank < minWriteRank) return forbidden(minWriteRank >= 2 ? "Editor capability required for this publishing action." : "Colophon write capability required.");
    const body = await bodyJson(input, init);
    const incoming = body[bodyField] || body.item || body.publication || body.asset || body.translation || body;
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) return response({ ok: false, error: "INVALID_ITEM" }, 400);
    const now = nowIso();
    const id = String(incoming.id || makeId(kind.split("/").at(-1) || "item"));
    const existing = await recordExists(orgId, kind, id);
    const item = { ...(existing || {}), ...incoming, id, updatedAt: now, createdAt: String(existing?.createdAt || incoming.createdAt || now) };
    if ("title" in item && !item.slug) item.slug = slugify(item.title);
    const saved = await saveRecord(orgId, kind, item, id);
    return response({ ok: true, item: saved, [bodyField]: saved, saved: true, mode: "member-only" });
  }
  if (method === "DELETE") {
    if (rank < 2) return forbidden("Editor capability required for deletion.");
    const body = await bodyJson(input, init).catch(() => ({}));
    const key = String(url.searchParams.get("id") || body.id || "");
    if (!key) return response({ ok: true, removed: false, mode: "member-only" });
    const items = await listRecords(orgId, kind);
    const item = items.find((row) => String(row.id) === key || String(row.slug) === key) || null;
    if (item) await removeRecord(orgId, kind, item.id);
    return response({ ok: true, removed: Boolean(item), mode: "member-only" });
  }
  return response({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
}

async function handleSingleton(orgId, input, init, session, kind, id, fallback, responseField, minWriteRank = 2) {
  const method = methodOf(input, init);
  const rank = roleRank(session?.role);
  if (method === "GET") {
    const value = await readSingleton(orgId, kind, id, fallback);
    return response({ ok: true, [responseField]: value, ...(responseField === "config" ? { payload: value } : {}), mode: "member-only" });
  }
  if (["POST","PUT","PATCH"].includes(method)) {
    if (rank < minWriteRank) return forbidden(minWriteRank >= 2 ? "Editor capability required for this publishing action." : "Colophon write capability required.");
    const body = await bodyJson(input, init);
    const value = body[responseField] || body.payload || body;
    const saved = await saveSingleton(orgId, kind, id, value);
    return response({ ok: true, [responseField]: saved, ...(responseField === "config" ? { payload: saved } : {}), saved: true, mode: "member-only" });
  }
  return response({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
}

async function blobToDataUrl(blob) {
  if (!(blob instanceof Blob)) throw new Error("NO_MEDIA_FILE");
  if (blob.size > MAX_INLINE_MEDIA) throw new Error("PRIVATE_MEDIA_TOO_LARGE");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type || "application/octet-stream"};base64,${btoa(binary)}`;
}
async function handleMedia(orgId, url, input, init, session) {
  const method = methodOf(input, init);
  if (method === "GET") {
    let items = await listRecords(orgId, KIND.media);
    const mediaType = url.searchParams.get("mediaType");
    if (mediaType) items = items.filter((item) => String(item.mediaType || "") === mediaType);
    return response({ ok: true, items, mode: "member-only" });
  }
  if (["POST","PUT"].includes(method) && (init.body instanceof FormData || input instanceof Request && String(input.headers.get("content-type") || "").includes("multipart/form-data"))) {
    if (roleRank(session?.role) < 1) return forbidden("Colophon media write capability required.");
    const form = await bodyForm(input, init);
    const file = form.get("file");
    try {
      const dataUrl = await blobToDataUrl(file);
      const now = nowIso();
      const id = makeId("media");
      const filename = String(form.get("filename") || file?.name || "upload");
      const mimeType = String(form.get("mimeType") || file?.type || "application/octet-stream");
      const asset = {
        id, filename,
        title: String(form.get("title") || filename.replace(/\.[^.]+$/, "")),
        mimeType,
        mediaType: mimeType.startsWith("image/") ? "image" : mimeType.startsWith("audio/") ? "audio" : mimeType.startsWith("video/") ? "video" : "file",
        size: Number(file?.size || 0),
        url: dataUrl, publicUrl: dataUrl, downloadUrl: dataUrl,
        role: String(form.get("role") || ""), createdAt: now, updatedAt: now,
      };
      const saved = await saveRecord(orgId, KIND.media, asset, id);
      return response({ ok: true, media: saved, asset: saved, item: saved, mode: "member-only" });
    } catch (error) {
      return response({ ok: false, error: error.message === "PRIVATE_MEDIA_TOO_LARGE" ? "Encrypted Colophon media is currently limited to 300 KB per item. Use a public URL for intentionally public larger media." : error.message }, error.message === "PRIVATE_MEDIA_TOO_LARGE" ? 413 : 400);
    }
  }
  return handleGeneric(orgId, url, input, init, session, KIND.media, "asset", 1);
}

export async function handlePrivateColophonFetch({ orgId, session, input, init = {}, suffix = "" }) {
  const raw = input instanceof Request ? input.url : String(input || "");
  const url = new URL(raw || `/api/${suffix}`, window.location.origin);
  const path = String(suffix || url.pathname.replace(/^\/api\/?/, "")).replace(/^\/+|\/+$/g, "");
  const method = methodOf(input, init);
  if (path === "session") return response({ ...session, authenticated: true, mode: "bondfire-private" });

  const contentPath = path.match(/^(?:native-content|content)(?:\/([^/]+))?$/);
  if (contentPath) {
    const contentUrl = new URL(url.toString());
    if (contentPath[1] && !contentUrl.searchParams.has("id")) contentUrl.searchParams.set("id", contentPath[1]);
    return handleNativeContent(orgId, contentUrl, input, init, session);
  }

  const revisionsPath = path.match(/^(?:native-content-revisions|content-revisions)(?:\/([^/]+))?$/);
  if (revisionsPath) {
    const revisionsUrl = new URL(url.toString());
    if (revisionsPath[1] && !revisionsUrl.searchParams.has("id")) revisionsUrl.searchParams.set("id", revisionsPath[1]);
    return handleRevisions(orgId, revisionsUrl, input, init, session);
  }

  if (path === "publishing-setup") return handleSingleton(orgId, input, init, session, KIND.setup, SINGLETON.setup, DEFAULT_SETUP, "setup", 2);
  if (path === "public-site-config" || path === "public-config") {
    if (method === "GET") return handleSingleton(orgId, input, init, session, KIND.config, SINGLETON.config, DEFAULT_CONFIG, "config", 2);
    if (roleRank(session?.role) < 2) return forbidden("Site management capability required.");
    const body = await bodyJson(input, init);
    const config = body.config || body.payload || body;
    const saved = await saveSingleton(orgId, KIND.config, SINGLETON.config, config);
    try { await publish(orgId, { kind: "config", public: config }); }
    catch (error) { return response({ ok: false, saved: true, config: saved, payload: saved, error: `Encrypted configuration saved, but its public copy could not be updated: ${error.message}` }, 502); }
    return response({ ok: true, config: saved, payload: saved, saved: true, mode: "member-only" });
  }
  if (path === "media-assets" || path === "media/files" || path === "audiolab/media" || path === "podcast-media") return handleMedia(orgId, url, input, init, session);
  if (path === "collections") return handleGeneric(orgId, url, input, init, session, KIND.collections, "item", 2);
  if (path === "publications") return handleGeneric(orgId, url, input, init, session, KIND.publications, "publication", 2);
  if (path === "campaigns") return handleGeneric(orgId, url, input, init, session, KIND.campaigns, "item", 2);
  if (path === "campaign-revisions") return handleRevisions(orgId, url, input, init, session, KIND.campaignRevisions, KIND.campaigns, "campaignId");
  if (path === "investigations") return handleGeneric(orgId, url, input, init, session, KIND.investigations, "item", 2);
  if (path === "investigation-revisions") return handleRevisions(orgId, url, input, init, session, KIND.investigationRevisions, KIND.investigations, "investigationId");
  if (path === "courses") return handleGeneric(orgId, url, input, init, session, KIND.courses, "item", 2);
  if (path === "native-translations") return handleGeneric(orgId, url, input, init, session, KIND.translations, "translation", 2);
  if (path === "taxonomy" || path === "native-content-taxonomy") return handleGeneric(orgId, url, input, init, session, KIND.taxonomy, "item", 1);
  if (path === "native-content-sources") return handleGeneric(orgId, url, input, init, session, KIND.sources, "item", 1);
  if (path === "editorial-comments") return handleGeneric(orgId, url, input, init, session, KIND.comments, "item", 1);
  if (path === "editorial-review") {
    const items = await listRecords(orgId, KIND.content);
    return response({ ok: true, items, mode: "member-only" });
  }
  if (path === "feed-settings") return handleSingleton(orgId, input, init, session, KIND.feed, SINGLETON.feed, {}, "settings", 2);
  if (path === "podcast-settings") {
    if (method === "GET") {
      const value = await readSingleton(orgId, KIND.podcast, SINGLETON.podcast, DEFAULT_PODCAST);
      return response({ ok: true, ...value, settings: value.shows?.[0] || {}, show: value.shows?.[0] || null, mode: "member-only" });
    }
    if (roleRank(session?.role) < 2) return forbidden("Editor capability required for podcast settings.");
    const body = await bodyJson(input, init);
    const current = await readSingleton(orgId, KIND.podcast, SINGLETON.podcast, DEFAULT_PODCAST);
    const settings = { ...(body.settings || {}), id: String(body.showId || body.settings?.id || makeId("podcast")) };
    const shows = Array.isArray(current.shows) ? current.shows : [];
    const next = { shows: shows.some((item) => item.id === settings.id) ? shows.map((item) => item.id === settings.id ? settings : item) : [settings, ...shows], defaultShowId: current.defaultShowId || settings.id };
    await saveSingleton(orgId, KIND.podcast, SINGLETON.podcast, next);
    return response({ ok: true, ...next, settings, show: settings, saved: true, mode: "member-only" });
  }
  if (path === "users") return roleRank(session?.role) >= 2 ? response({ ok: true, items: [session?.user].filter(Boolean), mode: "bondfire-private" }) : forbidden("Colophon admin capability required.");
  if (path === "editor-roles") return roleRank(session?.role) >= 2 ? response({ ok: true, role: session?.role || "member", capabilities: session?.capabilities || [], mode: "bondfire-private" }) : forbidden("Colophon admin capability required.");
  if (path === "site-health") return roleRank(session?.role) >= 2 ? response({ ok: true, status: "ok", mode: "member-only", checks: [{ id: "storage", status: "ok", label: "Bondfire encrypted storage active" }] }) : forbidden("Colophon admin capability required.");
  if (path === "backup-status") return roleRank(session?.role) >= 2 ? response({ ok: true, status: "encrypted", mode: "member-only", message: "Publication drafts are stored in Bondfire member-only encrypted storage." }) : forbidden("Colophon admin capability required.");
  if (path === "analytics/report") return roleRank(session?.role) >= 2 ? response({ ok: true, report: {}, items: [], disabled: true, mode: "member-only" }) : forbidden("Colophon admin capability required.");
  if (path === "analytics/collect") return response({ ok: true, disabled: true, mode: "member-only" });
  if (path === "audit-log") return roleRank(session?.role) >= 2 ? response({ ok: true, items: [], mode: "member-only" }) : forbidden("Colophon admin capability required.");
  if (["sites","deployment-status"].includes(path)) return response({ ok: true, items: [], mode: "bondfire-private", managedByHost: true });
  if (["audiolab/transcribe","podcast-hosting","podcast-import","podcast-source-refresh","campaign-instagram-auth","campaign-instagram-sync","campaign-monitor","campaign-coverage","weblate-sync","account-security","system-backup"].some((name) => path === name || path.startsWith(`${name}/`))) {
    return response({ ok: false, error: "This server-processing integration is disabled for member-only encrypted publication data." }, 409);
  }
  return response({ ok: false, error: `Encrypted Colophon endpoint not available: ${path}` }, 501);
}
