import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../utils/api.js";
import { makeSubmissionRecipient, openSubmission } from "../../../shared/privateSubmission.js";
import { markdownToHtml } from "./NotePreview.jsx";

const FIELD_TYPES = ["text", "paragraph", "choice", "checkbox", "date"];
const CONDITION_OPERATORS = ["equals", "not_equals", "contains", "not_empty"];
const DEFAULT_FORM = {
  type: "bondfire-form",
  version: 3,
  title: "Untitled form",
  description: "",
  blocks: [
    { id: "field_1", type: "question", fieldType: "text", label: "Your name", required: false, options: [] },
    { id: "field_2", type: "question", fieldType: "paragraph", label: "Details", required: false, options: [] },
  ],
  fields: [],
  responses: [],
  publicShare: { enabled: false, token: "", recipientEpoch: 1, recipientPublicKey: null, recipientPrivateKey: null },
};

function makeToken() {
  return `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function makeBlockId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function safeParse(value) {
  try {
    const parsed = JSON.parse(String(value || ""));
    if (parsed && parsed.type === "bondfire-form") return parsed;
  } catch {}
  return DEFAULT_FORM;
}

function normalizeConditions(value) {
  return Array.isArray(value)
    ? value.slice(0, 20).map((condition) => ({
      sourceId: String(condition?.sourceId || "").slice(0, 160),
      operator: CONDITION_OPERATORS.includes(String(condition?.operator || "")) ? String(condition.operator) : "equals",
      value: String(condition?.value || "").slice(0, 500),
    })).filter((condition) => condition.sourceId)
    : [];
}

function conditionMatches(condition, answers) {
  const answer = answers?.[condition.sourceId];
  const values = Array.isArray(answer) ? answer.map((item) => String(item)) : [String(answer ?? "")];
  const hasValue = Array.isArray(answer) ? answer.length > 0 : String(answer ?? "").trim() !== "";
  if (condition.operator === "not_empty") return hasValue;
  if (condition.operator === "equals") return values.includes(String(condition.value || ""));
  if (condition.operator === "not_equals") return !values.includes(String(condition.value || ""));
  if (condition.operator === "contains") return values.some((item) => item.toLowerCase().includes(String(condition.value || "").toLowerCase()));
  return false;
}

function isBlockVisible(block, answers) {
  const conditions = normalizeConditions(block?.conditions);
  if (!conditions.length) return true;
  const matches = conditions.map((condition) => conditionMatches(condition, answers));
  return block?.conditionLogic === "any" ? matches.some(Boolean) : matches.every(Boolean);
}

function normalizeQuestion(value, index) {
  const fieldType = FIELD_TYPES.includes(String(value?.fieldType || value?.type || ""))
    ? String(value.fieldType || value.type)
    : "text";
  return {
    id: String(value?.id || `field_${index + 1}`).slice(0, 160),
    type: "question",
    fieldType,
    label: String(value?.label || `Question ${index + 1}`).slice(0, 500),
    required: !!value?.required,
    options: Array.isArray(value?.options) ? value.options.slice(0, 100).map((item) => String(item || "").slice(0, 500)).filter(Boolean) : [],
    conditions: normalizeConditions(value?.conditions),
    conditionLogic: value?.conditionLogic === "any" ? "any" : "all",
  };
}

function normalizeBlock(value, index) {
  if (value?.type === "display" || value?.type === "text") {
    return { id: String(value?.id || `display_${index + 1}`).slice(0, 160), type: "display", text: String(value?.text ?? value?.content ?? "").slice(0, 10000) };
  }
  if (value?.type === "page-break" || value?.type === "pageBreak") {
    return { id: String(value?.id || `page_${index + 1}`).slice(0, 160), type: "page-break", label: String(value?.label || "Page break").slice(0, 500) };
  }
  return normalizeQuestion(value, index);
}

function normalizeResponse(response, index = 0) {
  return {
    id: String(response?.id || `resp_${index + 1}`),
    submittedAt: Number(response?.submittedAt || Date.now()),
    source: String(response?.source || "internal"),
    answers: response && typeof response.answers === "object" && !Array.isArray(response.answers) ? response.answers : {},
  };
}

function normalizeForm(input) {
  const rawBlocks = Array.isArray(input?.blocks) && input.blocks.length
    ? input.blocks
    : (Array.isArray(input?.fields) && input.fields.length ? input.fields : DEFAULT_FORM.blocks);
  const ids = new Set();
  const blocks = rawBlocks.slice(0, 200).map(normalizeBlock).map((block, index) => {
    let id = block.id || `${block.type}_${index + 1}`;
    while (ids.has(id)) id = `${block.type}_${index + 1}_${ids.size}`;
    ids.add(id);
    return { ...block, id };
  });
  const fields = blocks.filter((block) => block.type === "question").map(normalizeQuestion);
  return {
    type: "bondfire-form",
    version: 3,
    title: String(input?.title || "Untitled form"),
    description: String(input?.description || ""),
    blocks,
    fields,
    responses: Array.isArray(input?.responses) ? input.responses.map(normalizeResponse) : [],
    publicShare: {
      enabled: !!input?.publicShare?.enabled,
      token: String(input?.publicShare?.token || ""),
      recipientEpoch: Number.isSafeInteger(Number(input?.publicShare?.recipientEpoch)) && Number(input.publicShare.recipientEpoch) > 0 ? Number(input.publicShare.recipientEpoch) : 1,
      recipientPublicKey: input?.publicShare?.recipientPublicKey && typeof input.publicShare.recipientPublicKey === "object" ? input.publicShare.recipientPublicKey : null,
      recipientPrivateKey: input?.publicShare?.recipientPrivateKey && typeof input.publicShare.recipientPrivateKey === "object" ? input.publicShare.recipientPrivateKey : null,
    },
  };
}

function serialize(form) {
  return JSON.stringify(normalizeForm(form), null, 2);
}

function MarkdownContent({ value, className = "" }) {
  return <div className={className} dangerouslySetInnerHTML={{ __html: markdownToHtml(value) }} />;
}

function FieldPreview({ field, answer, onAnswerChange, readOnly = false }) {
  if (field.fieldType === "paragraph") return <textarea disabled={readOnly} className="input" value={String(answer || "")} onChange={(event) => onAnswerChange?.(event.target.value)} placeholder="Long answer" style={{ width: "100%", minHeight: 88, padding: 8, resize: "vertical" }} />;
  if (field.fieldType === "choice") return <div style={{ display: "grid", gap: 8 }}>{field.options.map((option, index) => <label key={`${field.id}-${index}`} style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="radio" disabled={readOnly} name={field.id} checked={String(answer || "") === option} onChange={() => onAnswerChange?.(option)} /><MarkdownContent value={option} className="bf-form-option" /></label>)}</div>;
  if (field.fieldType === "checkbox") {
    const selected = Array.isArray(answer) ? answer.map(String) : [];
    return <div style={{ display: "grid", gap: 8 }}>{field.options.map((option, index) => <label key={`${field.id}-${index}`} style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" disabled={readOnly} checked={selected.includes(option)} onChange={(event) => onAnswerChange?.(event.target.checked ? [...selected, option] : selected.filter((item) => item !== option))} /><MarkdownContent value={option} className="bf-form-option" /></label>)}</div>;
  }
  if (field.fieldType === "date") return <input disabled={readOnly} className="input" type="date" value={String(answer || "")} onChange={(event) => onAnswerChange?.(event.target.value)} style={{ width: "100%", padding: 8 }} />;
  return <input disabled={readOnly} className="input" type="text" value={String(answer || "")} onChange={(event) => onAnswerChange?.(event.target.value)} placeholder="Short answer" style={{ width: "100%", padding: 8 }} />;
}

function responseValue(value) {
  return Array.isArray(value) ? value.map((item) => String(item || "")).filter(Boolean).join(", ") : String(value ?? "");
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function ButtonRow({ onMoveUp, onMoveDown, onDelete, first, last }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 5 }}><button className="btn" type="button" onClick={onMoveUp} disabled={first} title="Move up">↑</button><button className="btn" type="button" onClick={onMoveDown} disabled={last} title="Move down">↓</button><button className="btn" type="button" onClick={onDelete} style={{ color: "#ff9a9a" }}>Delete</button></div>;
}

export default function FormFileView({ value, onChange, mode = "edit", fileId = "", orgId = "", saveStatus = "saved", onBeforePublicUse }) {
  const form = useMemo(() => normalizeForm(safeParse(value)), [value]);
  const readOnly = mode === "preview";
  const [draftAnswers, setDraftAnswers] = useState({});
  const [responseStatus, setResponseStatus] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const [remoteResponses, setRemoteResponses] = useState([]);
  const [remoteResponseStatus, setRemoteResponseStatus] = useState("");
  const [insertAt, setInsertAt] = useState(null);
  const recipientProvisioning = useRef(false);

  useEffect(() => {
    if (!copyStatus) return undefined;
    const timer = window.setTimeout(() => setCopyStatus(""), 1800);
    return () => window.clearTimeout(timer);
  }, [copyStatus]);

  useEffect(() => {
    if (readOnly || !form.publicShare.enabled || !onChange || (form.publicShare.recipientPublicKey && form.publicShare.recipientPrivateKey) || recipientProvisioning.current) return undefined;
    recipientProvisioning.current = true;
    let alive = true;
    (async () => {
      try {
        const recipient = await makeSubmissionRecipient();
        if (alive) onChange(serialize({ ...form, publicShare: { ...form.publicShare, recipientEpoch: 1, recipientPublicKey: recipient.publicKey, recipientPrivateKey: recipient.privateKey } }));
      } catch {
        if (alive) setCopyStatus("Could not initialize encrypted public responses");
      } finally {
        recipientProvisioning.current = false;
      }
    })();
    return () => { alive = false; };
  }, [readOnly, form.publicShare.enabled, form.publicShare.recipientPublicKey, form.publicShare.recipientPrivateKey, onChange]);

  async function loadPublicResponses() {
    if (!orgId || !fileId || !form.publicShare.recipientPrivateKey) {
      setRemoteResponses([]);
      return;
    }
    setRemoteResponseStatus("Loading encrypted public responses…");
    try {
      const data = await api(`/api/orgs/${encodeURIComponent(orgId)}/drive/forms-public?fileId=${encodeURIComponent(fileId)}`);
      const opened = [];
      for (const row of Array.isArray(data?.responses) ? data.responses : []) {
        try {
          const clear = await openSubmission(orgId, row, form.publicShare.recipientPrivateKey);
          if (String(clear?.fileId || "") !== String(fileId)) continue;
          opened.push(normalizeResponse({ id: row.id, submittedAt: Number(clear?.submittedAt || row.created_at || Date.now()), source: "public", answers: clear?.answers || {} }, opened.length));
        } catch {}
      }
      setRemoteResponses(opened);
      setRemoteResponseStatus("");
    } catch (error) {
      setRemoteResponses([]);
      setRemoteResponseStatus(String(error?.message || error || "Could not load public responses."));
    }
  }

  const responseKeyFingerprint = JSON.stringify(form.publicShare.recipientPrivateKey || null);
  useEffect(() => { void loadPublicResponses(); }, [orgId, fileId, responseKeyFingerprint]);

  const publicUrl = form.publicShare.enabled && form.publicShare.token && form.publicShare.recipientPublicKey && form.publicShare.recipientPrivateKey && fileId
    ? `${window.location.origin}/api/public/forms/${encodeURIComponent(fileId)}?token=${encodeURIComponent(form.publicShare.token)}`
    : "";
  const editorUrl = fileId && orgId ? `${window.location.origin}/app/#/org/${encodeURIComponent(orgId)}/drive?file=${encodeURIComponent(fileId)}` : "";
  const allResponses = useMemo(() => {
    const unique = new Map();
    for (const response of [...form.responses, ...remoteResponses]) unique.set(response.id, response);
    return [...unique.values()].sort((left, right) => Number(right.submittedAt || 0) - Number(left.submittedAt || 0));
  }, [form.responses, remoteResponses]);
  const visibleFormState = useMemo(() => {
    const answers = {};
    const visibleIds = new Set();
    form.blocks.forEach((block) => {
      if (!isBlockVisible(block, answers)) return;
      visibleIds.add(block.id);
      if (block.type === "question") answers[block.id] = draftAnswers[block.id];
    });
    return { visibleIds, fields: form.fields.filter((field) => visibleIds.has(field.id)) };
  }, [form.blocks, form.fields, draftAnswers]);

  const commit = (next) => onChange?.(serialize(next));
  const setFormProp = (key, nextValue) => commit({ ...form, [key]: nextValue });
  const setBlock = (blockId, patch) => commit({ ...form, blocks: form.blocks.map((block) => block.id === blockId ? { ...block, ...patch } : block) });
  const removeBlock = (blockId) => commit({ ...form, blocks: form.blocks.filter((block) => block.id !== blockId) });
  const moveBlock = (index, direction) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= form.blocks.length) return;
    const blocks = [...form.blocks];
    [blocks[index], blocks[nextIndex]] = [blocks[nextIndex], blocks[index]];
    commit({ ...form, blocks });
  };
  const addBlockAt = (kind, index) => {
    const block = kind === "question"
      ? { id: makeBlockId("field"), type: "question", fieldType: "text", label: "Untitled question", required: false, options: [], conditions: [], conditionLogic: "all" }
      : kind === "display"
        ? { id: makeBlockId("display"), type: "display", text: "Display text" }
        : { id: makeBlockId("page"), type: "page-break", label: "Page break" };
    const blocks = [...form.blocks];
    blocks.splice(index, 0, block);
    commit({ ...form, blocks });
    setInsertAt(null);
  };
  const setDraftAnswer = (id, nextValue) => {
    setResponseStatus("");
    setDraftAnswers((previous) => ({ ...previous, [id]: nextValue }));
  };

  const togglePublicShare = async (enabled) => {
    let publicShare = { ...form.publicShare, enabled, token: enabled ? (form.publicShare.token || makeToken()) : form.publicShare.token };
    if (enabled && (!publicShare.recipientPublicKey || !publicShare.recipientPrivateKey)) {
      try {
        const recipient = await makeSubmissionRecipient();
        publicShare = { ...publicShare, recipientEpoch: 1, recipientPublicKey: recipient.publicKey, recipientPrivateKey: recipient.privateKey };
      } catch {
        setCopyStatus("Could not initialize encrypted public responses");
        return;
      }
    }
    commit({ ...form, publicShare });
  };
  const regeneratePublicLink = () => {
    commit({ ...form, publicShare: { ...form.publicShare, enabled: true, token: makeToken() } });
    setCopyStatus("New link generated");
  };
  const ensurePublicFormSaved = async () => {
    if (!onBeforePublicUse) return saveStatus === "saved";
    try { return (await onBeforePublicUse()) !== false; } catch { return false; }
  };
  const copyPublicUrl = async () => {
    if (!publicUrl) return;
    if (!await ensurePublicFormSaved()) { setCopyStatus("Save failed; public link was not copied"); return; }
    try { await navigator.clipboard.writeText(publicUrl); setCopyStatus("Link copied"); } catch { setCopyStatus("Copy failed"); }
  };
  const openPublicUrl = async () => {
    if (!publicUrl) return;
    const popup = window.open("about:blank", "_blank");
    if (popup) {
      try {
        popup.opener = null;
        popup.document.title = "Preparing public form";
        popup.document.body.style.cssText = "margin:0;background:#090909;color:#fff;font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;padding:24px";
        popup.document.body.textContent = "Preparing encrypted public form…";
      } catch {}
    }
    if (!await ensurePublicFormSaved()) {
      if (popup) {
        try { popup.document.body.textContent = "The public form could not be prepared. Return to Bondfire and try again."; } catch {}
      }
      setCopyStatus("Public form could not be prepared");
      return;
    }
    if (popup) { popup.opener = null; popup.location.replace(publicUrl); } else window.open(publicUrl, "_blank", "noopener,noreferrer");
  };
  const downloadResponses = () => {
    const headers = ["Submitted", "Source", ...form.fields.map((field) => field.label)];
    const rows = allResponses.map((response) => [response.submittedAt ? new Date(response.submittedAt).toISOString() : "", response.source === "public" ? "Public" : "Internal", ...form.fields.map((field) => responseValue(response.answers?.[field.id]))]);
    const blob = new Blob([[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${String(form.title || "form").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "form"}-responses.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const submitResponse = () => {
    const visibleFields = visibleFormState.fields;
    const missing = visibleFields.find((field) => field.required && (field.fieldType === "checkbox" ? !Array.isArray(draftAnswers[field.id]) || !draftAnswers[field.id].length : !String(draftAnswers[field.id] || "").trim()));
    if (missing) { setResponseStatus(`Missing required field: ${missing.label}`); return; }
    const answers = visibleFields.reduce((result, field) => {
      result[field.id] = field.fieldType === "checkbox" ? (Array.isArray(draftAnswers[field.id]) ? draftAnswers[field.id] : []) : String(draftAnswers[field.id] || "");
      return result;
    }, {});
    commit({ ...form, responses: [...form.responses, normalizeResponse({ id: `resp_${Date.now()}`, submittedAt: Date.now(), source: "internal", answers }, form.responses.length)] });
    setDraftAnswers({});
    setResponseStatus("Response submitted.");
  };

  const renderEditorBlock = (block, index) => {
    const controls = <ButtonRow onMoveUp={() => moveBlock(index, -1)} onMoveDown={() => moveBlock(index, 1)} onDelete={() => removeBlock(block.id)} first={index === 0} last={index === form.blocks.length - 1} />;
    if (block.type === "display") return <div key={block.id} style={{ background: "rgba(255,255,255,0.02)", border: "1px solid #1f1f1f", borderRadius: 10, padding: 12, display: "grid", gap: 8 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}><strong>Display text</strong>{controls}</div><textarea className="input" value={block.text} onChange={(event) => setBlock(block.id, { text: event.target.value })} placeholder="Markdown text shown to respondents" style={{ minHeight: 100, padding: 10, resize: "vertical" }} /><div className="helper">Markdown is supported.</div></div>;
    if (block.type === "page-break") return <div key={block.id} style={{ border: "1px dashed rgba(255,255,255,0.25)", borderRadius: 10, padding: 10, display: "flex", alignItems: "center", gap: 10 }}><hr style={{ flex: 1, border: 0, borderTop: "1px solid rgba(255,255,255,0.2)" }} /><span className="helper">{block.label || "Page break"}</span><hr style={{ flex: 1, border: 0, borderTop: "1px solid rgba(255,255,255,0.2)" }} />{controls}</div>;
    const field = normalizeQuestion(block, index);
    const conditions = field.conditions;
    const sources = form.blocks.slice(0, index).filter((candidate) => candidate.type === "question").map((candidate, candidateIndex) => normalizeQuestion(candidate, candidateIndex));
    const setConditions = (nextConditions) => setBlock(block.id, { conditions: nextConditions });
    return <div key={block.id} style={{ background: "rgba(255,255,255,0.02)", border: "1px solid #1f1f1f", borderRadius: 10, padding: 12, display: "grid", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, flexWrap: "wrap" }}><textarea className="input" value={field.label} onChange={(event) => setBlock(block.id, { label: event.target.value })} placeholder="Question (Markdown supported)" style={{ flex: 1, minWidth: 220, minHeight: 42, padding: "8px 10px", resize: "vertical" }} /><select className="input" value={field.fieldType} onChange={(event) => { const fieldType = event.target.value; setBlock(block.id, { fieldType, options: ["choice", "checkbox"].includes(fieldType) ? (field.options.length ? field.options : ["Option 1", "Option 2"]) : [] }); }} style={{ width: 160, padding: "8px 10px" }}><option value="text">Text</option><option value="paragraph">Paragraph</option><option value="choice">Choice</option><option value="checkbox">Checkbox</option><option value="date">Date</option></select><label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}><input type="checkbox" checked={field.required} onChange={(event) => setBlock(block.id, { required: event.target.checked })} />Required</label>{controls}</div>
      {["choice", "checkbox"].includes(field.fieldType) ? <div style={{ display: "grid", gap: 6 }}><div className="helper">Options</div>{field.options.map((option, optionIndex) => <div key={`${block.id}-option-${optionIndex}`} style={{ display: "flex", gap: 6 }}><input className="input" value={option} onChange={(event) => setBlock(block.id, { options: field.options.map((item, itemIndex) => itemIndex === optionIndex ? event.target.value : item) })} placeholder={`Option ${optionIndex + 1}`} style={{ flex: 1, padding: "7px 9px" }} /><button className="btn" type="button" onClick={() => setBlock(block.id, { options: field.options.filter((_item, itemIndex) => itemIndex !== optionIndex) })} aria-label={`Delete option ${optionIndex + 1}`}>×</button></div>)}<button className="btn" type="button" onClick={() => setBlock(block.id, { options: [...field.options, `Option ${field.options.length + 1}`] })} style={{ justifySelf: "start" }}>+ Add option</button></div> : null}
      <details open={conditions.length > 0} style={{ borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: 8 }}><summary style={{ cursor: "pointer", fontWeight: 700 }}>Conditional visibility {conditions.length ? `(${conditions.length})` : "(optional)"}</summary><div style={{ display: "grid", gap: 6, marginTop: 8 }}>{conditions.map((condition, conditionIndex) => { const source = sources.find((candidate) => candidate.id === condition.sourceId); const options = ["choice", "checkbox"].includes(source?.fieldType) ? source.options : []; return <div key={`${block.id}-condition-${conditionIndex}`} style={{ display: "grid", gridTemplateColumns: "minmax(120px,1fr) minmax(120px,.8fr) minmax(120px,1fr) auto", gap: 6, alignItems: "center" }}><select className="input" value={condition.sourceId} onChange={(event) => setConditions(conditions.map((item, itemIndex) => itemIndex === conditionIndex ? { ...item, sourceId: event.target.value, value: "" } : item))}>{sources.map((candidate) => <option key={candidate.id} value={candidate.id}>{String(candidate.label || candidate.id).slice(0, 80)}</option>)}</select><select className="input" value={condition.operator} onChange={(event) => setConditions(conditions.map((item, itemIndex) => itemIndex === conditionIndex ? { ...item, operator: event.target.value, value: event.target.value === "not_empty" ? "" : item.value } : item))}><option value="equals">equals</option><option value="not_equals">does not equal</option><option value="contains">contains</option><option value="not_empty">is filled in</option></select>{condition.operator === "not_empty" ? <span className="helper">—</span> : options.length ? <select className="input" value={condition.value} onChange={(event) => setConditions(conditions.map((item, itemIndex) => itemIndex === conditionIndex ? { ...item, value: event.target.value } : item))}><option value="">Choose…</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select> : <input className="input" value={condition.value} onChange={(event) => setConditions(conditions.map((item, itemIndex) => itemIndex === conditionIndex ? { ...item, value: event.target.value } : item))} placeholder="Value" />}<button className="btn" type="button" onClick={() => setConditions(conditions.filter((_item, itemIndex) => itemIndex !== conditionIndex))} aria-label="Delete condition">×</button></div>; })}<div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>{conditions.length > 1 ? <select className="input" value={field.conditionLogic} onChange={(event) => setBlock(block.id, { conditionLogic: event.target.value })}><option value="all">All conditions must match</option><option value="any">Any condition may match</option></select> : null}<button className="btn" type="button" onClick={() => { const source = sources[0]; if (source) setConditions([...conditions, { sourceId: source.id, operator: "equals", value: "" }]); }} disabled={!sources.length}>+ Add condition</button>{conditions.length ? <span className="helper">Hidden questions are not included in submissions.</span> : null}</div></div></details>
      <div style={{ opacity: 0.78, display: "grid", gap: 6 }}><MarkdownContent value={field.label} className="bf-form-markdown" /><FieldPreview field={field} answer={field.fieldType === "checkbox" ? [] : ""} readOnly /></div>
    </div>;
  };

  const renderPreviewBlock = (block, index) => {
    if (!visibleFormState.visibleIds.has(block.id)) return null;
    if (block.type === "display") return <div key={block.id} style={{ padding: "4px 2px" }}><MarkdownContent value={block.text} className="bf-form-markdown" /></div>;
    if (block.type === "page-break") return <div key={block.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0" }}><hr style={{ flex: 1, border: 0, borderTop: "1px solid rgba(255,255,255,0.25)" }} /><span className="helper">{block.label || "Page break"}</span><hr style={{ flex: 1, border: 0, borderTop: "1px solid rgba(255,255,255,0.25)" }} /></div>;
    const field = normalizeQuestion(block, index);
    const questionNumber = form.blocks.slice(0, index + 1).filter((item) => item.type === "question" && visibleFormState.visibleIds.has(item.id)).length;
    return <div key={block.id} style={{ background: "rgba(255,255,255,0.02)", border: "1px solid #1f1f1f", borderRadius: 10, padding: 12, display: "grid", gap: 10 }}><div style={{ fontWeight: 700, display: "flex", gap: 5 }}><span>{questionNumber}.</span><div style={{ flex: 1 }}><MarkdownContent value={field.label} className="bf-form-markdown" /></div>{field.required ? <span style={{ color: "#ff9a9a" }}>*</span> : null}</div><FieldPreview field={field} answer={draftAnswers[field.id]} onAnswerChange={(nextValue) => setDraftAnswer(field.id, nextValue)} /></div>;
  };

  return <div style={{ maxWidth: 1080, margin: "0 auto", display: "grid", gap: 8 }}>
    <style>{`.bf-form-markdown{font-size:14px;line-height:1.6;color:#c9c9cf}.bf-form-markdown p{margin:0 0 8px}.bf-form-markdown p:last-child{margin-bottom:0}.bf-form-markdown strong{color:#fff}.bf-form-markdown em{font-style:italic}.bf-form-markdown code{background:rgba(255,255,255,.08);padding:1px 4px;border-radius:4px}.bf-form-markdown a{color:#9ed0ff;text-decoration:underline}.bf-form-markdown ul,.bf-form-markdown ol{margin:0 0 8px;padding-left:22px}.bf-form-markdown blockquote{margin:0 0 8px;padding-left:10px;border-left:3px solid #666;color:#bbb}.bf-form-option{display:inline}.bf-form-option p{margin:0}`}</style>
    <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid #1f1f1f", borderRadius: 10, padding: 12 }}>{readOnly ? <><h2 style={{ marginTop: 0, marginBottom: 8 }}>{form.title}</h2>{form.description ? <MarkdownContent value={form.description} className="bf-form-markdown" /> : null}</> : <div style={{ display: "grid", gap: 8 }}><input className="input" value={form.title} onChange={(event) => setFormProp("title", event.target.value)} placeholder="Form title" style={{ fontSize: 20, fontWeight: 800, padding: "8px 10px" }} /><textarea className="input" value={form.description} onChange={(event) => setFormProp("description", event.target.value)} placeholder="Form description (Markdown supported)" style={{ minHeight: 68, padding: 8, resize: "vertical" }} /></div>}</div>
    {!readOnly ? <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid #1f1f1f", borderRadius: 10, padding: 12, display: "grid", gap: 10 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}><div><div style={{ fontWeight: 800, fontSize: 16 }}>Public response link</div><div className="helper">Anyone with this link can fill out and submit the form without a Bondfire account. They cannot view or edit the Drive document. Public answers are encrypted in their browser before Bondfire receives them.</div></div><label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 700 }}><input type="checkbox" checked={form.publicShare.enabled} onChange={(event) => { void togglePublicShare(event.target.checked); }} />Enable public submissions</label></div><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><button className="btn" type="button" onClick={() => { void openPublicUrl(); }} disabled={!publicUrl}>Open public form</button><button className="btn" type="button" onClick={() => { void copyPublicUrl(); }} disabled={!publicUrl}>Copy public link</button><button className="btn" type="button" onClick={regeneratePublicLink} disabled={!form.publicShare.enabled}>Regenerate link</button><button className="btn" type="button" onClick={() => { if (editorUrl) window.open(editorUrl, "_blank", "noopener,noreferrer"); }} disabled={!editorUrl}>Open editor</button></div><input className="input" readOnly value={publicUrl || (form.publicShare.enabled ? "Preparing encrypted public link…" : "Enable public submissions to generate a public share URL.")} style={{ padding: "8px 10px" }} />{form.publicShare.enabled && saveStatus !== "saved" ? <div className="helper">Public link will open after the current form save finishes.</div> : null}{copyStatus ? <div className="helper">{copyStatus}</div> : null}</div> : null}
    {readOnly ? form.blocks.map(renderPreviewBlock) : Array.from({ length: form.blocks.length + 1 }, (_unused, index) => <React.Fragment key={`insert-${index}`}><div style={{ display: "flex", justifyContent: "center", padding: "3px 0" }}><button className="btn" type="button" onClick={() => setInsertAt(insertAt === index ? null : index)} title={`Insert block at position ${index + 1}`} style={{ borderRadius: "50%", width: 28, height: 28, padding: 0, lineHeight: 1, fontSize: 18 }}>+</button></div>{insertAt === index ? <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap", padding: 4 }}><button className="btn" type="button" onClick={() => addBlockAt("question", index)}>Question</button><button className="btn" type="button" onClick={() => addBlockAt("display", index)}>Display text</button><button className="btn" type="button" onClick={() => addBlockAt("page-break", index)}>Page break</button></div> : null}{index < form.blocks.length ? renderEditorBlock(form.blocks[index], index) : null}</React.Fragment>)}
    {readOnly ? <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}><button className="btn" type="button" onClick={submitResponse}>Submit response</button>{responseStatus ? <div className="helper" role="status">{responseStatus}</div> : null}</div> : null}
    {(!readOnly || allResponses.length || remoteResponseStatus) ? <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid #1f1f1f", borderRadius: 10, padding: 12 }}><div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 10 }}><div><div style={{ fontWeight: 700 }}>Responses ({allResponses.length})</div><div className="helper">One row per submission. Questions hidden by conditional logic remain blank.</div></div><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{fileId && form.publicShare.recipientPrivateKey ? <button className="btn" type="button" onClick={() => { void loadPublicResponses(); }}>Refresh public responses</button> : null}<button className="btn" type="button" onClick={downloadResponses} disabled={!allResponses.length}>Download CSV</button></div></div>{remoteResponseStatus ? <div className="helper" style={{ marginBottom: 8 }}>{remoteResponseStatus}</div> : null}{allResponses.length ? <div style={{ overflowX: "auto" }}><table style={{ width: "100%", minWidth: Math.max(720, 220 + form.fields.length * 170), borderCollapse: "collapse", fontSize: 12 }}><caption style={{ textAlign: "left", padding: "0 0 8px", color: "#b8c1cc" }}>Newest submissions first</caption><thead><tr><th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid rgba(255,255,255,0.16)", whiteSpace: "nowrap" }}>Submitted</th><th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid rgba(255,255,255,0.16)" }}>Source</th>{form.fields.map((field) => <th key={field.id} style={{ textAlign: "left", padding: 8, borderBottom: "1px solid rgba(255,255,255,0.16)", minWidth: 150 }}><MarkdownContent value={field.label} className="bf-form-markdown" /></th>)}</tr></thead><tbody>{allResponses.map((response) => <tr key={response.id}><td style={{ padding: "10px 8px", verticalAlign: "top", borderBottom: "1px solid rgba(255,255,255,0.08)", whiteSpace: "nowrap" }}>{response.submittedAt ? new Date(response.submittedAt).toLocaleString() : "—"}</td><td style={{ padding: "10px 8px", verticalAlign: "top", borderBottom: "1px solid rgba(255,255,255,0.08)", whiteSpace: "nowrap" }}>{response.source === "public" ? "Public" : "Internal"}</td>{form.fields.map((field) => <td key={`${response.id}_${field.id}`} style={{ padding: "10px 8px", verticalAlign: "top", borderBottom: "1px solid rgba(255,255,255,0.08)", whiteSpace: "pre-wrap", maxWidth: 280 }}>{responseValue(response.answers?.[field.id]) || "—"}</td>)}</tr>)}</tbody></table></div> : <div className="helper">No responses yet.</div>}</div> : null}
  </div>;
}
