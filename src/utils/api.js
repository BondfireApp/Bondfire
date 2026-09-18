// src/utils/api.js
// Central fetch wrapper with auth/session support plus client-side protection
// for private org content. Sensitive private fields are encrypted before they
// leave the browser; ciphertext is authoritative on the server.
import { isDemoMode } from "../demo/demoMode.js";
import { demoHandle, ensureDemoOrgList } from "../demo/demoStore.js";

const PRIVATE_TRANSPORT = Symbol("private transport");

const API_BASE = (import.meta?.env?.VITE_API_BASE || "").replace(/\/$/, "");
let driveErrorTimer = null;

function driveWriteMessage(error) {
  const code = String(error?.code || error?.message || "").trim();
  const known = {
    PRIVATE_KEY_ROTATION_REQUIRED: "Drive cannot save because the organization encryption keys need to be rotated in Settings → Security.",
    ORG_LOCKDOWN_ACTIVE: "Drive is read-only while the organization emergency lockdown is active.",
    ORG_ISOLATED: "Drive is unavailable while the organization is in owner-only isolation.",
    INSUFFICIENT_ROLE: "Your current organization role does not allow Drive changes.",
    NOT_A_MEMBER: "This account is not currently a member of this organization.",
    UNAUTHORIZED: "Your session expired. Sign in again before saving Drive changes.",
    CSRF_REQUIRED: "Your session security token is missing or stale. Reload Bondfire and try again.",
    CSRF_INVALID: "Your session security token is stale. Reload Bondfire and try again.",
    VALID_CIPHERTEXT_REQUIRED: "Drive could not create valid encrypted content. Nothing was saved.",
    PRIVATE_REVISION_CONFLICT: "This Drive item changed elsewhere. Reload Drive before saving again.",
    PRIVATE_MODE_NOT_READY: "Encrypted storage is not ready for Drive writes yet. Check Settings → Security.",
    PRIVATE_MIGRATION_IN_PROGRESS: "Drive is read-only while encrypted-storage conversion is still in progress.",
  };
  return known[code] || error?.message || code || "Drive could not save this change.";
}

function showDriveWriteError(rel, method, error) {
  if (typeof document === "undefined") return;
  if (!/\/drive(?:\/|$)/.test(String(rel || ""))) return;
  if (["GET", "HEAD"].includes(String(method || "GET").toUpperCase())) return;

  const message = driveWriteMessage(error);
  let node = document.getElementById("bf-drive-write-error");
  if (!node) {
    node = document.createElement("div");
    node.id = "bf-drive-write-error";
    node.setAttribute("role", "alert");
    Object.assign(node.style, {
      position: "fixed",
      left: "50%",
      bottom: "20px",
      transform: "translateX(-50%)",
      zIndex: "10000",
      width: "min(680px, calc(100vw - 28px))",
      padding: "12px 14px",
      border: "1px solid rgba(239,68,68,.65)",
      borderRadius: "10px",
      background: "rgba(69,10,10,.97)",
      color: "#fee2e2",
      boxShadow: "0 16px 40px rgba(0,0,0,.45)",
      fontSize: "14px",
      lineHeight: "1.45",
      whiteSpace: "pre-wrap",
    });
    document.body.appendChild(node);
  }
  node.textContent = message;
  node.style.display = "block";
  if (driveErrorTimer) clearTimeout(driveErrorTimer);
  driveErrorTimer = setTimeout(() => {
    const current = document.getElementById("bf-drive-write-error");
    if (current) current.style.display = "none";
  }, 9000);
}

function pickToken() {
  try {
    return localStorage.getItem("bf_token") || localStorage.getItem("bf_auth_token") || localStorage.getItem("bf_access_token") || localStorage.getItem("bf_accessToken") || "";
  } catch { return ""; }
}
function saveToken(tok) { if (!tok) return; try { localStorage.setItem("bf_token", tok); } catch {} }
async function readJsonMaybe(res) {
  if (!res || res.status === 204 || res.status === 205) return null;
  const text = await res.text().catch(() => "");
  if (!text) return null;
  try { return JSON.parse(text); } catch { return { raw: text }; }
}
async function tryRefresh() {
  const rel = "/api/auth/refresh";
  const url = API_BASE ? `${API_BASE}${rel}` : rel;
  const res = await fetch(url, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}" });
  if (!res.ok) return null;
  const data = await readJsonMaybe(res);
  if (data?.token) saveToken(data.token);
  if (data?.access_token) saveToken(data.access_token);
  return data;
}

