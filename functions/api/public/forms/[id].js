import { bad, json, now, uuid } from "../../_lib/http.js";
import { ensureDriveSchema, getDb, loadFileBlob, saveFileBlob } from "../../_lib/drive.js";
import { getPrivateMode } from "../../_lib/privateStore.js";
import {
  readPublicDriveForm,
  storePublicDriveFormResponse,
} from "../../_lib/publicDriveForms.js";

function htmlEscape(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderMarkdownText(value) {
  const applyInline = (text) => {
    let html = htmlEscape(text);
    html = html.replace(/`([^`]+)`/gim, "<code>$1</code>");
    html = html.replace(/\*\*(.+?)\*\*/gim, "<strong>$1</strong>");
    html = html.replace(/\*(.+?)\*/gim, "<em>$1</em>");
    html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gim, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
    return html;
  };
  const lines = String(value || "").replace(/\r\n/g, "\n").split("\n");
  let html = "";
  let listTag = "";
  const closeList = () => { if (listTag) { html += `</${listTag}>`; listTag = ""; } };
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) { closeList(); continue; }
    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (heading) { closeList(); const level = heading[1].length; html += `<h${level}>${applyInline(heading[2])}</h${level}>`; continue; }
    if (/^---+$/.test(trimmed) || /^\*\*\*+$/.test(trimmed)) { closeList(); html += "<hr />"; continue; }
    if (trimmed.startsWith(">")) { closeList(); html += `<blockquote>${applyInline(trimmed.replace(/^>\s?/, ""))}</blockquote>`; continue; }
    const bullet = trimmed.match(/^[-*]\s+(.*)$/);
    const ordered = trimmed.match(/^(\d+)\.\s+(.*)$/);
    if (bullet || ordered) {
      const tag = ordered ? "ol" : "ul";
      if (listTag !== tag) { closeList(); listTag = tag; html += `<${tag}>`; }
      html += `<li>${applyInline(bullet ? bullet[1] : ordered[2])}</li>`;
      continue;
    }
    closeList();
    html += `<p>${applyInline(trimmed)}</p>`;
  }
  closeList();
  return html;
}
function normalizeField(field, idx) {
  const type = ["text", "paragraph", "choice", "checkbox", "date"].includes(String(field?.type || "")) ? field.type : "text";
  return {
    id: String(field?.id || `field_${idx + 1}`),
    type,
    label: String(field?.label || `Question ${idx + 1}`),
    required: !!field?.required,
    options: Array.isArray(field?.options) ? field.options.map((x) => String(x || "")).filter(Boolean) : [],
  };
}

function normalizeLegacyForm(input) {
  return {
    type: "bondfire-form",
    title: String(input?.title || "Untitled form"),
    description: String(input?.description || ""),
    fields: Array.isArray(input?.fields) ? input.fields.map(normalizeField) : [],
    responses: Array.isArray(input?.responses) ? input.responses : [],
    publicShare: {
      enabled: !!input?.publicShare?.enabled,
      token: String(input?.publicShare?.token || ""),
    },
  };
}

async function getLegacyPublicForm(env, fileId) {
  await ensureDriveSchema(env);
  const db = getDb(env);
  const row = await db.prepare(`SELECT id, org_id, name, mime, storage_key FROM drive_files WHERE id = ?`).bind(fileId).first();
  if (!row) return null;
  if (await getPrivateMode(env, row.org_id)) return null;
  const blob = await loadFileBlob(env, row.org_id, row.id, row.storage_key || null, row.mime || "application/octet-stream", row.name || "");
  const parsed = normalizeLegacyForm(JSON.parse(String(blob?.textContent || "{}")));
  return {
    file: row,
    form: parsed,
    orgId: row.org_id,
    storageKey: row.storage_key || null,
    mime: row.mime || "application/octet-stream",
  };
}

function verifyLegacyToken(record, token) {
  return !!record?.form?.publicShare?.enabled && !!record?.form?.publicShare?.token && String(token || "") === String(record.form.publicShare.token || "");
}

function renderField(field) {
  const req = field.required ? "required" : "";
  if (field.type === "paragraph") {
    return `<textarea name="${htmlEscape(field.id)}" ${req} style="width:100%;min-height:110px;padding:12px;border-radius:10px;border:1px solid #2a2a2a;background:#101012;color:#fff;"></textarea>`;
  }
  if (field.type === "choice") {
    return `<div style="display:grid;gap:8px;">${field.options.map((option) => `<label style="display:flex;gap:8px;align-items:center;"><input type="radio" name="${htmlEscape(field.id)}" value="${htmlEscape(option)}" ${req} /><span>${htmlEscape(option)}</span></label>`).join("")}</div>`;
  }
  if (field.type === "checkbox") {
    return `<div style="display:grid;gap:8px;">${field.options.map((option) => `<label style="display:flex;gap:8px;align-items:center;"><input type="checkbox" name="${htmlEscape(field.id)}" value="${htmlEscape(option)}" /><span>${htmlEscape(option)}</span></label>`).join("")}</div>`;
  }
  if (field.type === "date") {
    return `<input type="date" name="${htmlEscape(field.id)}" ${req} style="width:100%;padding:12px;border-radius:10px;border:1px solid #2a2a2a;background:#101012;color:#fff;" />`;
  }
  return `<input type="text" name="${htmlEscape(field.id)}" ${req} style="width:100%;padding:12px;border-radius:10px;border:1px solid #2a2a2a;background:#101012;color:#fff;" />`;
}

function encryptedSubmitScript(form, recipient) {
  return `
const recipient = ${JSON.stringify(recipient)};
const fields = ${JSON.stringify(form.fields)};
const enc = new TextEncoder();
const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');
async function sealSubmission(content) {
  const id = crypto.randomUUID();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pair = await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
  const remote = await crypto.subtle.importKey('jwk',recipient.publicKey,{name:'ECDH',namedCurve:'P-256'},false,[]);
  const bits = await crypto.subtle.deriveBits({name:'ECDH',public:remote},pair.privateKey,256);
  const base = await crypto.subtle.importKey('raw',bits,'HKDF',false,['deriveKey']);
  const aad = JSON.stringify(['bondfire-private-content',1,recipient.orgId,'submission/drive-form',id]);
  const key = await crypto.subtle.deriveKey(
    {name:'HKDF',hash:'SHA-256',salt,info:enc.encode(JSON.stringify([aad,recipient.epoch]))},
    base,
    {name:'AES-GCM',length:256},
    false,
    ['encrypt']
  );
  const ciphertext = await crypto.subtle.encrypt(
    {name:'AES-GCM',iv,additionalData:enc.encode(aad)},
    key,
    enc.encode(JSON.stringify(content))
  );
  return {
    id,
    epoch: recipient.epoch,
    sender_pub: await crypto.subtle.exportKey('jwk',pair.publicKey),
    salt: b64(salt),
    ciphertext: JSON.stringify({v:2,alg:'A256GCM',aad,iv:b64(iv),ct:b64(ciphertext)}),
  };
}
formEl.addEventListener('submit', async (event) => {
  event.preventDefault();
  statusEl.textContent = 'Encrypting and submitting…';
  statusEl.className = 'small';
  const fd = new FormData(formEl);
  const answers = {};
  fields.forEach((field) => {
    if (field.type === 'checkbox') answers[field.id] = fd.getAll(field.id);
    else answers[field.id] = fd.get(field.id) || '';
  });
  try {
    const sealed = await sealSubmission({fileId:${JSON.stringify(String(recipient.fileId || ""))},submittedAt:Date.now(),source:'public',answers});
    const res = await fetch(window.location.pathname + window.location.search, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(sealed),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'SUBMIT_FAILED');
    formEl.reset();
    statusEl.textContent = 'Response submitted.';
    statusEl.className = 'small success';
  } catch (err) {
    statusEl.textContent = err.message || 'Submit failed';
    statusEl.className = 'small error';
  }
});`;
}

function legacySubmitScript(form, token) {
  return `
const fields = ${JSON.stringify(form.fields)};
formEl.addEventListener('submit', async (event) => {
  event.preventDefault();
  statusEl.textContent = 'Submitting…';
  statusEl.className = 'small';
  const fd = new FormData(formEl);
  const answers = {};
  fields.forEach((field) => {
    if (field.type === 'checkbox') answers[field.id] = fd.getAll(field.id);
    else answers[field.id] = fd.get(field.id) || '';
  });
  try {
    const res = await fetch(window.location.pathname + window.location.search, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: ${JSON.stringify(token)}, answers }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'SUBMIT_FAILED');
    formEl.reset();
    statusEl.textContent = 'Response submitted.';
    statusEl.className = 'small success';
  } catch (err) {
    statusEl.textContent = err.message || 'Submit failed';
    statusEl.className = 'small error';
  }
});`;
}

function publicFormHeaders(nonce) {
  return {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "private, max-age=0, no-store",
    "content-security-policy": `default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; script-src 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; form-action 'self'`,
  };
}

function renderPage(form, token, recipient = null, nonce = "") {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="referrer" content="no-referrer" />
<title>${htmlEscape(form.title)}</title>
<style>
body{margin:0;font-family:Inter,system-ui,sans-serif;background:#090909;color:#fff;padding:24px}
.shell{max-width:760px;margin:0 auto;background:#0f0f10;border:1px solid #222;border-radius:18px;padding:24px;box-shadow:0 18px 50px rgba(0,0,0,.38)}
.card{display:grid;gap:10px;padding:18px;border:1px solid #242424;border-radius:14px;background:#131315;margin-top:14px}
button{padding:12px 18px;border-radius:12px;border:1px solid #333;background:#17181c;color:#fff;font-weight:700;cursor:pointer}
.small{font-size:13px;color:#a8a8ad}.success{color:#9be7ac}.error{color:#ff9a9a}
.bf-public-form-markdown{font-size:15px;line-height:1.62;color:#d7d7dc}.bf-public-form-markdown h1,.bf-public-form-markdown h2,.bf-public-form-markdown h3,.bf-public-form-markdown h4,.bf-public-form-markdown h5,.bf-public-form-markdown h6{margin:18px 0 8px;color:#fff;line-height:1.25}.bf-public-form-markdown h1:first-child,.bf-public-form-markdown h2:first-child,.bf-public-form-markdown h3:first-child{margin-top:0}.bf-public-form-markdown p{margin:0 0 10px}.bf-public-form-markdown p:last-child{margin-bottom:0}.bf-public-form-markdown ul,.bf-public-form-markdown ol{margin:0 0 10px;padding-left:24px}.bf-public-form-markdown li{margin:0 0 4px}.bf-public-form-markdown blockquote{margin:0 0 10px;padding-left:12px;border-left:3px solid #555;color:#bbb}.bf-public-form-markdown strong{color:#fff}.bf-public-form-markdown code{background:#1c1c1f;padding:1px 4px;border-radius:4px}.bf-public-form-markdown a{color:#9ed0ff}.bf-public-form-markdown hr{border:0;border-top:1px solid #2b2b2f;margin:16px 0}
</style>
</head>
<body>
  <div class="shell">
    <h1 style="margin:0 0 8px 0;">${htmlEscape(form.title)}</h1>
    ${form.description ? `<div class="small bf-public-form-markdown" style="margin-bottom:8px;">${renderMarkdownText(form.description)}</div>` : ""}
    <form id="bf-public-form" style="display:grid;gap:14px;">
      ${form.fields.map((field, idx) => `<div class="card"><div style="font-weight:800;">${idx + 1}. ${htmlEscape(field.label)} ${field.required ? '<span style="color:#ff9a9a">*</span>' : ''}</div>${renderField(field)}</div>`).join("")}
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
        <button type="submit">Submit response</button>
        <div id="status" class="small"></div>
      </div>
    </form>
  </div>
<script nonce="${htmlEscape(nonce)}">
const formEl = document.getElementById('bf-public-form');
const statusEl = document.getElementById('status');
${recipient ? encryptedSubmitScript(form, recipient) : legacySubmitScript(form, token)}
</script>
</body>
</html>`;
}

