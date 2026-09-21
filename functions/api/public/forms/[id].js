import { bad, json, now, uuid } from "../../_lib/http.js";
import { ensureDriveSchema, getDb, loadFileBlob, saveFileBlob } from "../../_lib/drive.js";
import { getPrivateMode } from "../../_lib/privateStore.js";
import { readPublicDriveForm, storePublicDriveFormResponse } from "../../_lib/publicDriveForms.js";

const FIELD_TYPES = new Set(["text", "paragraph", "choice", "checkbox", "date"]);
const CONDITION_OPERATORS = new Set(["equals", "not_equals", "contains", "not_empty"]);

function htmlEscape(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeHref(value) {
  const href = String(value || "").trim();
  if (!href || href.startsWith("//")) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^(https?|mailto|tel):/i.test(href)) return "";
  return href;
}

function renderMarkdownText(value) {
  const applyInline = (text) => {
    let html = htmlEscape(text);
    html = html.replace(/`([^`]+)`/gim, "<code>$1</code>");
    html = html.replace(/\*\*(.+?)\*\*/gim, "<strong>$1</strong>");
    html = html.replace(/\*(.+?)\*/gim, "<em>$1</em>");
    html = html.replace(/\[([^\]]+)\]\(([^\s)]+)\)/gim, (_match, label, rawHref) => {
      const href = safeHref(String(rawHref || "").replace(/&amp;/g, "&"));
      return href ? `<a href="${htmlEscape(href)}" target="_blank" rel="noopener noreferrer">${label}</a>` : label;
    });
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

function cleanText(value, max) {
  return String(value || "").slice(0, max);
}

function normalizeConditions(value) {
  return Array.isArray(value) ? value.slice(0, 20).map((condition) => ({
    sourceId: cleanText(condition?.sourceId, 160),
    operator: CONDITION_OPERATORS.has(String(condition?.operator || "")) ? String(condition.operator) : "equals",
    value: cleanText(condition?.value, 500),
  })).filter((condition) => condition.sourceId) : [];
}

function normalizeQuestion(field, index) {
  const fieldType = FIELD_TYPES.has(String(field?.fieldType || field?.type || ""))
    ? String(field.fieldType || field.type)
    : "text";
  return {
    id: cleanText(field?.id || `field_${index + 1}`, 160) || `field_${index + 1}`,
    type: "question",
    fieldType,
    label: cleanText(field?.label || `Question ${index + 1}`, 500),
    required: !!field?.required,
    options: Array.isArray(field?.options) ? field.options.slice(0, 100).map((option) => cleanText(option, 500)).filter(Boolean) : [],
    conditions: normalizeConditions(field?.conditions),
    conditionLogic: field?.conditionLogic === "any" ? "any" : "all",
  };
}

function normalizeBlock(block, index) {
  if (block?.type === "display" || block?.type === "text") return { id: cleanText(block?.id || `display_${index + 1}`, 160) || `display_${index + 1}`, type: "display", text: cleanText(block?.text ?? block?.content ?? "", 10000) };
  if (block?.type === "page-break" || block?.type === "pageBreak") return { id: cleanText(block?.id || `page_${index + 1}`, 160) || `page_${index + 1}`, type: "page-break", label: cleanText(block?.label || "Page break", 500) };
  return normalizeQuestion(block, index);
}

function normalizeLegacyForm(input) {
  const rawBlocks = Array.isArray(input?.blocks) && input.blocks.length
    ? input.blocks.slice(0, 200)
    : (Array.isArray(input?.fields) ? input.fields.slice(0, 100) : []);
  const ids = new Set();
  const blocks = rawBlocks.map(normalizeBlock).map((block, index) => {
    let id = block.id;
    while (ids.has(id)) id = `${block.type}_${index + 1}_${ids.size}`;
    ids.add(id);
    return { ...block, id };
  });
  return {
    type: "bondfire-form",
    version: 3,
    title: cleanText(input?.title || "Untitled form", 500),
    description: cleanText(input?.description || "", 10000),
    blocks,
    fields: blocks.filter((block) => block.type === "question"),
    responses: Array.isArray(input?.responses) ? input.responses.slice(0, 10000) : [],
    publicShare: { enabled: !!input?.publicShare?.enabled, token: String(input?.publicShare?.token || "") },
  };
}

function conditionMatches(condition, answers) {
  const answer = answers?.[condition.sourceId];
  const values = Array.isArray(answer) ? answer.map((value) => String(value)) : [String(answer ?? "")];
  const hasValue = Array.isArray(answer) ? answer.length > 0 : String(answer ?? "").trim() !== "";
  if (condition.operator === "not_empty") return hasValue;
  if (condition.operator === "equals") return values.includes(String(condition.value || ""));
  if (condition.operator === "not_equals") return !values.includes(String(condition.value || ""));
  if (condition.operator === "contains") return values.some((value) => value.toLowerCase().includes(String(condition.value || "").toLowerCase()));
  return false;
}

function isBlockVisible(block, answers) {
  const conditions = normalizeConditions(block?.conditions);
  if (!conditions.length) return true;
  const matches = conditions.map((condition) => conditionMatches(condition, answers));
  return block?.conditionLogic === "any" ? matches.some(Boolean) : matches.every(Boolean);
}

function collectVisibleAnswers(form, supplied) {
  const source = supplied && typeof supplied === "object" && !Array.isArray(supplied) ? supplied : {};
  const answers = {};
  for (const field of form.fields) {
    if (!isBlockVisible(field, answers)) continue;
    if (field.fieldType === "checkbox") {
      const raw = Array.isArray(source[field.id]) ? source[field.id] : source[field.id] === undefined ? [] : [source[field.id]];
      answers[field.id] = raw.slice(0, 100).map((value) => cleanText(value, 10000));
    } else {
      answers[field.id] = cleanText(source[field.id], 10000);
    }
  }
  return answers;
}

async function getLegacyPublicForm(env, fileId) {
  await ensureDriveSchema(env);
  const db = getDb(env);
  const row = await db.prepare(`SELECT id, org_id, name, mime, storage_key FROM drive_files WHERE id = ?`).bind(fileId).first();
  if (!row || await getPrivateMode(env, row.org_id)) return null;
  const blob = await loadFileBlob(env, row.org_id, row.id, row.storage_key || null, row.mime || "application/octet-stream", row.name || "");
  try {
    return { file: row, form: normalizeLegacyForm(JSON.parse(String(blob?.textContent || "{}"))), orgId: row.org_id, storageKey: row.storage_key || null, mime: row.mime || "application/octet-stream" };
  } catch {
    return null;
  }
}

function verifyLegacyToken(record, token) {
  return !!record?.form?.publicShare?.enabled && !!record?.form?.publicShare?.token && String(token || "") === String(record.form.publicShare.token || "");
}

function renderField(field) {
  const name = htmlEscape(field.id);
  const style = "width:100%;padding:12px;border-radius:10px;border:1px solid #2a2a2a;background:#101012;color:#fff;";
  if (field.fieldType === "paragraph") return `<textarea name="${name}" style="${style}min-height:110px;"></textarea>`;
  if (field.fieldType === "choice") return `<div style="display:grid;gap:8px;">${field.options.map((option) => `<label style="display:flex;gap:8px;align-items:center;"><input type="radio" name="${name}" value="${htmlEscape(option)}" /><span>${renderMarkdownText(option)}</span></label>`).join("")}</div>`;
  if (field.fieldType === "checkbox") return `<div style="display:grid;gap:8px;">${field.options.map((option) => `<label style="display:flex;gap:8px;align-items:center;"><input type="checkbox" name="${name}" value="${htmlEscape(option)}" /><span>${renderMarkdownText(option)}</span></label>`).join("")}</div>`;
  if (field.fieldType === "date") return `<input type="date" name="${name}" style="${style}" />`;
  return `<input type="text" name="${name}" style="${style}" />`;
}

function renderBlock(block, index) {
  const id = htmlEscape(block.id);
  if (block.type === "display") return `<section data-block-id="${id}" data-block-type="display" class="display bf-public-form-markdown">${renderMarkdownText(block.text)}</section>`;
  if (block.type === "page-break") return `<section data-block-id="${id}" data-block-type="page-break" class="page-break"><hr /><span>${htmlEscape(block.label || "Page break")}</span><hr /></section>`;
  return `<section data-block-id="${id}" data-block-type="question" class="card"><div style="font-weight:800;"><span data-question-number>${index + 1}</span>. <span class="bf-public-form-markdown inline">${renderMarkdownText(block.label)}</span>${block.required ? ' <span style="color:#ff9a9a">*</span>' : ""}</div>${renderField(block)}</section>`;
}

function safeJsonForScript(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

function formBehaviorScript(form) {
  return `
const blocks = ${safeJsonForScript(form.blocks)};
const fields = blocks.filter((block) => block.type === 'question');
function nodesFor(field) { return Array.from(formEl.elements).filter((element) => element.name === field.id); }
function readField(field) {
  const nodes = nodesFor(field);
  if (field.fieldType === 'checkbox') return nodes.filter((node) => node.checked).map((node) => node.value);
  if (field.fieldType === 'choice') return (nodes.find((node) => node.checked) || {}).value || '';
  return (nodes[0] || {}).value || '';
}
function conditionMatches(condition, answers) {
  const answer = answers[condition.sourceId];
  const values = Array.isArray(answer) ? answer.map(String) : [String(answer == null ? '' : answer)];
  const hasValue = Array.isArray(answer) ? answer.length > 0 : String(answer == null ? '' : answer).trim() !== '';
  if (condition.operator === 'not_empty') return hasValue;
  if (condition.operator === 'equals') return values.includes(String(condition.value || ''));
  if (condition.operator === 'not_equals') return !values.includes(String(condition.value || ''));
  if (condition.operator === 'contains') return values.some((value) => value.toLowerCase().includes(String(condition.value || '').toLowerCase()));
  return false;
}
function visible(block, answers) {
  const conditions = Array.isArray(block.conditions) ? block.conditions : [];
  if (!conditions.length) return true;
  const matches = conditions.map((condition) => conditionMatches(condition, answers));
  return block.conditionLogic === 'any' ? matches.some(Boolean) : matches.every(Boolean);
}
function blockElement(id) { return Array.from(document.querySelectorAll('[data-block-id]')).find((element) => element.dataset.blockId === String(id)) || null; }
function refreshVisibility() {
  const answers = {};
  let questionNumber = 0;
  blocks.forEach((block) => {
    const section = blockElement(block.id);
    if (!section) return;
    const isVisible = visible(block, answers);
    section.hidden = !isVisible;
    nodesFor(block).forEach((node) => { node.disabled = !isVisible; });
    if (isVisible && block.type === 'question') {
      questionNumber += 1;
      const number = section.querySelector('[data-question-number]');
      if (number) number.textContent = questionNumber;
      answers[block.id] = readField(block);
    }
  });
}
function collectAnswers() {
  const answers = {};
  fields.forEach((field) => {
    const section = blockElement(field.id);
    if (section && !section.hidden) answers[field.id] = readField(field);
  });
  return answers;
}
function firstMissing(answers) {
  return fields.find((field) => {
    const section = blockElement(field.id);
    if (!field.required || !section || section.hidden) return false;
    const value = answers[field.id];
    return field.fieldType === 'checkbox' ? !Array.isArray(value) || !value.length : !String(value || '').trim();
  });
}
formEl.addEventListener('change', refreshVisibility);
refreshVisibility();`;
}

function encryptedSubmitScript(form, recipient) {
  return `${formBehaviorScript(form)}
const recipient = ${safeJsonForScript(recipient)};
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
  const key = await crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt,info:enc.encode(JSON.stringify([aad,recipient.epoch]))},base,{name:'AES-GCM',length:256},false,['encrypt']);
  const ciphertext = await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(aad)},key,enc.encode(JSON.stringify(content)));
  return { id, epoch: recipient.epoch, sender_pub: await crypto.subtle.exportKey('jwk',pair.publicKey), salt: b64(salt), ciphertext: JSON.stringify({v:2,alg:'A256GCM',aad,iv:b64(iv),ct:b64(ciphertext)}) };
}
formEl.addEventListener('submit', async (event) => {
  event.preventDefault();
  refreshVisibility();
  const answers = collectAnswers();
  const missing = firstMissing(answers);
  if (missing) { statusEl.textContent = 'Missing required field: ' + missing.label; statusEl.className = 'small error'; return; }
  statusEl.textContent = 'Encrypting and submitting…'; statusEl.className = 'small';
  try {
    const sealed = await sealSubmission({fileId:${safeJsonForScript(String(recipient.fileId || ""))},submittedAt:Date.now(),source:'public',answers});
    const res = await fetch(window.location.pathname + window.location.search,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(sealed)});
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'SUBMIT_FAILED');
    formEl.reset(); refreshVisibility(); statusEl.textContent = 'Response submitted.'; statusEl.className = 'small success';
  } catch (error) { statusEl.textContent = error.message || 'Submit failed'; statusEl.className = 'small error'; }
});`;
}

function legacySubmitScript(form, token) {
  return `${formBehaviorScript(form)}
