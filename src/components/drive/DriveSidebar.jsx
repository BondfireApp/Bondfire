import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronRight, File, FileSpreadsheet, FileText, Folder, LayoutTemplate, MoreHorizontal, Share2 } from "lucide-react";
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

function ContextMenu({ items, point, onClose }) {
  const menuRef = useRef(null);
  const [position, setPosition] = useState(() => ({
    top: Number(point?.y || 8),
    left: Number(point?.x || 8),
  }));

  useEffect(() => {
    if (!point || typeof window === "undefined") return undefined;
    const place = () => {
      const node = menuRef.current;
      const width = Number(node?.offsetWidth || 210);
      const height = Number(node?.offsetHeight || Math.min(items.length * 40 + 8, window.innerHeight - 16));
      const edge = 8;
      setPosition({
        left: Math.max(edge, Math.min(Number(point.x || edge), window.innerWidth - width - edge)),
        top: Math.max(edge, Math.min(Number(point.y || edge), window.innerHeight - height - edge)),
      });
    };
    place();
    const frame = window.requestAnimationFrame(place);
    const close = () => onClose?.();
    const onDown = (event) => {
      if (menuRef.current?.contains(event.target)) return;
      onClose?.();
    };
    const onKey = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [point, items.length, onClose]);

  if (!point || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      data-drive-context-menu="true"
      style={{
        position: "fixed",
        top: position.top,
        left: position.left,
        minWidth: 210,
        maxWidth: "min(320px, calc(100vw - 16px))",
        maxHeight: "calc(100vh - 16px)",
        overflowY: "auto",
        background: "rgba(16,16,20,0.99)",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 10,
        padding: 4,
        boxShadow: "0 16px 40px rgba(0,0,0,0.5)",
        zIndex: 1100,
        display: "grid",
        gap: 4,
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item, idx) => (
        <MenuButton
          key={`${item.label}-${idx}`}
          label={item.label}
          danger={item.danger}
          onClick={() => {
            item.onClick?.();
            onClose?.();
          }}
        />
      ))}
    </div>,
    document.body,
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
        className="btn bf-drive-moreButton"
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
  const [contextPoint, setContextPoint] = useState(null);

  return (
    <div
      className={`bf-drive-treeRow${active ? " is-active" : ""}${onToggle ? " has-toggle" : ""}`}
      style={{ "--bf-drive-depth": depth }}
      data-drive-tree-row="true"
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
        const raw = event.dataTransfer.getData("application/x-bondfire-drive-item") || event.dataTransfer.getData("text/plain");
        try {
          const item = JSON.parse(raw || "{}");
          if (item?.id && item?.kind) onDropItem(item);
        } catch {}
      } : undefined}
      onContextMenu={menuItems?.length ? (event) => {
        event.preventDefault();
        event.stopPropagation();
        setContextPoint({ x: event.clientX, y: event.clientY });
      } : undefined}
    >
      {onToggle ? (
        <button
          type="button"
          className="bf-drive-treeToggle"
          aria-label={expanded ? `Collapse ${label}` : `Expand ${label}`}
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
      ) : <span className="bf-drive-treeSpacer" />}
      <button
        type="button"
        className="bf-drive-treeMain"
        onClick={onClick}
        title={label}
      >
        <span className="bf-drive-treeIcon">{icon}</span>
        <span className="bf-drive-treeLabel">{label}</span>
        {hint ? <span className="bf-drive-treeHint">{hint}</span> : null}
      </button>
      {menuItems?.length ? (
        <div className="bf-drive-treeActions">
          <PopMenu trigger={<MoreHorizontal size={15} aria-hidden="true" />} items={menuItems} />
        </div>
      ) : null}
      {menuItems?.length ? <ContextMenu items={menuItems} point={contextPoint} onClose={() => setContextPoint(null)} /> : null}
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
  onShareItem,
  sharedItems = [],
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
  const [blankContextPoint, setBlankContextPoint] = useState(null);

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
        const readOnly = folder.sharePermission === "view";
        rows.push(
          <TreeRow
            key={folder.id}
            depth={depth}
            active={currentFolder === folder.id}
            icon={<Folder size={15} />}
            label={folder.name}
            expanded={!isCollapsed}
            onToggle={() => setCollapsedFolders((prev) => ({ ...prev, [folder.id]: !prev[folder.id] }))}
            onClick={() => onSelectFolder?.(folder.id)}
            dragPayload={readOnly ? null : { kind: "folder", id: folder.id }}
            onDropItem={readOnly ? undefined : (item) => {
              if (item.kind === "folder" && item.id === folder.id) return;
              setCollapsedFolders((prev) => ({ ...prev, [folder.id]: false }));
              moveDroppedItem(item, folder.id);
            }}
            menuItems={[
              { label: "Open", onClick: () => onSelectFolder?.(folder.id) },
              { label: isCollapsed ? "Expand" : "Collapse", onClick: () => setCollapsedFolders((prev) => ({ ...prev, [folder.id]: !prev[folder.id] })) },
              !readOnly ? { label: "Rename", onClick: () => onRenameFolder?.(folder.id) } : null,
              { label: "Manage access", onClick: () => onShareItem?.({ kind: "drive/folders", id: folder.id, label: folder.name || "Folder" }) },
              !readOnly ? { label: "Delete folder and contents", danger: true, onClick: () => onDeleteFolder?.(folder.id) } : null,
            ].filter(Boolean)}
          />,
        );
        if (!isCollapsed) rows.push(...renderBranch(folder.id, depth + 1));
      });

      noteChildren.forEach((note) => {
        const readOnly = note.sharePermission === "view";
        rows.push(
          <TreeRow
            key={note.id}
            depth={depth}
            active={selectedKind === "note" && selectedId === note.id}
            icon={<FileText size={15} />}
            label={note.title || "untitled"}
            dragPayload={readOnly ? null : { kind: "note", id: note.id }}
            onClick={() => onSelectNote?.(note.id)}
            menuItems={[
              { label: "Open", onClick: () => onSelectNote?.(note.id) },
              !readOnly ? { label: "Rename", onClick: () => onRenameNote?.(note.id) } : null,
              !readOnly ? { label: "Move", onClick: () => onMoveNote?.(note.id) } : null,
              { label: "Manage access", onClick: () => onShareItem?.({ kind: "drive/notes", id: note.id, label: note.title || "Untitled note" }) },
              !readOnly ? { label: "Delete", danger: true, onClick: () => onDeleteNote?.(note.id) } : null,
            ].filter(Boolean)}
          />,
        );
      });

      fileChildren.forEach((file) => {
        const readOnly = file.sharePermission === "view";
        rows.push(
          <TreeRow
            key={file.id}
            depth={depth}
            active={selectedKind === "file" && selectedId === file.id}
            icon={String(file.mime || "").includes("bondfire.sheet") || /\.bfsheet$/i.test(String(file.name || "")) ? <FileSpreadsheet size={15} /> : <File size={15} />}
            label={file.name}
            dragPayload={readOnly ? null : { kind: "file", id: file.id }}
            onClick={() => onSelectFile?.(file)}
            menuItems={[
              { label: "Open", onClick: () => onSelectFile?.(file) },
              { label: "Open in browser", onClick: () => onOpenFileInBrowser?.(file) },
              { label: "Download", onClick: () => onDownloadFile?.(file) },
              !readOnly ? { label: "Rename", onClick: () => onRenameFile?.(file.id) } : null,
              !readOnly ? { label: "Move", onClick: () => onMoveFile?.(file.id) } : null,
              { label: "Manage access", onClick: () => onShareItem?.({ kind: "drive/files", id: file.id, label: file.name || "File" }) },
              !readOnly ? { label: "Delete", danger: true, onClick: () => onDeleteFile?.(file.id) } : null,
            ].filter(Boolean)}
          />,
        );
      });

      return rows;
    }

    return renderBranch();
  }, [folders, notes, files, currentFolder, selectedId, selectedKind, search, collapsedFolders, onSelectFolder, onSelectNote, onSelectFile, onRenameFolder, onMoveFolder, onDeleteFolder, onRenameNote, onMoveNote, onDeleteNote, onRenameFile, onMoveFile, onDeleteFile, onDownloadFile, onOpenFileInBrowser, onShareItem]);

  const sharedRows = useMemo(() => {
    const q = String(search || "").trim().toLowerCase();
    return (sharedItems || []).map((shared) => {
      const kind = String(shared?.kind || "");
      const id = String(shared?.itemId || shared?.id || "");
      let item = null;
      if (kind === "drive/folders") item = folders.find((row) => row.id === id);
      if (kind === "drive/notes") item = notes.find((row) => row.id === id);
      if (kind === "drive/files") item = files.find((row) => row.id === id);
      if (!item) return null;
      const label = kind === "drive/folders" ? item.name : kind === "drive/notes" ? item.title : item.name;
      if (q && !String(label || "").toLowerCase().includes(q)) return null;
      const icon = kind === "drive/folders" ? <Folder size={15} /> : kind === "drive/notes" ? <FileText size={15} /> : <File size={15} />;
      const onClick = kind === "drive/folders" ? () => onSelectFolder?.(id) : kind === "drive/notes" ? () => onSelectNote?.(id) : () => onSelectFile?.(item);
      return (
        <TreeRow
          key={`shared-${kind}-${id}`}
          icon={icon}
          label={label || "Untitled"}
          hint={shared?.permission === "edit" ? "can edit" : "view only"}
          onClick={onClick}
        />
      );
    }).filter(Boolean);
  }, [sharedItems, folders, notes, files, search, onSelectFolder, onSelectNote, onSelectFile]);

  return (
    <>
      <div className="bf-drive-sidebarShell">
        <div className="bf-drive-sidebarRail">
          <button className={activePane === "explorer" ? "bf-drive-railButton is-active" : "bf-drive-railButton"} type="button" title="Explorer" aria-label="Explorer" onClick={() => setActivePane("explorer")}><Folder size={16} /></button>
          <button className={activePane === "templates" ? "bf-drive-railButton is-active" : "bf-drive-railButton"} type="button" title="Templates" aria-label="Templates" onClick={() => setActivePane("templates")}><LayoutTemplate size={16} /></button>
          <button className={activePane === "shared" ? "bf-drive-railButton is-active" : "bf-drive-railButton"} type="button" title="Shared with me" aria-label="Shared with me" onClick={() => setActivePane("shared")}><Share2 size={16} /></button>
        </div>

        <div
          className="bf-drive-sidebarBody"
          onContextMenu={(event) => {
            if (event.target.closest?.("[data-drive-tree-row]")) return;
            event.preventDefault();
            setBlankContextPoint({ x: event.clientX, y: event.clientY });
          }}
        >
          <div className="bf-drive-sidebarSearch">
            <button className="bf-drive-newButton" type="button" onClick={() => onOpenCreatePicker?.()} aria-label="New">＋</button>
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
            <input className="input bf-drive-searchInput" placeholder={activePane === "explorer" ? "Search Drive" : activePane === "templates" ? "Search templates" : "Search shared items"} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>

          {activePane === "explorer" ? (
            <>
              <div className="bf-drive-sectionHead">
                <div className="bf-drive-sectionLabel">Explorer</div>
                <button
                  className="bf-drive-rootButton"
                  type="button"
                  onClick={() => onSelectFolder?.(null)}
                  onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }}
                  onDrop={handleRootDrop}
                  title="Open root or drop an item here to move it to root"
                >
                  Root
                </button>
              </div>
              <div className="bf-drive-tree">
                {rootItems.length ? rootItems : <div className="helper" style={{ padding: "8px 4px" }}>Nothing here.</div>}
              </div>
            </>
          ) : activePane === "templates" ? (
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
                      icon={<LayoutTemplate size={15} />}
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
          ) : (
            <>
              <div className="bf-drive-sectionHead">
                <div className="bf-drive-sectionLabel">Shared with me</div>
              </div>
              <div className="bf-drive-tree">
                {sharedRows.length ? sharedRows : <div className="helper" style={{ padding: "8px 4px" }}>Nothing has been shared directly with you yet.</div>}
              </div>
            </>
          )}
          <ContextMenu
            point={blankContextPoint}
            onClose={() => setBlankContextPoint(null)}
            items={activePane === "templates"
              ? [
                  { label: "New template", onClick: createTemplate },
                  {
                    label: "Import template",
                    onClick: () => {
                      if (templateImportRef.current) templateImportRef.current.value = "";
                      templateImportRef.current?.click();
                    },
                  },
                  { label: "New note", onClick: onNewNote },
                ]
              : activePane === "shared"
                ? []
                : [
                  { label: "New note", onClick: onNewNote },
                  { label: "New folder", onClick: onNewFolder },
                  { label: "New sheet", onClick: onNewSpreadsheet },
                  { label: "New form", onClick: onNewForm },
                  { label: "Upload files", onClick: onUploadFile },
                  { label: "Upload folder", onClick: onUploadFolder },
                ]}
          />
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
