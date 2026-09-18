import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useParams } from "react-router-dom";
import { api } from "../../utils/api.js";

function MenuButton({ label, onClick, danger = false }) {
  return (
    <button
      className="btn"
      type="button"
      onClick={onClick}
      style={{
        textAlign: "left",
        justifyContent: "flex-start",
        padding: "7px 10px",
        color: danger ? "#ff8f8f" : undefined,
      }}
    >
      {label}
    </button>
  );
}

function PopMenu({ trigger, items, align = "right" }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 8, left: 8, openUp: false });
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  function placeMenu() {
    const triggerNode = triggerRef.current;
    if (!triggerNode || typeof window === "undefined") return;
    const rect = triggerNode.getBoundingClientRect();
    const width = Math.max(190, Number(menuRef.current?.offsetWidth || 190));
    const measuredHeight = Number(menuRef.current?.offsetHeight || 0);
    const estimatedHeight = Math.min(window.innerHeight - 16, measuredHeight || (items.length * 40 + 8));
    const gap = 6;
    const edge = 8;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const openUp = spaceBelow < estimatedHeight + gap && spaceAbove > spaceBelow;
    const unclampedTop = openUp ? rect.top - estimatedHeight - gap : rect.bottom + gap;
    const top = Math.max(edge, Math.min(unclampedTop, window.innerHeight - estimatedHeight - edge));
    const unclampedLeft = align === "left" ? rect.left : rect.right - width;
    const left = Math.max(edge, Math.min(unclampedLeft, window.innerWidth - width - edge));
    setPosition({ top, left, openUp });
  }

  useEffect(() => {
    if (!open) return undefined;
    placeMenu();
    const frame = window.requestAnimationFrame(placeMenu);
    const closeOnViewportMove = () => setOpen(false);
    const onDown = (event) => {
      if (triggerRef.current?.contains(event.target) || menuRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", closeOnViewportMove);
    window.addEventListener("scroll", closeOnViewportMove, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", closeOnViewportMove);
      window.removeEventListener("scroll", closeOnViewportMove, true);
    };
  }, [open, align, items.length]);

  const menu = open && typeof document !== "undefined"
    ? createPortal(
        <div
          ref={menuRef}
          data-pop-direction={position.openUp ? "up" : "down"}
          style={{
            position: "fixed",
            top: position.top,
            left: position.left,
            minWidth: 190,
            maxWidth: "min(320px, calc(100vw - 16px))",
            maxHeight: "calc(100vh - 16px)",
            overflowY: "auto",
            background: "rgba(16,16,20,0.98)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 10,
            padding: 4,
            boxShadow: "0 14px 32px rgba(0,0,0,0.42)",
            zIndex: 1000,
            display: "grid",
            gap: 4,
          }}
        >
          {items.map((item, idx) => (
            <MenuButton key={`${item.label}-${idx}`} label={item.label} danger={item.danger} onClick={() => { item.onClick?.(); setOpen(false); }} />
          ))}
        </div>,
        document.body,
      )
    : null;

  return (
    <div style={{ position: "relative" }}>
      <button
        ref={triggerRef}
        className="btn"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        style={{ padding: "5px 8px", minWidth: 30, borderRadius: 10 }}
      >
        {trigger}
      </button>
      {menu}
    </div>
  );
}

function TreeRow({
  depth = 0,
  active = false,
  icon,
  label,
  hint,
  onClick,
  menuItems,
  expanded,
  onToggle,
  dragPayload,
  onDropItem,
}) {
  const draggable = !!dragPayload;
  const canDrop = typeof onDropItem === "function";

  return (
    <div
      draggable={draggable}
      onDragStart={draggable ? (event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/x-bondfire-drive-item", JSON.stringify(dragPayload));
        event.dataTransfer.setData("text/plain", JSON.stringify(dragPayload));
      } : undefined}
      onDragOver={canDrop ? (event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      } : undefined}
      onDrop={canDrop ? (event) => {
        event.preventDefault();
        event.stopPropagation();
        let raw = event.dataTransfer.getData("application/x-bondfire-drive-item") || event.dataTransfer.getData("text/plain");
        try {
          const item = JSON.parse(raw || "{}");
          if (item?.id && item?.kind) onDropItem(item);
        } catch {}
      } : undefined}
      style={{
        display: "grid",
        gridTemplateColumns: onToggle ? "28px minmax(0,1fr) auto" : "minmax(0,1fr) auto",
        gap: 4,
        alignItems: "center",
        marginTop: 3,
        paddingLeft: onToggle ? depth * 12 : 0,
      }}
    >
      {onToggle ? (
        <button
          type="button"
          aria-label={expanded ? `Collapse ${label}` : `Expand ${label}`}
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
          style={{
            width: 28,
            height: 28,
            padding: 0,
            display: "grid",
            placeItems: "center",
            background: "transparent",
            color: "#fff",
            border: "none",
            cursor: "pointer",
            opacity: 0.8,
          }}
        >
          {expanded ? "▾" : "▸"}
        </button>
      ) : null}
      <button
        type="button"
        onClick={onClick}
        title={label}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          width: "100%",
          minWidth: 0,
          padding: "6px 8px",
          paddingLeft: onToggle ? 8 : 8 + depth * 12,
          background: active ? "rgba(255,255,255,0.08)" : "transparent",
          color: "#fff",
          border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: 10,
          cursor: draggable ? "grab" : "pointer",
          textAlign: "left",
        }}
      >
        <span style={{ opacity: 0.9, width: 12, textAlign: "center", flex: "0 0 12px" }}>{icon}</span>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: active ? 700 : 500 }}>{label}</span>
        {hint ? <span className="helper" style={{ marginLeft: "auto", flex: "0 0 auto" }}>{hint}</span> : null}
      </button>
      {menuItems?.length ? <PopMenu trigger="⋯" items={menuItems} /> : null}
    </div>
  );
}