async function projectedRecord(env, fileId, token) {
  const db = getDb(env);
  if (!db) return null;
  return readPublicDriveForm(db, fileId, token);
}

export async function onRequestGet({ env, request, params }) {
  const fileId = params.id;
  const token = new URL(request.url).searchParams.get("token") || "";
  const projected = await projectedRecord(env, fileId, token);
  if (projected?.forbidden) return bad(403, "FORBIDDEN");
  if (projected) {
    const wantsJson = new URL(request.url).searchParams.get("format") === "json" || String(request.headers.get("accept") || "").includes("application/json");
    if (wantsJson) return json({ ok: true, form: projected.form });
    const nonce = crypto.randomUUID().replace(/-/g, "");
    return new Response(renderPage(projected.form, token, { ...projected.recipient, fileId }, nonce), {
      headers: publicFormHeaders(nonce),
    });
  }

  const legacy = await getLegacyPublicForm(env, fileId);
  if (!legacy) return bad(404, "NOT_FOUND");
  if (!verifyLegacyToken(legacy, token)) return bad(403, "FORBIDDEN");
  const wantsJson = new URL(request.url).searchParams.get("format") === "json" || String(request.headers.get("accept") || "").includes("application/json");
  if (wantsJson) {
    return json({ ok: true, form: { title: legacy.form.title, description: legacy.form.description, fields: legacy.form.fields } });
  }
  const nonce = crypto.randomUUID().replace(/-/g, "");
  return new Response(renderPage(legacy.form, token, null, nonce), {
    headers: publicFormHeaders(nonce),
  });
}

