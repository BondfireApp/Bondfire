import React from "react";

function escapeHtml(str) {
  return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function parseFrontmatter(text) {
  const raw = String(text || "");
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { properties: [], body: raw, hasFrontmatter: false };
  const properties = match[1].split("\n").map((line) => {
    const idx = line.indexOf(":");
    if (idx === -1) return null;
    return { key: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim() };
  }).filter((x) => x && x.key);
  return { properties, body: raw.slice(match[0].length), hasFrontmatter: true };
}
function applyInlineMarkdown(text) {
  let html = escapeHtml(text || "");
  html = html.replace(/`([^`]+)`/gim, "<code>$1</code>");
  html = html.replace(/\*\*(.+?)\*\*/gim, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/gim, "<em>$1</em>");
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gim, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  html = html.replace(/\[\[(.*?)(\|(.*?))?\]\]/gim, (_m, title, _b, label) => {
    const safeTitle = escapeHtml(String(title || "").trim());
    const safeLabel = escapeHtml(String(label || title || "").trim());
    return `<a href="#" data-note-title="${safeTitle}">${safeLabel}</a>`;
  });
  return html;
}
function flushList(stack, targetIndent = -1) {
  let html = "";
  while (stack.length && stack[stack.length - 1].indent >= targetIndent + 1) {
    const top = stack.pop();
    html += `</${top.tag}>`;
  }
  return html;
}
function markdownToHtml(md) {
  let taskIndex = 0;
  const lines = String(md || "").replace(/\r\n/g, "\n").split("\n");
  let html = "";
  let i = 0;
  const listStack = [];
  let inCode = false;
  let codeLang = "";
  let codeLines = [];
  let inBlockquote = false;
  const closeBlockquote = () => { if (inBlockquote) { html += "</blockquote>"; inBlockquote = false; } };
  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (inCode) {
      if (trimmed.startsWith("```")) {
        html += `<pre><code class="lang-${escapeHtml(codeLang)}">${escapeHtml(codeLines.join("\n"))}</code></pre>`;
        inCode = false; codeLang = ""; codeLines = [];
      } else codeLines.push(raw);
      i += 1; continue;
    }
    if (trimmed.startsWith("```")) { html += flushList(listStack, -1); closeBlockquote(); inCode = true; codeLang = trimmed.slice(3).trim(); i += 1; continue; }
    if (!trimmed) { html += flushList(listStack, -1); closeBlockquote(); i += 1; continue; }
    if (/^---+$/.test(trimmed) || /^\*\*\*+$/.test(trimmed)) { html += flushList(listStack, -1); closeBlockquote(); html += "<hr />"; i += 1; continue; }
    if (trimmed.startsWith(">")) { html += flushList(listStack, -1); if (!inBlockquote) { html += "<blockquote>"; inBlockquote = true; } html += `<p>${applyInlineMarkdown(trimmed.replace(/^>\s?/, ""))}</p>`; i += 1; continue; } else closeBlockquote();
    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (heading) { html += flushList(listStack, -1); const level = heading[1].length; html += `<h${level}>${applyInlineMarkdown(heading[2])}</h${level}>`; i += 1; continue; }
    const indent = raw.match(/^\s*/)?.[0]?.length || 0;
    const task = trimmed.match(/^[-*]\s+\[([ xX])\]\s+(.*)$/);
    const bullet = trimmed.match(/^[-*]\s+(.*)$/);
    const ordered = trimmed.match(/^(\d+)\.\s+(.*)$/);
    if (task || bullet || ordered) {
      const tag = ordered ? "ol" : "ul";
      const content = task ? task[2] : bullet ? bullet[1] : ordered[2];
      while (listStack.length && indent < listStack[listStack.length - 1].indent) html += `</${listStack.pop().tag}>`;
      if (!listStack.length || indent > listStack[listStack.length - 1].indent || listStack[listStack.length - 1].tag !== tag) { html += `<${tag}>`; listStack.push({ indent, tag }); }
      if (task) {
        const checked = String(task[1] || "").toLowerCase() === "x";
        html += `<li class="task-list-item"><label><input type="checkbox" data-task-index="${taskIndex}" ${checked ? "checked" : ""} /> <span>${applyInlineMarkdown(content)}</span></label></li>`;
        taskIndex += 1;
      } else html += `<li>${applyInlineMarkdown(content)}</li>`;
      i += 1; continue;
    }
    html += flushList(listStack, -1);
    html += `<p>${applyInlineMarkdown(trimmed)}</p>`;
    i += 1;
  }
  html += flushList(listStack, -1);
  closeBlockquote();
  return html;
}

