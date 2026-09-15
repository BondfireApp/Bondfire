import { bad, json, now, uuid } from "../../_lib/http.js";
import { ensureDriveSchema, getDb, loadFileBlob, saveFileBlob } from "../../_lib/drive.js";

function htmlEscape(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

function normalizeForm(input) {
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

async function getPublicForm(env, fileId) {
  await ensureDriveSchema(env);
  const db = getDb(env);
  const row = await db.prepare(`SELECT id, org_id, name, mime, storage_key FROM drive_files WHERE id = ?`).bind(fileId).first();
  if (!row) return null;
  const blob = await loadFileBlob(env, row.org_id, row.id, row.storage_key || null, row.mime || "application/octet-stream", row.name || "");
  const parsed = normalizeForm(JSON.parse(String(blob?.textContent || "{}")));
  return {
    file: row,
    form: parsed,
    orgId: row.org_id,
    storageKey: row.storage_key || null,
    mime: row.mime || "application/octet-stream",
  };
}

function verifyToken(record, token) {
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

function renderPage(fileId, form, token) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${htmlEscape(form.title)}</title>
<style>
body{margin:0;font-family:Inter,system-ui,sans-serif;background:#090909;color:#fff;padding:24px}
.shell{max-width:760px;margin:0 auto;background:#0f0f10;border:1px solid #222;border-radius:18px;padding:24px;box-shadow:0 18px 50px rgba(0,0,0,.38)}
.card{display:grid;gap:10px;padding:18px;border:1px solid #242424;border-radius:14px;background:#131315;margin-top:14px}
button{padding:12px 18px;border-radius:12px;border:1px solid #333;background:#17181c;color:#fff;font-weight:700;cursor:pointer}
.small{font-size:13px;color:#a8a8ad}
.success{color:#9be7ac}.error{color:#ff9a9a}
</style>
</head>
<body>
  <div class="shell">
    <h1 style="margin:0 0 8px 0;">${htmlEscape(form.title)}</h1>
    ${form.description ? `<div class="small" style="white-space:pre-wrap;margin-bottom:8px;">${htmlEscape(form.description)}</div>` : ""}
    <form id="bf-public-form" style="display:grid;gap:14px;">
      ${form.fields.map((field, idx) => `<div class="card"><div style="font-weight:800;">${idx + 1}. ${htmlEscape(field.label)} ${field.required ? '<span style="color:#ff9a9a">*</span>' : ''}</div>${renderField(field)}</div>`).join("")}
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
        <button type="submit">Submit response</button>
        <div id="status" class="small"></div>
      </div>
    </form>
  </div>
<script>
const formEl = document.getElementById('bf-public-form');
const statusEl = document.getElementById('status');
formEl.addEventListener('submit', async (event) => {
  event.preventDefault();
  statusEl.textContent = 'Submitting…';
  statusEl.className = 'small';
  const fd = new FormData(formEl);
  const answers = {};
  ${JSON.stringify(form.fields)}.forEach((field) => {
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
});
</script>
</body>
</html>`;
}

export async function onRequestGet({ env, request, params }) {
  const fileId = params.id;
  const token = new URL(request.url).searchParams.get("token") || "";
  const record = await getPublicForm(env, fileId);
  if (!record) return bad(404, "NOT_FOUND");
  if (!verifyToken(record, token)) return bad(403, "FORBIDDEN");
  const wantsJson = new URL(request.url).searchParams.get("format") === "json" || String(request.headers.get("accept") || "").includes("application/json");
  if (wantsJson) {
    return json({ ok: true, form: { title: record.form.title, description: record.form.description, fields: record.form.fields } });
  }
  return new Response(renderPage(fileId, record.form, token), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, max-age=0, no-store" } });
}

export async function onRequestPost({ env, request, params }) {
  const fileId = params.id;
  const record = await getPublicForm(env, fileId);
  if (!record) return bad(404, "NOT_FOUND");
  const body = await request.json().catch(() => ({}));
  if (!verifyToken(record, body?.token || "")) return bad(403, "FORBIDDEN");
  const answers = body && typeof body.answers === "object" && !Array.isArray(body.answers) ? body.answers : {};
  const missing = record.form.fields.find((field) => {
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
    answers: record.form.fields.reduce((acc, field) => {
      const value = answers[field.id];
      acc[field.id] = field.type === "checkbox" ? (Array.isArray(value) ? value.map((x) => String(x || "")) : []) : String(value || "");
      return acc;
    }, {}),
  };
  const nextForm = { ...record.form, responses: [...record.form.responses, response] };
  const textContent = JSON.stringify(nextForm, null, 2);
  await saveFileBlob(env, {
    orgId: record.orgId,
    fileId,
    storageKey: record.storageKey,
    mime: record.mime,
    textContent,
    dataUrl: `data:${record.mime || "application/json"};base64,${btoa(unescape(encodeURIComponent(textContent)))}`,
  });
  await getDb(env).prepare(`UPDATE drive_files SET updated_at = ? WHERE id = ?`).bind(now(), fileId).run();
  return json({ ok: true, submitted: true, responseId: response.id });
}
