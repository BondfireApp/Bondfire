// src/lib/debugBus.js
// Tiny in-browser debug ring buffer for Bondfire.
// Enabled via ?debug=1 or localStorage bf_debug=1

const MAX = 250;
const SENSITIVE_KEY = /(authorization|cookie|token|secret|password|passphrase|recovery|key|ciphertext|plaintext|body|content|description|notes?|message|email|phone|address|contact|dataurl|textcontent|payload)/i;

function nowIso() {
  try {
    return new Date().toISOString();
  } catch {
    return String(Date.now());
  }
}

export function isDebugEnabled() {
  try {
    const qs = new URLSearchParams(window.location.search);
    if (qs.get("debug") === "1") return true;
    if (qs.get("bf_debug") === "1") return true;
    return String(localStorage.getItem("bf_debug") || "") === "1";
  } catch {
    return false;
  }
}

function getStore() {
  if (!window.__BF_DEBUG__) {
    window.__BF_DEBUG__ = { logs: [] };
  }
  return window.__BF_DEBUG__;
}

function sanitize(value, key = '', depth = 0) {
  if (depth > 4) return '[truncated]';
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    if (/^[A-Z][A-Z0-9_]{2,80}$/.test(value)) return value;
    if (/^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)$/.test(value)) return value;
    return '[redacted-string]';
  }
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => sanitize(item, key, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [childKey, item] of Object.entries(value).slice(0, 50)) {
      out[childKey] = SENSITIVE_KEY.test(childKey) ? '[redacted]' : sanitize(item, childKey, depth + 1);
    }
    return out;
  }
  return `[redacted-${typeof value}]`;
}

function safeType(type) {
  const value = String(type || 'log');
  return /^[A-Za-z0-9_.:-]{1,80}$/.test(value) ? value : 'log';
}

export function debugLog(type, detail = {}) {
  if (!isDebugEnabled()) return;
  const store = getStore();

  const entry = {
    t: nowIso(),
    type: safeType(type),
    detail: sanitize(detail && typeof detail === "object" ? detail : { value: detail }),
  };

  store.logs.push(entry);
  if (store.logs.length > MAX) store.logs.splice(0, store.logs.length - MAX);

  try {
    // Persistence contains sanitized diagnostic metadata only.
    sessionStorage.setItem("bf_debug_logs", JSON.stringify(store.logs.slice(-120)));
  } catch {
    // ignore
  }
}

export function getDebugLogs() {
  const store = getStore();
  if (store.logs.length) return store.logs;

  try {
    const raw = sessionStorage.getItem("bf_debug_logs");
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      store.logs = parsed.map((entry) => ({
        t: typeof entry?.t === 'string' ? entry.t : nowIso(),
        type: safeType(entry?.type),
        detail: sanitize(entry?.detail || {}),
      }));
      return store.logs;
    }
  } catch {
    // ignore
  }

  return store.logs;
}

export function clearDebugLogs() {
  const store = getStore();
  store.logs = [];
  try {
    sessionStorage.removeItem("bf_debug_logs");
  } catch {
    // ignore
  }
}
