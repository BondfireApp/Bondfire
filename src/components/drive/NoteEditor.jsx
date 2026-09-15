import React from "react";

export default function NoteEditor({ value, onChange, focusMode, editorRef }) {
  return (
    <div style={{ maxWidth: 920, margin: "0 auto", background: "rgba(255,255,255,0.02)", border: "1px solid #1f1f1f", borderRadius: 10, padding: focusMode ? 10 : 8 }}>
      <textarea ref={editorRef} value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} style={{ width: "100%", minHeight: focusMode ? "84vh" : "72vh", background: "transparent", border: "none", outline: "none", color: "#f5f5f5", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 13, lineHeight: 1.55, resize: "none" }} />
    </div>
  );
}