formEl.addEventListener('submit', async (event) => {
  event.preventDefault();
  refreshVisibility();
  const answers = collectAnswers();
  const missing = firstMissing(answers);
  if (missing) { statusEl.textContent = 'Missing required field: ' + missing.label; statusEl.className = 'small error'; return; }
  statusEl.textContent = 'Submitting…'; statusEl.className = 'small';
  try {
    const res = await fetch(window.location.pathname + window.location.search,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:${safeJsonForScript(token)},answers})});
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'SUBMIT_FAILED');
    formEl.reset(); refreshVisibility(); statusEl.textContent = 'Response submitted.'; statusEl.className = 'small success';
  } catch (error) { statusEl.textContent = error.message || 'Submit failed'; statusEl.className = 'small error'; }
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
<html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="referrer" content="no-referrer" /><title>${htmlEscape(form.title)}</title>
<style>
body{margin:0;font-family:Inter,system-ui,sans-serif;background:#090909;color:#fff;padding:24px}.shell{max-width:760px;margin:0 auto;background:#0f0f10;border:1px solid #222;border-radius:18px;padding:24px;box-shadow:0 18px 50px rgba(0,0,0,.38)}.card{display:grid;gap:10px;padding:18px;border:1px solid #242424;border-radius:14px;background:#131315}.display{padding:4px 2px}.page-break{display:flex;align-items:center;gap:10px;padding:8px 0;color:#a8a8ad}.page-break hr{flex:1;border:0;border-top:1px solid #38383d}.page-break span{font-size:13px;white-space:nowrap}button{padding:12px 18px;border-radius:12px;border:1px solid #333;background:#17181c;color:#fff;font-weight:700;cursor:pointer}.small{font-size:13px;color:#a8a8ad}.success{color:#9be7ac}.error{color:#ff9a9a}[hidden]{display:none!important}.bf-public-form-markdown{font-size:15px;line-height:1.62;color:#d7d7dc}.bf-public-form-markdown.inline{display:inline}.bf-public-form-markdown.inline p{display:inline;margin:0}.bf-public-form-markdown h1,.bf-public-form-markdown h2,.bf-public-form-markdown h3,.bf-public-form-markdown h4,.bf-public-form-markdown h5,.bf-public-form-markdown h6{margin:18px 0 8px;color:#fff;line-height:1.25}.bf-public-form-markdown h1:first-child,.bf-public-form-markdown h2:first-child,.bf-public-form-markdown h3:first-child{margin-top:0}.bf-public-form-markdown p{margin:0 0 10px}.bf-public-form-markdown p:last-child{margin-bottom:0}.bf-public-form-markdown ul,.bf-public-form-markdown ol{margin:0 0 10px;padding-left:24px}.bf-public-form-markdown li{margin:0 0 4px}.bf-public-form-markdown blockquote{margin:0 0 10px;padding-left:12px;border-left:3px solid #555;color:#bbb}.bf-public-form-markdown strong{color:#fff}.bf-public-form-markdown code{background:#1c1c1f;padding:1px 4px;border-radius:4px}.bf-public-form-markdown a{color:#9ed0ff}.bf-public-form-markdown hr{border:0;border-top:1px solid #2b2b2f;margin:16px 0}
</style></head><body><div class="shell"><h1 style="margin:0 0 8px 0;">${htmlEscape(form.title)}</h1>${form.description ? `<div class="small bf-public-form-markdown" style="margin-bottom:8px;">${renderMarkdownText(form.description)}</div>` : ""}<form id="bf-public-form" style="display:grid;gap:14px;">${form.blocks.map(renderBlock).join("")}<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;"><button type="submit">Submit response</button><div id="status" class="small" role="status"></div></div></form></div><script nonce="${htmlEscape(nonce)}">const formEl=document.getElementById('bf-public-form');const statusEl=document.getElementById('status');${recipient ? encryptedSubmitScript(form, recipient) : legacySubmitScript(form, token)}</script></body></html>`;
}