function orgRoute(rel) {
  const m = String(rel || "").match(/^\/api\/orgs\/([^/?]+)\/(needs|meetings|inventory|people|chat\/messages|drive\/notes)(?:\/([^/?]+))?(?:\?.*)?$/);
  if (!m) return null;
  let orgId = m[1];
  try { orgId = decodeURIComponent(orgId); } catch {}
  return { orgId, kind: m[2], itemId: m[3] || "" };
}

async function cryptoTools(orgId) {
  const zk = await import("../lib/zk.js");
  const key = zk.getCachedOrgKey(orgId);
  if (!key) throw new Error("This private content cannot be saved until this device has the organization encryption key.");
  return { key, encrypt: zk.encryptWithOrgKey, decrypt: zk.decryptWithOrgKey };
}

function parseJsonBody(body) {
  if (typeof body !== "string") return null;
  try { return JSON.parse(body); } catch { return null; }
}

async function protectWrite(rel, opts) {
  if (opts.__skipContentCrypto) return opts;
  const route = orgRoute(rel);
  const method = String(opts.method || "GET").toUpperCase();
  if (!route || !["POST", "PUT", "PATCH"].includes(method)) return opts;
  const body = parseJsonBody(opts.body);
  if (!body) return opts;

  const privateRecord = route.kind === "people" || route.kind === "chat/messages" || route.kind === "drive/notes" || !body.is_public;
  if (!privateRecord) return opts;
  const { key, encrypt } = await cryptoTools(route.orgId);

  let sensitive = null;
  let next = { ...body };
  if (route.kind === "needs") {
    if (body.encrypted_blob) return opts;
    sensitive = { title: String(body.title || ""), description: String(body.description || ""), urgency: String(body.urgency || "") };
    next = { ...next, title: "__encrypted__", description: "", urgency: "" };
  } else if (route.kind === "meetings") {
    if (body.encrypted_blob) return opts;
    sensitive = { title: String(body.title || ""), location: String(body.location || ""), agenda: String(body.agenda || ""), notes: String(body.notes || "") };
    next = { ...next, title: "__encrypted__", location: "", agenda: "", notes: "" };
  } else if (route.kind === "inventory") {
    if (body.encrypted_blob) return opts;
    sensitive = { name: String(body.name || ""), category: String(body.category || ""), location: String(body.location || ""), notes: String(body.notes || "") };
    next = { ...next, name: "__encrypted__", category: "", location: "", notes: "" };
  } else if (route.kind === "people") {
    if (body.encrypted_blob) return opts;
    sensitive = { name: String(body.name || ""), role: String(body.role || ""), phone: String(body.phone || ""), skills: String(body.skills || ""), notes: String(body.notes || "") };
    next = { ...next, name: "__encrypted__", role: "", phone: "", skills: "", notes: "" };
  } else if (route.kind === "chat/messages") {
    if (body.encrypted_blob) return opts;
    sensitive = { body: String(body.body || "") };
    next = { ...next, body: "__encrypted__" };
  } else if (route.kind === "drive/notes") {
    if (body.encryptedBlob) return opts;
    sensitive = { title: String(body.title || "untitled"), body: String(body.body ?? body.content ?? ""), tags: Array.isArray(body.tags) ? body.tags : String(body.tags || "").split(",").map((x) => x.trim()).filter(Boolean) };
    next = { ...next, title: "encrypted note", body: "", content: "", tags: [] };
  }
  if (!sensitive) return opts;
  const encrypted = await encrypt(key, JSON.stringify(sensitive));
  if (route.kind === "drive/notes") next.encryptedBlob = encrypted;
  else next.encrypted_blob = encrypted;
  return { ...opts, body: JSON.stringify(next) };
}

async function revealOne(route, row) {
  if (!row || typeof row !== "object") return row;
  const blob = route.kind === "drive/notes" ? row.encryptedBlob : row.encrypted_blob;
  if (!blob) return row;
  try {
    const { key, decrypt } = await cryptoTools(route.orgId);
    const clear = JSON.parse(await decrypt(key, blob));
    return { ...row, ...clear };
  } catch { return row; }
}

