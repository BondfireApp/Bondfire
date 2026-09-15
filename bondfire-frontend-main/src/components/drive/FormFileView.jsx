import React, { useEffect, useMemo, useState } from "react";

const DEFAULT_FORM = {
  type: "bondfire-form",
  version: 2,
  title: "Untitled form",
  description: "",
  fields: [
    { id: "field_1", type: "text", label: "Your name", required: false, options: [] },
    { id: "field_2", type: "paragraph", label: "Details", required: false, options: [] },
  ],
  responses: [],
  publicShare: { enabled: false, token: "" },
};

function makeToken() {
  return `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function safeParse(value) {
  try {
    const parsed = JSON.parse(String(value || ""));
    if (parsed && parsed.type === "bondfire-form") return parsed;
  } catch {}
  return DEFAULT_FORM;
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

function normalizeResponse(response, idx = 0) {
  return {
    id: String(response?.id || `resp_${idx + 1}`),
    submittedAt: Number(response?.submittedAt || Date.now()),
    source: String(response?.source || "internal"),
    answers: response && typeof response.answers === "object" && !Array.isArray(response.answers) ? response.answers : {},
  };
}

function normalizeForm(input) {
  return {
    type: "bondfire-form",
    version: 2,
    title: String(input?.title || "Untitled form"),
    description: String(input?.description || ""),
    fields: Array.isArray(input?.fields) && input.fields.length ? input.fields.map(normalizeField) : DEFAULT_FORM.fields.map(normalizeField),
    responses: Array.isArray(input?.responses) ? input.responses.map(normalizeResponse) : [],
    publicShare: {
      enabled: !!input?.publicShare?.enabled,
      token: String(input?.publicShare?.token || ""),
    },
  };
}

function serialize(form) {
  return JSON.stringify(normalizeForm(form), null, 2);
}

function FieldPreview({ field, answer, onAnswerChange, readOnly = false }) {
  if (field.type === "paragraph") {
    return <textarea disabled={readOnly} className="input" value={String(answer || "")} onChange={(e) => onAnswerChange?.(e.target.value)} placeholder="Long answer" style={{ width: "100%", minHeight: 88, padding: 8, resize: "vertical" }} />;
  }
  if (field.type === "choice") {
    return (
      <div style={{ display: "grid", gap: 8 }}>
        {field.options.map((option, idx) => (
          <label key={`${field.id}-${idx}`} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="radio" disabled={readOnly} name={field.id} checked={String(answer || "") === option} onChange={() => onAnswerChange?.(option)} />
            <span>{option}</span>
          </label>
        ))}
      </div>
    );
  }
  if (field.type === "checkbox") {
    const selected = Array.isArray(answer) ? answer.map((x) => String(x)) : [];
    return (
      <div style={{ display: "grid", gap: 8 }}>
        {field.options.map((option, idx) => {
          const checked = selected.includes(option);
          return (
            <label key={`${field.id}-${idx}`} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="checkbox" disabled={readOnly} checked={checked} onChange={(e) => onAnswerChange?.(e.target.checked ? [...selected, option] : selected.filter((value) => value !== option))} />
              <span>{option}</span>
            </label>
          );
        })}
      </div>
    );
  }
  if (field.type === "date") {
    return <input disabled={readOnly} className="input" type="date" value={String(answer || "")} onChange={(e) => onAnswerChange?.(e.target.value)} style={{ width: "100%", padding: 8 }} />;
  }
  return <input disabled={readOnly} className="input" type="text" value={String(answer || "")} onChange={(e) => onAnswerChange?.(e.target.value)} placeholder="Short answer" style={{ width: "100%", padding: 8 }} />;
}

function answerSummary(field, value) {
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  if (field.type === "checkbox" && !Array.isArray(value)) return "—";
  return String(value || "—");
}

export default function FormFileView({ value, onChange, mode = "edit", fileId = "", orgId = "" }) {
  const form = useMemo(() => normalizeForm(safeParse(value)), [value]);
  const readOnly = mode === "preview";
  const [draftAnswers, setDraftAnswers] = useState({});
  const [responseStatus, setResponseStatus] = useState("");
  const [copyStatus, setCopyStatus] = useState("");

  useEffect(() => {
    if (!copyStatus) return undefined;
    const timer = setTimeout(() => setCopyStatus(""), 1800);
    return () => clearTimeout(timer);
  }, [copyStatus]);

  const publicUrl = form.publicShare.enabled && form.publicShare.token && fileId
    ? `${window.location.origin}/api/public/forms/${encodeURIComponent(fileId)}?token=${encodeURIComponent(form.publicShare.token)}`
    : "";

  const standaloneEditorUrl = fileId && orgId
    ? `${window.location.origin}/app/#/org/${encodeURIComponent(orgId)}/drive?file=${encodeURIComponent(fileId)}`
    : "";

  const commit = (next) => onChange?.(serialize(next));
  const setFormProp = (key, nextValue) => commit({ ...form, [key]: nextValue });
  const setField = (fieldId, patch) => commit({ ...form, fields: form.fields.map((field) => (field.id === fieldId ? { ...field, ...patch } : field)) });
  const removeField = (fieldId) => commit({ ...form, fields: form.fields.filter((field) => field.id !== fieldId) });
  const addField = (type) => commit({ ...form, fields: [...form.fields, normalizeField({ id: `field_${Date.now()}`, type, label: type === "choice" ? "Multiple choice" : type === "checkbox" ? "Checkboxes" : "Untitled question", options: type === "choice" || type === "checkbox" ? ["Option 1", "Option 2"] : [] }, form.fields.length)] });

  const setDraftAnswer = (fieldId, nextValue) => {
    setResponseStatus("");
    setDraftAnswers((prev) => ({ ...prev, [fieldId]: nextValue }));
  };

  const togglePublicShare = (enabled) => {
    commit({
      ...form,
      publicShare: {
        enabled,
        token: enabled ? (form.publicShare.token || makeToken()) : form.publicShare.token,
      },
    });
  };

  const regeneratePublicLink = () => {
    commit({ ...form, publicShare: { enabled: true, token: makeToken() } });
    setCopyStatus("New link generated");
  };

  const copyPublicUrl = async () => {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopyStatus("Link copied");
    } catch {
      setCopyStatus("Copy failed");
    }
  };


  const openPublicUrl = () => {
    if (!publicUrl) return;
    window.open(publicUrl, "_blank", "noopener,noreferrer");
  };

  const openEditorUrl = () => {
    if (!standaloneEditorUrl) return;
    window.open(standaloneEditorUrl, "_blank", "noopener,noreferrer");
  };

  const submitResponse = () => {
    const missingRequired = form.fields.filter((field) => field.required).find((field) => {
      const answer = draftAnswers[field.id];
      if (field.type === "checkbox") return !Array.isArray(answer) || !answer.length;
      return !String(answer || "").trim();
    });
    if (missingRequired) {
      setResponseStatus(`Missing required field: ${missingRequired.label}`);
      return;
    }
    const response = normalizeResponse({
      id: `resp_${Date.now()}`,
      submittedAt: Date.now(),
      source: "internal",
      answers: form.fields.reduce((acc, field) => {
        const answer = draftAnswers[field.id];
        acc[field.id] = field.type === "checkbox" ? (Array.isArray(answer) ? answer : []) : String(answer || "");
        return acc;
      }, {}),
    }, form.responses.length);
    commit({ ...form, responses: [...form.responses, response] });
    setDraftAnswers({});
    setResponseStatus("Response submitted.");
  };

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", display: "grid", gap: 8 }}>
      {!readOnly ? (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button className="btn" type="button" onClick={() => addField("text")}>Add text</button>
          <button className="btn" type="button" onClick={() => addField("paragraph")}>Add paragraph</button>
          <button className="btn" type="button" onClick={() => addField("choice")}>Add choice</button>
          <button className="btn" type="button" onClick={() => addField("checkbox")}>Add checkbox</button>
          <button className="btn" type="button" onClick={() => addField("date")}>Add date</button>
        </div>
      ) : null}

      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid #1f1f1f", borderRadius: 10, padding: 12 }}>
        {readOnly ? (
          <>
            <h2 style={{ marginTop: 0, marginBottom: 8 }}>{form.title}</h2>
            {form.description ? <div className="helper" style={{ whiteSpace: "pre-wrap", marginBottom: 8 }}>{form.description}</div> : null}
          </>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            <input className="input" value={form.title} onChange={(e) => setFormProp("title", e.target.value)} placeholder="Form title" style={{ fontSize: 20, fontWeight: 800, padding: "8px 10px" }} />
            <textarea className="input" value={form.description} onChange={(e) => setFormProp("description", e.target.value)} placeholder="Form description" style={{ minHeight: 68, padding: 8, resize: "vertical" }} />
          </div>
        )}
      </div>

      {!readOnly ? (
        <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid #1f1f1f", borderRadius: 10, padding: 12, display: "grid", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 16 }}>Public response link</div>
              <div className="helper">Anyone with this link can submit without a Bondfire account.</div>
            </div>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 700 }}>
              <input type="checkbox" checked={form.publicShare.enabled} onChange={(e) => togglePublicShare(e.target.checked)} />
              Enable public submissions
            </label>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button className="btn" type="button" onClick={openPublicUrl} disabled={!publicUrl}>Open public form</button>
            <button className="btn" type="button" onClick={copyPublicUrl} disabled={!publicUrl}>Copy public link</button>
            <button className="btn" type="button" onClick={regeneratePublicLink} disabled={!form.publicShare.enabled}>Regenerate link</button>
          </div>
          <input className="input" readOnly value={publicUrl || "Enable public submissions to generate a public share URL."} style={{ padding: "8px 10px" }} />
          {copyStatus ? <div className="helper">{copyStatus}</div> : null}
        </div>
      ) : null}

      {form.fields.map((field, idx) => (
        <div key={field.id} style={{ background: "rgba(255,255,255,0.02)", border: "1px solid #1f1f1f", borderRadius: 10, padding: 12 }}>
          {readOnly ? (
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ fontWeight: 700 }}>{idx + 1}. {field.label} {field.required ? <span style={{ color: "#ff9a9a" }}>*</span> : null}</div>
              <FieldPreview field={field} answer={draftAnswers[field.id]} onAnswerChange={(next) => setDraftAnswer(field.id, next)} />
            </div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <input className="input" value={field.label} onChange={(e) => setField(field.id, { label: e.target.value })} placeholder="Question" style={{ flex: 1, minWidth: 220, padding: "8px 10px" }} />
                <select className="input" value={field.type} onChange={(e) => setField(field.id, { type: e.target.value, options: e.target.value === "choice" || e.target.value === "checkbox" ? (field.options.length ? field.options : ["Option 1", "Option 2"]) : [] })} style={{ width: 160, padding: "8px 10px" }}>
                  <option value="text">Text</option>
                  <option value="paragraph">Paragraph</option>
                  <option value="choice">Choice</option>
                  <option value="checkbox">Checkbox</option>
                  <option value="date">Date</option>
                </select>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                  <input type="checkbox" checked={field.required} onChange={(e) => setField(field.id, { required: e.target.checked })} />
                  Required
                </label>
                <button className="btn" type="button" onClick={() => removeField(field.id)} style={{ color: "#ff9a9a" }}>Delete</button>
              </div>

              {(field.type === "choice" || field.type === "checkbox") ? (
                <textarea className="input" value={field.options.join("\n")} onChange={(e) => setField(field.id, { options: e.target.value.split("\n").map((option) => option.trim()).filter(Boolean) })} placeholder="One option per line" style={{ minHeight: 90, padding: 10, resize: "vertical" }} />
              ) : null}

              <div style={{ opacity: 0.8 }}>
                <FieldPreview field={field} answer={field.type === "checkbox" ? [] : ""} readOnly />
              </div>
            </div>
          )}
        </div>
      ))}

      {readOnly ? (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn" type="button" onClick={submitResponse}>Submit response</button>
          {responseStatus ? <div className="helper">{responseStatus}</div> : null}
        </div>
      ) : null}

      {form.responses.length ? (
        <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid #1f1f1f", borderRadius: 10, padding: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>Responses ({form.responses.length})</div>
          <div style={{ display: "grid", gap: 8 }}>
            {form.responses.slice().reverse().map((response) => (
              <div key={response.id} style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: 10, background: "rgba(255,255,255,0.02)" }}>
                <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 8 }}>{new Date(response.submittedAt).toLocaleString()} · {response.source === "public" ? "public" : "internal"}</div>
                <div style={{ display: "grid", gap: 6 }}>
                  {form.fields.map((field) => (
                    <div key={`${response.id}_${field.id}`}>
                      <div style={{ fontWeight: 700, marginBottom: 2 }}>{field.label}</div>
                      <div className="helper" style={{ whiteSpace: "pre-wrap" }}>{answerSummary(field, response.answers[field.id])}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