async function projectedRecord(env, fileId, token) {
  const db = getDb(env);
  return db ? readPublicDriveForm(db, fileId, token) : null;
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
    return new Response(renderPage(projected.form, token, { ...projected.recipient, fileId }, nonce), { headers: publicFormHeaders(nonce) });
  }
  const legacy = await getLegacyPublicForm(env, fileId);
  if (!legacy) return bad(404, "NOT_FOUND");
  if (!verifyLegacyToken(legacy, token)) return bad(403, "FORBIDDEN");
  const wantsJson = new URL(request.url).searchParams.get("format") === "json" || String(request.headers.get("accept") || "").includes("application/json");
  if (wantsJson) return json({ ok: true, form: { title: legacy.form.title, description: legacy.form.description, blocks: legacy.form.blocks, fields: legacy.form.fields } });
  const nonce = crypto.randomUUID().replace(/-/g, "");
  return new Response(renderPage(legacy.form, token, null, nonce), { headers: publicFormHeaders(nonce) });
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
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !["id", "epoch", "sender_pub", "salt", "ciphertext"].includes(key))) return bad(400, "ENCRYPTED_SUBMISSION_REQUIRED");
    try {
      const responseId = await storePublicDriveFormResponse(getDb(env), projected, body);
      return json({ ok: true, submitted: true, responseId });
    } catch (error) {
      const code = String(error?.message || "INVALID_ENCRYPTED_SUBMISSION");
      return bad(code === "SUBMISSION_TOO_LARGE" ? 413 : code === "SUBMISSION_DUPLICATE" || code === "PUBLIC_FORM_KEY_CHANGED" ? 409 : 400, code);
    }
  }
  const legacy = await getLegacyPublicForm(env, fileId);
  if (!legacy) return bad(404, "NOT_FOUND");
  const text = await request.text();
  if (text.length > 160 * 1024) return bad(413, "SUBMISSION_TOO_LARGE");
  let body;
  try { body = JSON.parse(text); } catch { return bad(400, "INVALID_SUBMISSION"); }
  if (!verifyLegacyToken(legacy, body?.token || token)) return bad(403, "FORBIDDEN");
  const answers = collectVisibleAnswers(legacy.form, body?.answers);
  const missing = legacy.form.fields.find((field) => field.required && isBlockVisible(field, answers) && (field.fieldType === "checkbox" ? !Array.isArray(answers[field.id]) || !answers[field.id].length : !String(answers[field.id] || "").trim()));
  if (missing) return bad(400, "REQUIRED_FIELD_MISSING", { fieldId: missing.id, label: missing.label });
  const response = { id: uuid(), submittedAt: now(), source: "public", answers };
  const nextForm = { ...legacy.form, responses: [...legacy.form.responses, response] };
  const textContent = JSON.stringify(nextForm, null, 2);
  await saveFileBlob(env, { orgId: legacy.orgId, fileId, storageKey: legacy.storageKey, mime: legacy.mime, textContent, dataUrl: `data:${legacy.mime || "application/json"};base64,${btoa(unescape(encodeURIComponent(textContent)))}` });
  await getDb(env).prepare(`UPDATE drive_files SET updated_at = ? WHERE id = ?`).bind(now(), fileId).run();
  return json({ ok: true, submitted: true, responseId: response.id });
}