async function revealResponse(rel, data) {
  const route = orgRoute(rel);
  if (!route || !data || typeof data !== "object") return data;
  if (route.kind === "needs" && Array.isArray(data.needs)) return { ...data, needs: await Promise.all(data.needs.map((r) => revealOne(route, r))) };
  if (route.kind === "meetings" && Array.isArray(data.meetings)) return { ...data, meetings: await Promise.all(data.meetings.map((r) => revealOne(route, r))) };
  if (route.kind === "inventory") {
    const key = Array.isArray(data.inventory) ? "inventory" : Array.isArray(data.items) ? "items" : null;
    if (key) return { ...data, [key]: await Promise.all(data[key].map((r) => revealOne(route, r))) };
  }
  if (route.kind === "people" && Array.isArray(data.people)) return { ...data, people: await Promise.all(data.people.map((r) => revealOne(route, r))) };
  if (route.kind === "chat/messages" && Array.isArray(data.messages)) return { ...data, messages: await Promise.all(data.messages.map((r) => revealOne(route, r))) };
  if (route.kind === "drive/notes") {
    if (Array.isArray(data.notes)) return { ...data, notes: await Promise.all(data.notes.map((r) => revealOne(route, r))) };
    if (data.note) return { ...data, note: await revealOne(route, data.note) };
  }
  return data;
}

export async function api(path, options = {}) {
  const rel = path.startsWith("/") ? path : `/${path}`;
  const requestMethod = String(options.method || "GET").toUpperCase();
  if (isDemoMode()) {
    ensureDemoOrgList();
    const handled = demoHandle(rel, options);
    if (handled) return handled;
  }

  if (!options[PRIVATE_TRANSPORT]) {
    try {
      const { dispatchPrivate } = await import('../lib/privateClient.js');
      const result = await dispatchPrivate(path, options, (p, o = {}) => api(p, { ...o, [PRIVATE_TRANSPORT]: true, __skipContentCrypto: true }));
      if (result?.handled) return result.data;
    } catch (error) {
      showDriveWriteError(rel, requestMethod, error);
      throw error;
    }
  }
  const opts = options[PRIVATE_TRANSPORT] ? options : await protectWrite(rel, options);
  const { __skipContentCrypto, ...fetchOpts } = opts;
  const candidates = path.startsWith("http") ? [path] : !API_BASE ? [rel] : rel.startsWith("/api/") ? [rel, `${API_BASE}${rel}`] : [`${API_BASE}${rel}`];
  const headers = new Headers(fetchOpts.headers || {});
  const body = fetchOpts.body;
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
  const isBlob = typeof Blob !== "undefined" && body instanceof Blob;
  const isArrayBuffer = typeof ArrayBuffer !== "undefined" && (body instanceof ArrayBuffer || ArrayBuffer.isView(body));
  if (!headers.has("Content-Type") && body != null && !isFormData && !isBlob && !isArrayBuffer) headers.set("Content-Type", "application/json");
  try {
    const csrf = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith('bf_csrf='));
    if (csrf && !headers.has('x-csrf')) headers.set('x-csrf', decodeURIComponent(csrf.slice(8)));
  } catch {}
  const token = pickToken();
  if (token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);

  const safeToRetry = ['GET', 'HEAD'].includes(String(fetchOpts.method || 'GET').toUpperCase());
  let chosenUrl = candidates[0];
  let firstRes = null;
  for (let i = 0; i < candidates.length; i++) {
    chosenUrl = candidates[i];
    try {
      const r = await fetch(chosenUrl, { ...fetchOpts, headers, credentials: "include" });
      firstRes = r;
      if (!(i < candidates.length - 1 && (r.status === 404 || (safeToRetry && r.status >= 500)))) break;
    } catch {
      firstRes = null;
      if (!safeToRetry) break;
    }
  }
  if (!firstRes) {
    const error = new Error("Network error");
    showDriveWriteError(rel, requestMethod, error);
    throw error;
  }

  if (firstRes.status === 401) {
    try { await tryRefresh(); } catch {}
    const retryHeaders = new Headers(headers);
    const token2 = pickToken();
    if (token2) retryHeaders.set("Authorization", `Bearer ${token2}`);
    firstRes = await fetch(chosenUrl, { ...fetchOpts, headers: retryHeaders, credentials: "include" });
  }
  if (!firstRes.ok) {
    const text = await firstRes.text().catch(() => "");
    let payload;
    try { payload = JSON.parse(text); } catch {}
    const error = new Error(payload?.error || text || `Request failed (${firstRes.status})`);
    error.code = payload?.error;
    error.status = firstRes.status;
    error.details = payload;
    showDriveWriteError(rel, requestMethod, error);
    throw error;
  }
  const data = (await readJsonMaybe(firstRes)) || {};
  return __skipContentCrypto ? data : revealResponse(rel, data);
}