export default function NotePreview({ content, onOpenLink, focusMode, onUpdateProperty, onAddProperty, onRemoveProperty, propertiesCollapsed, onToggleProperties, onToggleTask }) {
  const parsed = parseFrontmatter(content);
  return (
    <div onClick={(e) => {
      const checkbox = e.target.closest('input[type="checkbox"][data-task-index]');
      if (checkbox) return;
      const link = e.target.closest("a[data-note-title]");
      if (!link) return;
      e.preventDefault();
      onOpenLink?.(link.dataset.noteTitle || "");
    }} onChange={(e) => {
      const checkbox = e.target.closest('input[type="checkbox"][data-task-index]');
      if (!checkbox) return;
      e.stopPropagation();
      const taskIndex = Number(checkbox.dataset.taskIndex);
      if (!Number.isFinite(taskIndex)) return;
      onToggleTask?.(taskIndex, checkbox.checked);
    }} style={{ maxWidth: 920, margin: "0 auto", background: "rgba(255,255,255,0.02)", border: "1px solid #1f1f1f", borderRadius: 10, padding: focusMode ? 12 : 10, minHeight: focusMode ? "84vh" : "72vh" }}>
      {parsed.hasFrontmatter ? <div className="card" style={{ padding: 8, marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: propertiesCollapsed ? 0 : 8 }}>
          <strong style={{ fontSize: 14 }}>Properties</strong>
          <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
            <button className="btn" type="button" onClick={(e) => { e.stopPropagation(); onAddProperty?.(); }}>+ Add</button>
            <button className="btn" type="button" onClick={(e) => { e.stopPropagation(); onToggleProperties?.(); }}>{propertiesCollapsed ? "Show" : "Hide"}</button>
          </div>
        </div>
        {!propertiesCollapsed ? <div style={{ display: "grid", gap: 6 }}>
          {parsed.properties.map((prop) => <div key={prop.key} style={{ display: "grid", gridTemplateColumns: "120px minmax(0,1fr) auto", gap: 6, alignItems: "center" }}>
            <div className="helper" style={{ fontSize: 12 }}>{prop.key}</div>
            <input className="input" type={prop.key.toLowerCase() === "date" ? "date" : "text"} value={prop.value || ""} onChange={(e) => onUpdateProperty?.(prop.key, e.target.value)} style={{ width: "100%", padding: "5px 8px", fontSize: 12 }} />
            <button className="btn" type="button" onClick={(e) => { e.stopPropagation(); onRemoveProperty?.(prop.key); }}>x</button>
          </div>)}
        </div> : null}
      </div> : null}
      <style>{`.bf-note-preview{max-width:74ch;margin:0 auto;font-size:14px;line-height:1.62}.bf-note-preview h1,.bf-note-preview h2,.bf-note-preview h3,.bf-note-preview h4,.bf-note-preview h5,.bf-note-preview h6{margin:0 0 10px 0}.bf-note-preview p{margin:0 0 10px 0}.bf-note-preview ul,.bf-note-preview ol{margin:0 0 10px 0;padding-left:24px}.bf-note-preview li{margin:0 0 4px 0}.bf-note-preview blockquote{margin:0 0 10px 0;padding-left:12px;border-left:3px solid #666;color:#bbb}.bf-note-preview a[data-note-title], .bf-note-preview a[href]{color:#9ed0ff;text-decoration:underline;cursor:pointer}.bf-note-preview code{background:rgba(255,255,255,0.08);padding:1px 4px;border-radius:4px}.bf-note-preview pre{background:rgba(255,255,255,0.05);padding:12px;border-radius:8px;overflow:auto;margin:0 0 10px 0}.bf-note-preview pre code{background:transparent;padding:0}.bf-note-preview hr{border:none;border-top:1px solid rgba(255,255,255,0.15);margin:14px 0}.bf-note-preview .task-list-item{list-style:none;margin-left:-22px}.bf-note-preview .task-list-item input{margin-right:8px}`}</style>
      <div className="bf-note-preview" dangerouslySetInnerHTML={{ __html: markdownToHtml(parsed.body) }} />
    </div>
  );
}