export async function onRequestPost({ env, request, params }) {
  const fileId = params.id;
  const token = new URL(request.url).searchParams.get("token") || "";
  const projected = await projectedRecord(env, fileId, token);
  if (projected?.forbidden) return bad(403, "FORBIDDEN");
  if (projected) {
    const text = await request.text();
    if (text.length > 160 * 1024) return bad(413, "SUBMISSION_TOO_LARGE");
    let body;
    try { body = JSON.parse(text); } catch { return bad(400, "INVALID_ENCRYPTED_SUBMISSION"); }
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !["id", "epoch", "sender_pub", "salt", "ciphertext"].includes(key))) {
      return bad(400, "ENCRYPTED_SUBMISSION_REQUIRED");
    }
    try {
      const responseId = await storePublicDriveFormResponse(getDb(env), projected, body);
      return json({ ok: true, submitted: true, responseId });
    } catch (error) {
      const code = String(error?.message || "INVALID_ENCRYPTED_SUBMISSION");
      const status = code === "SUBMISSION_TOO_LARGE" ? 413 : code === "SUBMISSION_DUPLICATE" || code === "PUBLIC_FORM_KEY_CHANGED" ? 409 : 400;
      return bad(status, code);
    }
  }

  const legacy = await getLegacyPublicForm(env, fileId);
  if (!legacy) return bad(404, "NOT_FOUND");
  const body = await request.json().catch(() => ({}));
  if (!verifyLegacyToken(legacy, body?.token || token)) return bad(403, "FORBIDDEN");
  const answers = body && typeof body.answers === "object" && !Array.isArray(body.answers) ? body.answers : {};
  const missing = legacy.form.fields.find((field) => {
    if (!field.required) return false;
    const value = answers[field.id];
    if (field.type === "checkbox") return !Array.isArray(value) || !value.length;
    return !String(value || "").trim();
  });
  if (missing) return bad(400, "REQUIRED_FIELD_MISSING", { fieldId: missing.id, label: missing.label });
  const response = {
    id: uuid(),
    submittedAt: now(),
    source: "public",
    answers: legacy.form.fields.reduce((acc, field) => {
      const value = answers[field.id];
      acc[field.id] = field.type === "checkbox" ? (Array.isArray(value) ? value.map((x) => String(x || "")) : []) : String(value || "");
      return acc;
    }, {}),
  };
  const nextForm = { ...legacy.form, responses: [...legacy.form.responses, response] };
  const textContent = JSON.stringify(nextForm, null, 2);
  await saveFileBlob(env, {
    orgId: legacy.orgId,
    fileId,
    storageKey: legacy.storageKey,
    mime: legacy.mime,
    textContent,
    dataUrl: `data:${legacy.mime || "application/json"};base64,${btoa(unescape(encodeURIComponent(textContent)))}`,
  });
  await getDb(env).prepare(`UPDATE drive_files SET updated_at = ? WHERE id = ?`).bind(now(), fileId).run();
  return json({ ok: true, submitted: true, responseId: response.id });
}