export default function DriveSidebar({
  folders = [],
  notes = [],
  files = [],
  currentFolder,
  selectedId,
  selectedKind,
  search,
  setSearch,
  onSelectFolder,
  onSelectNote,
  onSelectFile,
  onNewNote,
  onNewFolder,
  onNewSpreadsheet,
  onNewForm,
  onOpenCreatePicker,
  onUploadFile,
  onUploadFolder,
  onRenameFolder,
  onMoveFolder,
  onDeleteFolder,
  onRenameNote,
  onMoveNote,
  onDeleteNote,
  onRenameFile,
  onMoveFile,
  onDeleteFile,
  onDownloadFile,
  onOpenFileInBrowser,
  templates = [],
  onApplyTemplate,
  onNewFromTemplate,
  onDeleteTemplate,
  onEditTemplate,
}) {
  const { orgId = "" } = useParams();
  const [activePane, setActivePane] = useState("explorer");
  const collapseStorageKey = `bf_drive_collapsed_v1_${orgId}`;
  const [collapsedFolders, setCollapsedFolders] = useState(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(collapseStorageKey) || "{}");
      return raw && typeof raw === "object" ? raw : {};
    } catch {
      return {};
    }
  });
  const [templateItems, setTemplateItems] = useState(templates);
  const templateImportRef = useRef(null);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [templateError, setTemplateError] = useState("");
  const [templateEditor, setTemplateEditor] = useState(null);

  useEffect(() => {
    setTemplateItems(templates);
  }, [templates]);

  useEffect(() => {
    try {
      localStorage.setItem(collapseStorageKey, JSON.stringify(collapsedFolders));
    } catch {}
  }, [collapseStorageKey, collapsedFolders]);

  function moveDroppedItem(item, targetFolderId) {
    if (!item?.id || !item?.kind) return;
    if (item.kind === "folder") {
      onMoveFolder?.(item.id, targetFolderId);
      return;
    }
    if (item.kind === "note") {
      onMoveNote?.(item.id, targetFolderId);
      return;
    }
    if (item.kind === "file") onMoveFile?.(item.id, targetFolderId);
  }

  function handleRootDrop(event) {
    event.preventDefault();
    let raw = event.dataTransfer.getData("application/x-bondfire-drive-item") || event.dataTransfer.getData("text/plain");
    try {
      const item = JSON.parse(raw || "{}");
      if (item?.id && item?.kind) moveDroppedItem(item, null);
    } catch {}
  }

  function openTemplateEditor(template) {
    if (!template) return;
    setTemplateError("");
    setTemplateEditor({
      id: template.id,
      name: String(template.name || ""),
      title: String(template.title || ""),
      body: String(template.body || ""),
    });
  }

  async function importTemplateFile(event) {
    const file = event.target.files?.[0] || null;
    event.target.value = "";
    if (!file || !orgId || templateBusy) return;
    setTemplateBusy(true);
    setTemplateError("");
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw);
      const source = parsed?.template && typeof parsed.template === "object" ? parsed.template : parsed;
      const name = String(source?.name || source?.title || file.name.replace(/\.bftemplate$/i, "") || "Imported template").trim();
      const title = String(source?.title || "");
      const body = String(source?.body || source?.content || "");
      if (!body.trim()) throw new Error("Template file has no body.");
      const res = await api(`/api/orgs/${encodeURIComponent(orgId)}/drive/templates`, {
        method: "POST",
        body: JSON.stringify({ name, title, body }),
      });
      if (!res?.template) throw new Error("Template import was not acknowledged by the server.");
      setTemplateItems((prev) => [res.template, ...prev.filter((tpl) => tpl.id !== res.template.id)]);
      openTemplateEditor(res.template);
    } catch (error) {
      setTemplateError(`Import failed: ${String(error?.message || error || "invalid template file")}`);
    } finally {
      setTemplateBusy(false);
    }
  }

  async function createTemplate() {
    if (!orgId || templateBusy) return;
    const name = window.prompt("Template name?", "Untitled template");
    if (name === null || !String(name).trim()) return;
    setTemplateBusy(true);
    setTemplateError("");
    try {
      const res = await api(`/api/orgs/${encodeURIComponent(orgId)}/drive/templates`, {
        method: "POST",
        body: JSON.stringify({ name: String(name).trim(), title: "", body: "" }),
      });
      if (!res?.template) throw new Error("Template was not created.");
      setTemplateItems((prev) => [res.template, ...prev.filter((tpl) => tpl.id !== res.template.id)]);
      openTemplateEditor(res.template);
    } catch (error) {
      setTemplateError(String(error?.message || error || "Template creation failed."));
    } finally {
      setTemplateBusy(false);
    }
  }

  async function saveTemplateEditor() {
    if (!orgId || !templateEditor?.id || templateBusy) return;
    if (!String(templateEditor.name || "").trim()) {
      setTemplateError("Template name is required.");
      return;
    }
    setTemplateBusy(true);
    setTemplateError("");
    try {
      const res = await api(`/api/orgs/${encodeURIComponent(orgId)}/drive/templates/${encodeURIComponent(templateEditor.id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: String(templateEditor.name).trim(),
          title: String(templateEditor.title || ""),
          body: String(templateEditor.body || ""),
        }),
      });
      if (!res?.template) throw new Error("Template was not updated.");
      setTemplateItems((prev) => prev.map((tpl) => (tpl.id === templateEditor.id ? res.template : tpl)));
      setTemplateEditor({
        id: res.template.id,
        name: String(res.template.name || ""),
        title: String(res.template.title || ""),
        body: String(res.template.body || ""),
      });
    } catch (error) {
      setTemplateError(String(error?.message || error || "Template update failed."));
    } finally {
      setTemplateBusy(false);
    }
  }

  async function deleteTemplateDirect(template) {
    if (!orgId || !template?.id || templateBusy) return;
    if (!window.confirm(`Delete template "${template.name || "Untitled template"}"?`)) return;
    setTemplateBusy(true);
    setTemplateError("");
    try {
      await api(`/api/orgs/${encodeURIComponent(orgId)}/drive/templates/${encodeURIComponent(template.id)}`, { method: "DELETE" });
      setTemplateItems((prev) => prev.filter((tpl) => tpl.id !== template.id));
      if (templateEditor?.id === template.id) setTemplateEditor(null);
    } catch (error) {
      setTemplateError(String(error?.message || error || "Template deletion failed."));
    } finally {
      setTemplateBusy(false);
    }
  }

  const rootItems = useMemo(() => {
    const q = String(search || "").trim().toLowerCase();
    const noteMatches = (note) => !q || String(note.title || "").toLowerCase().includes(q) || String(note.body || "").toLowerCase().includes(q);
    const fileMatches = (file) => !q || String(file.name || "").toLowerCase().includes(q) || String(file.textContent || "").toLowerCase().includes(q);
    const folderMatches = (folder) => !q || String(folder.name || "").toLowerCase().includes(q);

    const folderMap = new Map();
    folders.forEach((folder) => folderMap.set(folder.id, folder));

    const visibleFolderIds = new Set();
    folders.forEach((folder) => {
      if (!q || folderMatches(folder)) {
        let cursor = folder;
        while (cursor) {
          visibleFolderIds.add(cursor.id);
          cursor = cursor.parentId ? folderMap.get(cursor.parentId) : null;
        }
      }
    });

    notes.forEach((note) => {
      if (!noteMatches(note)) return;
      let cursor = note.parentId ? folderMap.get(note.parentId) : null;
      while (cursor) {
        visibleFolderIds.add(cursor.id);
        cursor = cursor.parentId ? folderMap.get(cursor.parentId) : null;
      }
    });

    files.forEach((file) => {
      if (!fileMatches(file)) return;
      let cursor = file.parentId ? folderMap.get(file.parentId) : null;
      while (cursor) {
        visibleFolderIds.add(cursor.id);
        cursor = cursor.parentId ? folderMap.get(cursor.parentId) : null;
      }
    });

    function renderBranch(parentId = null, depth = 0) {
      const folderChildren = folders
        .filter((folder) => (folder.parentId || null) === parentId)
        .filter((folder) => !q || visibleFolderIds.has(folder.id) || folderMatches(folder))
        .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));

      const noteChildren = notes
        .filter((note) => (note.parentId || null) === parentId)
        .filter(noteMatches)
        .sort((a, b) => String(a.title || "").localeCompare(String(b.title || "")));

      const fileChildren = files
        .filter((file) => (file.parentId || null) === parentId)
        .filter(fileMatches)
        .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));

      const rows = [];

      folderChildren.forEach((folder) => {
        const isCollapsed = !!collapsedFolders[folder.id];
        rows.push(
          <TreeRow
            key={folder.id}
            depth={depth}
            active={currentFolder === folder.id}
            icon="📁"
            label={folder.name}
            expanded={!isCollapsed}
            onToggle={() => setCollapsedFolders((prev) => ({ ...prev, [folder.id]: !prev[folder.id] }))}
            onClick={() => onSelectFolder?.(folder.id)}
            dragPayload={{ kind: "folder", id: folder.id }}
            onDropItem={(item) => {
              if (item.kind === "folder" && item.id === folder.id) return;
              setCollapsedFolders((prev) => ({ ...prev, [folder.id]: false }));
              moveDroppedItem(item, folder.id);
            }}
            menuItems={[
              { label: "Open", onClick: () => onSelectFolder?.(folder.id) },
              { label: isCollapsed ? "Expand" : "Collapse", onClick: () => setCollapsedFolders((prev) => ({ ...prev, [folder.id]: !prev[folder.id] })) },
              { label: "Rename", onClick: () => onRenameFolder?.(folder.id) },
              { label: "Delete folder and contents", danger: true, onClick: () => onDeleteFolder?.(folder.id) },
            ]}
          />,
        );
        if (!isCollapsed) rows.push(...renderBranch(folder.id, depth + 1));
      });

      noteChildren.forEach((note) => {
        rows.push(
          <TreeRow
            key={note.id}
            depth={depth}
            active={selectedKind === "note" && selectedId === note.id}
            icon="•"
            label={note.title || "untitled"}
            dragPayload={{ kind: "note", id: note.id }}
            onClick={() => onSelectNote?.(note.id)}
            menuItems={[
              { label: "Open", onClick: () => onSelectNote?.(note.id) },
              { label: "Rename", onClick: () => onRenameNote?.(note.id) },
              { label: "Move", onClick: () => onMoveNote?.(note.id) },
              { label: "Delete", danger: true, onClick: () => onDeleteNote?.(note.id) },
            ]}
          />,
        );
      });

      fileChildren.forEach((file) => {
        rows.push(
          <TreeRow
            key={file.id}
            depth={depth}
            active={selectedKind === "file" && selectedId === file.id}
            icon={String(file.mime || "").includes("bondfire.sheet") || /\.bfsheet$/i.test(String(file.name || "")) ? "▦" : String(file.mime || "").includes("bondfire.form") || /\.bfform$/i.test(String(file.name || "")) ? "☑" : "↗"}
            label={file.name}
            dragPayload={{ kind: "file", id: file.id }}
            onClick={() => onSelectFile?.(file)}
            menuItems={[
              { label: "Open", onClick: () => onSelectFile?.(file) },
              { label: "Open in browser", onClick: () => onOpenFileInBrowser?.(file) },
              { label: "Download", onClick: () => onDownloadFile?.(file) },
              { label: "Rename", onClick: () => onRenameFile?.(file.id) },
              { label: "Move", onClick: () => onMoveFile?.(file.id) },
              { label: "Delete", danger: true, onClick: () => onDeleteFile?.(file.id) },
            ]}
          />,
        );
      });

      return rows;
    }

    return renderBranch();
  }, [folders, notes, files, currentFolder, selectedId, selectedKind, search, collapsedFolders, onSelectFolder, onSelectNote, onSelectFile, onRenameFolder, onMoveFolder, onDeleteFolder, onRenameNote, onMoveNote, onDeleteNote, onRenameFile, onMoveFile, onDeleteFile, onDownloadFile, onOpenFileInBrowser]);

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "44px minmax(0,1fr)", height: "100%", position: "relative", zIndex: 0 }}>
        <div style={{ borderRight: "1px solid #1b1b1b", padding: 8, display: "grid", alignContent: "start", gap: 6, position: "relative", zIndex: 1 }}>
          <button className="btn" type="button" title="Explorer" onClick={() => setActivePane("explorer")} style={{ padding: "8px 0", fontWeight: activePane === "explorer" ? 800 : 500 }}>⌂</button>
          <button className="btn" type="button" title="Templates" onClick={() => setActivePane("templates")} style={{ padding: "8px 0", fontWeight: activePane === "templates" ? 800 : 500 }}>T</button>
        </div>

        <div style={{ minWidth: 0, overflow: "auto", padding: 10, position: "relative", zIndex: 2 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <button className="btn" type="button" onClick={() => onOpenCreatePicker?.()} style={{ padding: "6px 12px", minWidth: 36 }}>＋</button>
            {activePane === "templates" ? (
              <PopMenu
                trigger="⋯"
                align="left"
                items={[
                  { label: "New note", onClick: onNewNote },
                  { label: "New folder", onClick: onNewFolder },
                  { label: "Upload file", onClick: onUploadFile },
                  { label: "Upload folder", onClick: onUploadFolder },
                ]}
              />
            ) : null}
            <input className="input" placeholder={activePane === "explorer" ? "search..." : "search templates..."} value={search} onChange={(e) => setSearch(e.target.value)} style={{ minWidth: 0, flex: 1, padding: "9px 10px" }} />
          </div>

          {activePane === "explorer" ? (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, marginBottom: 6 }}>
                <div className="helper" style={{ letterSpacing: "0.08em", textTransform: "uppercase" }}>Explorer</div>
                <button
                  className="btn"
                  type="button"
                  onClick={() => onSelectFolder?.(null)}
                  onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }}
                  onDrop={handleRootDrop}
                  title="Open root or drop an item here to move it to root"
                  style={{ padding: "5px 8px", fontSize: 12 }}
                >
                  Root
                </button>
              </div>
              <div style={{ display: "grid", gap: 2 }}>
                {rootItems.length ? rootItems : <div className="helper" style={{ padding: "8px 4px" }}>Nothing here.</div>}
              </div>
            </>
          ) : (
            <>
              <input
                ref={templateImportRef}
                type="file"
                accept=".bftemplate,application/json"
                style={{ display: "none" }}
                onChange={importTemplateFile}
              />
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                <div className="helper" style={{ letterSpacing: "0.08em", textTransform: "uppercase" }}>Templates</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => {
                      if (templateImportRef.current) templateImportRef.current.value = "";
                      templateImportRef.current?.click();
                    }}
                    disabled={templateBusy}
                    style={{ padding: "5px 8px", fontSize: 12 }}
                  >
                    Import template
                  </button>
                  <button className="btn" type="button" onClick={createTemplate} disabled={templateBusy} style={{ padding: "5px 8px", fontSize: 12 }}>
                    {templateBusy ? "Working…" : "+ New Template"}
                  </button>
                </div>
              </div>
              {templateError ? <div role="alert" style={{ color: "#ff8f8f", fontSize: 12, marginBottom: 8 }}>{templateError}</div> : null}
              <div style={{ display: "grid", gap: 4 }}>
                {templateItems
                  .filter((tpl) => !String(search || "").trim() || String(tpl.name || "").toLowerCase().includes(String(search || "").trim().toLowerCase()) || String(tpl.body || "").toLowerCase().includes(String(search || "").trim().toLowerCase()))
                  .map((tpl) => (
                    <TreeRow
                      key={tpl.id}
                      icon="✦"
                      label={tpl.name}
                      active={templateEditor?.id === tpl.id}
                      onClick={() => openTemplateEditor(tpl)}
                      menuItems={[
                        { label: "Edit template", onClick: () => openTemplateEditor(tpl) },
                        { label: "Insert into current note", onClick: () => onApplyTemplate?.(tpl) },
                        { label: "New note from template", onClick: () => onNewFromTemplate?.(tpl) },
                        { label: "Delete template", danger: true, onClick: () => deleteTemplateDirect(tpl) },
                      ]}
                    />
                  ))}
                {!templateItems.length ? <div className="helper" style={{ padding: "8px 4px" }}>No templates yet. Create one here or save a note as a template.</div> : null}
              </div>
            </>
          )}
        </div>
      </div>

      {templateEditor ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Edit Drive template"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 300,
            background: "rgba(0,0,0,0.72)",
            display: "grid",
            placeItems: "center",
            padding: 16,
          }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !templateBusy) setTemplateEditor(null);
          }}
        >
          <div style={{ width: "min(760px, 100%)", maxHeight: "90vh", overflow: "auto", background: "#0d0e10", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 14, boxShadow: "0 24px 80px rgba(0,0,0,0.6)", padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 20 }}>Edit template</h2>
                <div className="helper" style={{ marginTop: 4 }}>Editing does not insert this template into a note.</div>
              </div>
              <button className="btn" type="button" onClick={() => setTemplateEditor(null)} disabled={templateBusy}>Close</button>
            </div>

            <label style={{ display: "grid", gap: 6, marginBottom: 12 }}>
              <span className="helper">Template name</span>
              <input className="input" value={templateEditor.name} onChange={(e) => setTemplateEditor((prev) => ({ ...prev, name: e.target.value }))} />
            </label>

            <label style={{ display: "grid", gap: 6, marginBottom: 12 }}>
              <span className="helper">Default note title</span>
              <input className="input" value={templateEditor.title} onChange={(e) => setTemplateEditor((prev) => ({ ...prev, title: e.target.value }))} placeholder="Optional" />
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span className="helper">Template body</span>
              <textarea
                className="input"
                value={templateEditor.body}
                onChange={(e) => setTemplateEditor((prev) => ({ ...prev, body: e.target.value }))}
                rows={18}
                style={{ resize: "vertical", minHeight: 260, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", lineHeight: 1.5 }}
                placeholder="Write the reusable note content here…"
              />
            </label>

            {templateError ? <div role="alert" style={{ color: "#ff8f8f", marginTop: 10 }}>{templateError}</div> : null}

            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
              <button className="btn" type="button" onClick={() => deleteTemplateDirect(templateEditor)} disabled={templateBusy} style={{ color: "#ff8f8f" }}>Delete template</button>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn" type="button" onClick={() => setTemplateEditor(null)} disabled={templateBusy}>Cancel</button>
                <button className="btn" type="button" onClick={saveTemplateEditor} disabled={templateBusy}>{templateBusy ? "Saving…" : "Save template"}</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
