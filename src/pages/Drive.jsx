import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { api } from "../utils/api.js";
import DriveSidebar from "../components/drive/DriveSidebar.jsx";
import NoteEditor from "../components/drive/NoteEditor.jsx";
import NotePreview from "../components/drive/NotePreview.jsx";
import DriveFilePreview from "../components/drive/DriveFilePreview.jsx";
import Breadcrumbs from "../components/drive/Breadcrumbs.jsx";
import NoteInspector from "../components/drive/NoteInspector.jsx";
import RichTextToolbar from "../components/drive/RichTextToolbar.jsx";
import DriveCreateModal from "../components/drive/DriveCreateModal.jsx";
import DriveShareModal from "../components/drive/DriveShareModal.jsx";
import SpreadsheetFileView from "../components/drive/SpreadsheetFileView.jsx";
import DrawioFileView, { EMPTY_DRAWIO_DIAGRAM } from "../components/drive/DrawioFileView.jsx";
import FormFileView from "../components/drive/FormFileView.jsx";
import { renderTemplate } from "../components/drive/templateEngine.js";
import { buildDriveSharePreparation, cacheDriveShareKey, resolveDriveShareKey } from "../lib/driveSharing.js";

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

async function mapWithConcurrency(items, worker, limit = 6) {
  const values = Array.from(items || []);
  if (!values.length) return [];
  const results = new Array(values.length);
  let nextIndex = 0;
  async function run() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= values.length) return;
      results[index] = await worker(values[index], index);
    }
  }
  const workerCount = Math.min(Math.max(1, Number(limit) || 1), values.length);
  await Promise.all(Array.from({ length: workerCount }, () => run()));
  return results;
}

function parseTags(body) {
  const matches = [...String(body || "").matchAll(/(^|\s)#([a-zA-Z0-9/_-]+)/gim)];
  return [...new Set(matches.map((m) => String(m[2] || "").trim().toLowerCase()).filter(Boolean))];
}
function parseWikiLinks(body) {
  const matches = [...String(body || "").matchAll(/\[\[(.*?)(\|(.*?))?\]\]/gim)];
  return matches.map((m) => String(m[1] || "").trim()).filter(Boolean);
}
function parseFrontmatter(text) {
  const raw = String(text || "");
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { properties: [], body: raw, hasFrontmatter: false };
  const properties = match[1]
    .split("\n")
    .map((line) => {
      const idx = line.indexOf(":");
      if (idx === -1) return null;
      return { key: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim() };
    })
    .filter((x) => x && x.key);
  return { properties, body: raw.slice(match[0].length), hasFrontmatter: true };
}
function serializeFrontmatter(properties, body) {
  const entries = (properties || []).filter((p) => String(p?.key || "").trim() !== "");
  if (!entries.length) return String(body || "");
  const lines = entries.map((p) => `${String(p.key).trim()}: ${String(p.value || "").trim()}`);
  return `---\n${lines.join("\n")}\n---\n\n${String(body || "")}`;
}
function getFileExtension(name) {
  const match = String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : "";
}
function isMarkdownFile(file) {
  const ext = getFileExtension(file?.name);
  return file?.mime === "text/markdown" || ext === "md" || ext === "markdown";
}
function isDocxFile(file) {
  const ext = getFileExtension(file?.name);
  const mime = String(file?.mime || "").toLowerCase();
  return ext === "docx" || mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}
function isDrawioFile(file) {
  const name = String(file?.name || "").toLowerCase();
  const mime = String(file?.mime || "").toLowerCase();
  return name.endsWith(".drawio") || mime === "application/vnd.jgraph.mxfile" || mime.includes("diagrams.net");
}
function isBondfireTemplateFile(file) {
  const ext = getFileExtension(file?.name);
  const mime = String(file?.mime || "").toLowerCase();
  return ext === "bftemplate" || mime === "application/vnd.bondfire.template+json";
}
function isEditableTextFile(file) {
  const ext = getFileExtension(file?.name);
  const mime = String(file?.mime || "");
  if (mime === "application/vnd.bondfire.sheet+json") return true;
  if (mime === "application/vnd.bondfire.form+json") return true;
  if (mime === "application/vnd.jgraph.mxfile" || mime.includes("diagrams.net")) return true;
  return mime.startsWith("text/") || ["md", "markdown", "txt", "json", "js", "jsx", "ts", "tsx", "css", "html", "yml", "yaml", "xml", "csv", "bfsheet", "bfform", "drawio"].includes(ext);
}
function canPreviewFileInApp(file) {
  const mime = String(file?.mime || "");
  if (mime.startsWith("image/")) return true;
  if (mime === "application/pdf") return true;
  if (mime.startsWith("audio/")) return true;
  if (mime.startsWith("video/")) return true;
  if (isDrawioFile(file)) return true;
  if (mime === "application/vnd.bondfire.sheet+json") return true;
  if (mime === "application/vnd.bondfire.form+json") return true;
  if (isDocxFile(file)) return true;
  if (isEditableTextFile(file)) return true;
  return false;
}
function textToDataUrl(text, mime = "text/plain;charset=utf-8") {
  const safeMime = String(mime || "text/plain;charset=utf-8");
  return `data:${safeMime};base64,${btoa(unescape(encodeURIComponent(String(text || ""))))}`;
}
function safeJsonParse(text, fallback = null) {
  try { return JSON.parse(String(text || "")); } catch { return fallback; }
}
function isBondfireSheetFile(file, rawContent = "") {
  const mime = String(file?.mime || "");
  if (mime === "application/vnd.bondfire.sheet+json") return true;
  const ext = getFileExtension(file?.name);
  if (ext === "bfsheet") return true;
  const parsed = safeJsonParse(rawContent, null);
  return parsed?.type === "bondfire-sheet";
}
function isBondfireFormFile(file, rawContent = "") {
  const mime = String(file?.mime || "");
  if (mime === "application/vnd.bondfire.form+json") return true;
  const ext = getFileExtension(file?.name);
  if (ext === "bfform") return true;
  const parsed = safeJsonParse(rawContent, null);
  return parsed?.type === "bondfire-form";
}
function buildStarterSheet() {
  return JSON.stringify({
    type: "bondfire-sheet",
    version: 1,
    columns: ["A", "B", "C", "D"],
    rows: [["", "", "", ""], ["", "", "", ""], ["", "", "", ""]],
  }, null, 2);
}
function buildStarterForm() {
  return JSON.stringify({
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
  }, null, 2);
}

function buildDriveFileUrls(orgId, fileId) {
  const encodedOrgId = encodeURIComponent(String(orgId || ""));
  const encodedFileId = encodeURIComponent(String(fileId || ""));
  const base = `/api/orgs/${encodedOrgId}/drive/files/${encodedFileId}/download`;
  return { previewUrl: base, downloadUrl: `${base}?download=1`, url: base };
}
function withFileUrls(orgId, file) {
  if (!file?.id || file.encrypted) return file;
  return { ...file, ...buildDriveFileUrls(orgId, file.id) };
}

export default function Drive() {
  const { orgId = "" } = useParams();
  const location = useLocation();
  const uiStorageKey = `bf_drive_ui_v14_${orgId}`;

  const [folders, setFolders] = useState([]);
  const [notes, setNotes] = useState([]);
  const [files, setFiles] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [currentFolder, setCurrentFolder] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedKind, setSelectedKind] = useState("note");
  const [title, setTitle] = useState("untitled");
  const [content, setContent] = useState("");
  const [status, setStatus] = useState("saved");
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState("split");
  const [viewModes, setViewModes] = useState({});
  const [uiStateReadyKey, setUiStateReadyKey] = useState("");
  const [focusMode, setFocusMode] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [propertiesCollapsed, setPropertiesCollapsed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(296);
  const [splitRatio, setSplitRatio] = useState(0.5);
  const [loadState, setLoadState] = useState("loading");
  const [loadError, setLoadError] = useState("");
  const [driveNotice, setDriveNotice] = useState("");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() => (typeof window !== "undefined" ? window.innerWidth <= 900 : false));
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [shareTarget, setShareTarget] = useState(null);
  const [sharedItems, setSharedItems] = useState([]);

  const saveTimer = useRef(null);
  const pendingSave = useRef(null);
  const saveDrain = useRef(null);
  const skipNextSave = useRef(false);
  const resizeMode = useRef(null);
  const editorRef = useRef(null);
  const previewScrollRef = useRef(null);
  const scrollSyncLockRef = useRef(false);
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const objectUrlRegistry = useRef(new Set());
  const deepLinkHandled = useRef("");

  const activeViewModeKey = selectedId ? `${selectedKind}:${selectedId}` : "";
  const activeViewMode = ["edit", "read", "split"].includes(viewModes[activeViewModeKey]) ? viewModes[activeViewModeKey] : viewMode;

  function setActiveViewMode(nextMode) {
    const next = ["edit", "read", "split"].includes(nextMode) ? nextMode : "split";
    if (!activeViewModeKey) {
      setViewMode(next);
      return;
    }
    setViewModes((previous) => ({ ...previous, [activeViewModeKey]: next }));
  }

  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(uiStorageKey) || "{}");
      setSidebarWidth(Number.isFinite(raw.sidebarWidth) ? clamp(raw.sidebarWidth, 220, 380) : 296);
      setSplitRatio(Number.isFinite(raw.splitRatio) ? clamp(raw.splitRatio, 0.3, 0.7) : 0.5);
      setViewMode(["edit", "read", "split"].includes(raw.viewMode) ? raw.viewMode : "split");
      setViewModes(raw.viewModes && typeof raw.viewModes === "object" && !Array.isArray(raw.viewModes) ? raw.viewModes : {});
      setInspectorOpen(!!raw.inspectorOpen);
      setPropertiesCollapsed(!!raw.propertiesCollapsed);
    } catch {
      setViewMode("split");
      setViewModes({});
      setInspectorOpen(false);
      setPropertiesCollapsed(false);
    }
    setUiStateReadyKey(uiStorageKey);
  }, [uiStorageKey]);

  useEffect(() => {
    if (uiStateReadyKey !== uiStorageKey) return;
    try {
      localStorage.setItem(uiStorageKey, JSON.stringify({ sidebarWidth, splitRatio, viewMode, viewModes, inspectorOpen, propertiesCollapsed }));
    } catch {}
  }, [uiStorageKey, sidebarWidth, splitRatio, viewMode, viewModes, inspectorOpen, propertiesCollapsed, uiStateReadyKey]);

  async function loadSharedItems() {
    if (!orgId) return;
    try {
      const data = await api(`/api/orgs/${encodeURIComponent(orgId)}/drive/shares?mine=1`);
      setSharedItems(Array.isArray(data?.items) ? data.items : []);
    } catch {
      setSharedItems([]);
    }
  }

  async function loadDrive({ preserveSelection = true } = {}) {
    if (!orgId) return;
    setLoadState("loading");
    setLoadError("");
    try {
      const data = await api(`/api/orgs/${encodeURIComponent(orgId)}/drive`);
      const nextFolders = Array.isArray(data?.folders) ? data.folders : [];
      const nextNotes = Array.isArray(data?.notes) ? data.notes : [];
      const nextFiles = (Array.isArray(data?.files) ? data.files : []).map((file) => withFileUrls(orgId, file));
      const nextTemplates = Array.isArray(data?.templates) ? data.templates : [];
      setFolders(nextFolders);
      setNotes(nextNotes);
      setFiles(nextFiles);
      setTemplates(nextTemplates);
      if (preserveSelection && selectedId) {
        if (selectedKind === "note") {
          const note = nextNotes.find((n) => n.id === selectedId);
          if (note) {
            skipNextSave.current = true;
            setTitle(note.title || "untitled");
            setContent(note.body || "");
          } else {
            setSelectedId(null);
            setTitle("untitled");
            setContent("");
          }
        }
        if (selectedKind === "file") {
          const file = nextFiles.find((f) => f.id === selectedId);
          if (!file) {
            setSelectedId(null);
            setTitle("untitled");
            setContent("");
          }
        }
      }
      setLoadState("ready");
      loadSharedItems();
    } catch (e) {
      setLoadError(String(e?.message || e || "Failed to load Drive"));
      setLoadState("error");
    }
  }

  useEffect(() => {
    loadDrive({ preserveSelection: false });
  }, [orgId]);

  useEffect(() => {
    const raw = new URLSearchParams(location.search || "").get("item") || "";
    if (!raw || raw === deepLinkHandled.current || loadState !== "ready") return;
    const splitAt = raw.indexOf(":");
    if (splitAt < 1) return;
    const kind = raw.slice(0, splitAt);
    const id = raw.slice(splitAt + 1);
    if (!id) return;
    if (kind === "drive/folders" && folders.some((row) => row.id === id)) {
      setCurrentFolder(id);
      deepLinkHandled.current = raw;
      return;
    }
    if (kind === "drive/notes" && notes.some((row) => row.id === id)) {
      const note = notes.find((row) => row.id === id);
      setCurrentFolder(note?.parentId || null);
      selectNote(id);
      deepLinkHandled.current = raw;
      return;
    }
    if (kind === "drive/files" && files.some((row) => row.id === id)) {
      const file = files.find((row) => row.id === id);
      setCurrentFolder(file?.parentId || null);
      openFile(file);
      deepLinkHandled.current = raw;
    }
  }, [location.search, loadState, folders, notes, files]);

  useEffect(() => {
    const folderInput = folderInputRef.current;
    if (folderInput) {
      folderInput.setAttribute("webkitdirectory", "true");
      folderInput.setAttribute("directory", "true");
    }
    return () => {
      objectUrlRegistry.current.forEach((url) => {
        try { URL.revokeObjectURL(url); } catch {}
      });
      objectUrlRegistry.current.clear();
    };
  }, []);

  useEffect(() => {
    const onMove = (e) => {
      if (!resizeMode.current) return;
      if (resizeMode.current === "sidebar") setSidebarWidth(clamp(e.clientX, 220, 380));
      if (resizeMode.current === "split") {
        const main = document.getElementById("bf-drive-editor-zone");
        if (!main) return;
        const rect = main.getBoundingClientRect();
        setSplitRatio(clamp((e.clientX - rect.left) / rect.width, 0.3, 0.7));
      }
    };
    const onUp = () => {
      resizeMode.current = null;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") { e.preventDefault(); createNote(); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); saveNow(); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "1") { e.preventDefault(); setActiveViewMode("edit"); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "2") { e.preventDefault(); setActiveViewMode("read"); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "3") { e.preventDefault(); setActiveViewMode("split"); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "i") { e.preventDefault(); setInspectorOpen((v) => !v); }
      if (e.key === "Escape") {
        if (focusMode) setFocusMode(false);
        setInspectorOpen(false);
        setMenuOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusMode, selectedId, selectedKind, title, content]);

  const selectedNote = selectedKind === "note" ? notes.find((n) => n.id === selectedId) || null : null;
  const selectedFile = selectedKind === "file" ? files.find((f) => f.id === selectedId) || null : null;
  const selectedFileSubtype = selectedKind === "file" && selectedFile ? (isDrawioFile(selectedFile) ? "drawio" : isBondfireSheetFile(selectedFile, content) ? "sheet" : isBondfireFormFile(selectedFile, content) ? "form" : null) : null;
  const fileIsEditable = isEditableTextFile(selectedFile);
  const fileIsMarkdown = isMarkdownFile(selectedFile);
  const isStructuredDriveDoc = selectedFileSubtype === "sheet" || selectedFileSubtype === "form" || selectedFileSubtype === "drawio";
  const selectedAccessItem = selectedKind === "note" ? selectedNote : selectedFile;
  const canEditSelected = selectedAccessItem?.sharePermission !== "view";

  const noteMap = useMemo(() => {
    const map = new Map();
    notes.forEach((note) => map.set(String(note.title || "").trim().toLowerCase(), note.id));
    return map;
  }, [notes]);

  const backlinks = selectedNote ? notes.filter((note) => note.id !== selectedNote.id && parseWikiLinks(note.body).some((link) => link.toLowerCase() === String(selectedNote.title || "").toLowerCase())) : [];

  const explodedFolderCandidates = useMemo(() => folders
    .map((folder) => {
      const directFiles = files.filter((file) => (file.parentId || null) === folder.id);
      const directNotes = notes.filter((note) => (note.parentId || null) === folder.id);
      const childFolders = folders.filter((child) => (child.parentId || null) === folder.id);
      const file = directFiles.length === 1 ? directFiles[0] : null;
      const folderTime = Number(folder.createdAt || folder.created_at || 0);
      const fileTime = Number(file?.createdAt || file?.created_at || 0);
      const createdTogether = !folderTime || !fileTime || Math.abs(folderTime - fileTime) <= 15 * 60 * 1000;
      return directFiles.length === 1 && directNotes.length === 0 && childFolders.length === 0 && createdTogether
        ? { folder, file }
        : null;
    })
    .filter(Boolean), [folders, files, notes]);

  async function repairExplodedFolders() {
    const candidates = explodedFolderCandidates;
    if (candidates.length < 2) {
      setDriveNotice("No likely accidental single-file folders were found to repair.");
      return false;
    }
    if (!window.confirm(`Repair ${candidates.length} likely accidental single-file folders? Each file will be moved to its folder's parent first, and only the now-empty folder will then be deleted. No contained file will be deleted.`)) return false;

    const results = await mapWithConcurrency(candidates, async ({ folder, file }) => {
      try {
        const moved = await moveFileToFolder(file.id, folder.parentId || null);
        const deleted = await api(`/api/orgs/${encodeURIComponent(orgId)}/drive/folders/${encodeURIComponent(folder.id)}`, { method: "DELETE" });
        if (!deleted?.deleted) throw new Error("EMPTY_FOLDER_DELETE_FAILED");
        return { folder, file: moved };
      } catch (error) {
        return { folder, error };
      }
    }, 3);
    const repaired = results.filter((result) => result?.file);
    const failures = results.filter((result) => result?.error);
    if (repaired.length) {
      const removedIds = new Set(repaired.map((result) => result.folder.id));
      const moved = new Map(repaired.map((result) => [result.file.id, result.file]));
      setFolders((previous) => previous.filter((folder) => !removedIds.has(folder.id)));
      setFiles((previous) => previous.map((file) => moved.get(file.id) || file));
      if (currentFolder && removedIds.has(currentFolder)) setCurrentFolder(null);
    }
    if (failures.length) {
      setDriveNotice(`Repaired ${repaired.length} of ${candidates.length} folders. Failed: ${failures.map((result) => `${result.folder.name}: ${String(result.error?.message || result.error || "repair failed")}`).join(" | ")}`);
      return false;
    }
    setDriveNotice(`Repaired ${repaired.length} accidental single-file folder${repaired.length === 1 ? "" : "s"}; all files were preserved.`);
    return true;
  }

  function beginResize(which) {
    resizeMode.current = which;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  }

  async function createFolder() {
    const name = prompt("Folder name?");
    if (!name) return;
    const res = await api(`/api/orgs/${encodeURIComponent(orgId)}/drive/folders`, {
      method: "POST",
      body: JSON.stringify({ name: String(name).trim(), parentId: currentFolder }),
    });
    const folder = res?.folder;
    if (!folder) return;
    setFolders((prev) => [...prev, folder]);
    setCurrentFolder(folder.id);
  }
  async function renameFolder(id) {
    const folder = folders.find((f) => f.id === id);
    const name = prompt("Rename folder", folder?.name || "");
    const cleanName = String(name || "").trim();
    if (!cleanName || cleanName === String(folder?.name || "")) return;
    setDriveNotice("");
    try {
      const res = await api(`/api/orgs/${encodeURIComponent(orgId)}/drive/folders/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ name: cleanName }),
      });
      if (!res?.folder) throw new Error("Folder rename was not acknowledged by the server.");
      setFolders((prev) => prev.map((f) => (f.id === id ? res.folder : f)));
      setDriveNotice(`Renamed folder to "${cleanName}".`);
    } catch (error) {
      setDriveNotice(`Rename failed: ${String(error?.message || error || "unknown error")}`);
    }
  }

  async function moveFolder(id, targetParentId = null) {
    const folder = folders.find((f) => f.id === id);
    if (!folder) return false;
    if (targetParentId === id) return false;
    let cursor = targetParentId;
    const seen = new Set();
    while (cursor) {
      if (cursor === id) {
        setDriveNotice("A folder cannot be moved inside itself.");
        return false;
      }
      if (seen.has(cursor)) break;
      seen.add(cursor);
      cursor = folders.find((f) => f.id === cursor)?.parentId || null;
    }
    setDriveNotice("");
    try {
      const res = await api(`/api/orgs/${encodeURIComponent(orgId)}/drive/folders/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ parentId: targetParentId || null }),
      });
      if (!res?.folder) throw new Error("Folder move was not acknowledged by the server.");
      setFolders((prev) => prev.map((f) => (f.id === id ? res.folder : f)));
      setDriveNotice(`Moved "${folder.name}".`);
      return true;
    } catch (error) {
      setDriveNotice(`Move failed: ${String(error?.message || error || "unknown error")}`);
      return false;
    }
  }
  async function deleteFolder(id) {
    const folder = folders.find((f) => f.id === id);
    if (!folder) return;
    if (!window.confirm(`Delete folder + contents? "${folder.name}" and every nested folder, file, and note inside it will be permanently removed. This cannot be undone.`)) return;
    setDriveNotice("");
    try {
      await api(`/api/orgs/${encodeURIComponent(orgId)}/drive/folders/${encodeURIComponent(id)}`, { method: "DELETE" });
      const descendants = new Set([id]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const candidate of folders) {
          if (candidate.parentId && descendants.has(candidate.parentId) && !descendants.has(candidate.id)) {
            descendants.add(candidate.id);
            changed = true;
          }
        }
      }
      setFolders((prev) => prev.filter((f) => !descendants.has(f.id)));
      setNotes((prev) => prev.filter((n) => !n.parentId || !descendants.has(n.parentId)));
      setFiles((prev) => prev.filter((file) => !file.parentId || !descendants.has(file.parentId)));
      if (currentFolder && descendants.has(currentFolder)) setCurrentFolder(folder.parentId || null);
      const selectedWasDeleted = (selectedKind === "note" && notes.some((note) => note.id === selectedId && descendants.has(note.parentId)))
        || (selectedKind === "file" && files.some((file) => file.id === selectedId && descendants.has(file.parentId)));
      if (selectedWasDeleted) {
        setSelectedId(null);
        setSelectedKind("note");
        setTitle("untitled");
        setContent("");
        setStatus("saved");
      }
      setDriveNotice(`Deleted "${folder.name}" and its contents.`);
    } catch (error) {
      setDriveNotice(`Delete failed: ${String(error?.message || error || "unknown error")}`);
    }
  }

  async function createNoteWithPayload(payload) {
    const res = await api(`/api/orgs/${encodeURIComponent(orgId)}/drive/notes`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const note = res?.note;
    if (!note) return null;
    skipNextSave.current = true;
    setNotes((prev) => [note, ...prev]);
    setSelectedId(note.id);
    setSelectedKind("note");
    setTitle(note.title || "untitled");
    setContent(note.body || "");
    setStatus("saved");
    return note;
  }
  async function createNote() {
    await createNoteWithPayload({ title: "untitled", body: "", parentId: currentFolder, tags: [] });
  }
  async function apiWithTimeout(label, path, options = {}, timeoutMs = 15000) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await api(path, { ...options, signal: options.signal || controller.signal });
    } catch (error) {
      if (controller.signal.aborted && !options.signal) throw new Error(`${label} timed out. Try again.`);
      throw error;
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function withDeadline(label, task, timeoutMs = 15000) {
    let timer = null;
    try {
      return await Promise.race([
        Promise.resolve().then(task),
        new Promise((_, reject) => {
          timer = window.setTimeout(() => reject(new Error(`${label} timed out. Try again.`)), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) window.clearTimeout(timer);
    }
  }

  async function syncPublicFormProjection(fileId, rawContent) {
    const parsed = safeJsonParse(rawContent, null);
    if (!parsed || parsed.type !== "bondfire-form") return;
    const publicShare = parsed.publicShare && typeof parsed.publicShare === "object" ? parsed.publicShare : {};
    if (publicShare.enabled && (!publicShare.token || !publicShare.recipientPublicKey || !publicShare.recipientPrivateKey)) {
      throw new Error("Public form encryption is still initializing. Wait for Saved before opening the public link.");
    }
    await apiWithTimeout("Public form sync", `/api/orgs/${encodeURIComponent(orgId)}/drive/forms-public`, {
      method: "POST",
      body: JSON.stringify({
        fileId,
        enabled: !!publicShare.enabled,
        token: String(publicShare.token || ""),
        recipientEpoch: Number(publicShare.recipientEpoch || 1),
        recipientPublicKey: publicShare.recipientPublicKey || null,
        form: {
          type: "bondfire-form",
          version: 3,
          title: String(parsed.title || "Untitled form"),
          description: String(parsed.description || ""),
          blocks: Array.isArray(parsed.blocks) ? parsed.blocks : [],
          fields: Array.isArray(parsed.fields) ? parsed.fields : [],
        },
      }),
    });
  }

  async function verifyPublicFormProjection(fileId, rawContent) {
    const parsed = safeJsonParse(rawContent, null);
    const publicShare = parsed?.publicShare && typeof parsed.publicShare === "object" ? parsed.publicShare : {};
    if (!parsed || parsed.type !== "bondfire-form" || !publicShare.enabled) return true;
    if (!publicShare.token) throw new Error("Public form token is missing.");
    await apiWithTimeout(
      "Public form check",
      `/api/public/forms/${encodeURIComponent(fileId)}?token=${encodeURIComponent(String(publicShare.token))}&format=json`,
      {},
      10000,
    );
    return true;
  }

  async function createFileWithPayload(payload) {
    const mime = String(payload?.mime || "text/plain;charset=utf-8");
    const textContent = String(payload?.textContent || "");
    const res = await api(`/api/orgs/${encodeURIComponent(orgId)}/drive/files`, {
      method: "POST",
      body: JSON.stringify({
        name: payload?.name || "untitled.txt",
        parentId: payload?.parentId ?? currentFolder,
        mime,
        size: new Blob([textContent], { type: mime }).size,
        textContent,
        dataUrl: textToDataUrl(textContent, mime),
      }),
    });
    const file = res?.file ? withFileUrls(orgId, res.file) : null;
    if (!file) return null;
    setFiles((prev) => [file, ...prev.filter((existing) => existing.id !== file.id)]);
    skipNextSave.current = true;
    setSelectedId(file.id);
    setSelectedKind("file");
    setTitle(file.name || "untitled");
    setContent(file.textContent || textContent);
    if (isBondfireFormFile(file, textContent)) await syncPublicFormProjection(file.id, textContent);
    setStatus("saved");
    return file;
  }
  async function createSpreadsheet() {
    await createFileWithPayload({
      name: `${new Date().toISOString().slice(0, 10)} sheet.bfsheet`,
      mime: "application/vnd.bondfire.sheet+json",
      textContent: buildStarterSheet(),
    });
  }
  async function createForm() {
    await createFileWithPayload({
      name: `${new Date().toISOString().slice(0, 10)} form.bfform`,
      mime: "application/vnd.bondfire.form+json",
      textContent: buildStarterForm(),
    });
  }
  async function createDrawio() {
    await createFileWithPayload({
      name: `${new Date().toISOString().slice(0, 10)} diagram.drawio`,
      mime: "application/vnd.jgraph.mxfile",
      textContent: EMPTY_DRAWIO_DIAGRAM,
    });
  }
  async function createNoteFromTemplate(template) {
    const renderedTitle = renderTemplate(template.title || template.name || "untitled", {});
    const renderedBody = renderTemplate(template.body || "", { title: renderedTitle });
    await createNoteWithPayload({ title: renderedTitle, body: renderedBody, parentId: currentFolder, tags: [] });
  }
  function selectNote(id) {
    const note = notes.find((n) => n.id === id);
    if (!note) return;
    skipNextSave.current = true;
    setSelectedId(id);
    setSelectedKind("note");
    setTitle(note.title || "untitled");
    setContent(note.body || "");
    setStatus("saved");
  }
  async function renameNote(id) {
    const note = notes.find((n) => n.id === id);
    const name = prompt("Rename note", note?.title || "");
    if (!name) return;
    const res = await api(`/api/orgs/${encodeURIComponent(orgId)}/drive/notes/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ title: String(name).trim() }),
    });
    if (!res?.note) return;
    setNotes((prev) => prev.map((n) => (n.id === id ? res.note : n)));
    if (selectedId === id && selectedKind === "note") {
      skipNextSave.current = true;
      setTitle(res.note.title || "untitled");
      setContent(res.note.body || "");
      setStatus("saved");
    }
  }
  async function deleteNote(id) {
    await api(`/api/orgs/${encodeURIComponent(orgId)}/drive/notes/${encodeURIComponent(id)}`, { method: "DELETE" });
    setNotes((prev) => prev.filter((n) => n.id !== id));
    if (selectedId === id && selectedKind === "note") {
      setSelectedId(null);
      setTitle("untitled");
      setContent("");
      setStatus("saved");
    }
  }
  async function moveNote(id, targetParentId = undefined) {
    const target = targetParentId === undefined ? prompt("Move to folderId (blank for root)", currentFolder || "") : targetParentId;
    if (target === null) return false;
    try {
      const res = await api(`/api/orgs/${encodeURIComponent(orgId)}/drive/notes/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ parentId: target || null }),
      });
      if (!res?.note) throw new Error("Note move was not acknowledged by the server.");
      setNotes((prev) => prev.map((n) => (n.id === id ? res.note : n)));
      return true;
    } catch (error) {
      setDriveNotice(`Move failed: ${String(error?.message || error || "unknown error")}`);
      return false;
    }
  }

  async function renameFile(id) {
    const file = files.find((f) => f.id === id);
    const name = prompt("Rename file", file?.name || "");
    if (!name) return;
    const res = await api(`/api/orgs/${encodeURIComponent(orgId)}/drive/files/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ name: String(name).trim() }),
    });
    if (!res?.file) return;
    setFiles((prev) => prev.map((f) => (f.id === id ? withFileUrls(orgId, { ...f, ...res.file }) : f)));
    if (selectedId === id && selectedKind === "file") {
      skipNextSave.current = true;
      setTitle(res.file.name || "untitled");
      setContent(res.file.textContent || content);
      setStatus("saved");
    }
  }
  async function deleteFile(id) {
    await api(`/api/orgs/${encodeURIComponent(orgId)}/drive/files/${encodeURIComponent(id)}`, { method: "DELETE" });
    setFiles((prev) => prev.filter((f) => f.id !== id));
    if (selectedId === id && selectedKind === "file") {
      setSelectedId(null);
      setTitle("untitled");
      setContent("");
      setStatus("saved");
    }
  }
  async function moveFileToFolder(id, targetParentId = null) {
    try {
      const res = await api(`/api/orgs/${encodeURIComponent(orgId)}/drive/files/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ parentId: targetParentId || null }),
      });
      if (!res?.file) throw new Error("File move was not acknowledged by the server.");
      const updated = withFileUrls(orgId, { ...files.find((file) => file.id === id), ...res.file });
      setFiles((prev) => prev.map((f) => (f.id === id ? updated : f)));
      return updated;
    } catch (error) {
      throw error;
    }
  }

  async function moveFile(id, targetParentId = undefined) {
    const target = targetParentId === undefined ? prompt("Move to folderId (blank for root)", currentFolder || "") : targetParentId;
    if (target === null) return false;
    try {
      await moveFileToFolder(id, target || null);
      return true;
    } catch (error) {
      setDriveNotice(`Move failed: ${String(error?.message || error || "unknown error")}`);
      return false;
    }
  }

  async function moveFilesToFolder(ids, targetParentId = null) {
    const uniqueIds = [...new Set((ids || []).map((id) => String(id)).filter(Boolean))];
    if (!uniqueIds.length) return false;
    const results = await mapWithConcurrency(uniqueIds, async (id) => {
      try {
        return { id, file: await moveFileToFolder(id, targetParentId || null) };
      } catch (error) {
        return { id, error };
      }
    }, 4);
    const failed = results.filter((result) => result?.error);
    if (failed.length) {
      setDriveNotice(`Moved ${results.length - failed.length} of ${results.length} files. Failed: ${failed.map((result) => `${result.id}: ${String(result.error?.message || result.error || "move failed")}`).join(" | ")}`);
      return false;
    }
    setDriveNotice(`Moved ${results.length} file${results.length === 1 ? "" : "s"}.`);
    return true;
  }

  async function moveFiles(ids) {
    const uniqueIds = [...new Set((ids || []).map((id) => String(id)).filter(Boolean))];
    if (!uniqueIds.length) return false;
    const target = prompt("Move selected files to folderId (blank for root)", currentFolder || "");
    if (target === null) return false;
    return moveFilesToFolder(uniqueIds, String(target || "").trim() || null);
  }

  async function deleteFiles(ids) {
    const uniqueIds = [...new Set((ids || []).map((id) => String(id)).filter(Boolean))];
    const targets = files.filter((file) => uniqueIds.includes(String(file.id)));
    if (!targets.length) return false;
    if (!window.confirm(`Delete ${targets.length} selected file${targets.length === 1 ? "" : "s"} permanently? This cannot be undone.`)) return false;
    const results = await mapWithConcurrency(targets, async (file) => {
      try {
        const result = await api(`/api/orgs/${encodeURIComponent(orgId)}/drive/files/${encodeURIComponent(file.id)}`, { method: "DELETE" });
        if (!result?.deleted) throw new Error("FILE_DELETE_FAILED");
        return { id: String(file.id) };
      } catch (error) {
        return { id: String(file.id), error };
      }
    }, 4);
    const deletedIds = new Set(results.filter((result) => !result.error).map((result) => result.id));
    const failures = results.filter((result) => result.error);
    if (deletedIds.size) setFiles((previous) => previous.filter((file) => !deletedIds.has(String(file.id))));
    if (selectedKind === "file" && deletedIds.has(String(selectedId))) {
      setSelectedId(null);
      setSelectedKind("note");
      setTitle("untitled");
      setContent("");
      setStatus("saved");
    }
    if (failures.length) {
      setDriveNotice(`Deleted ${deletedIds.size} of ${targets.length} files. Failed: ${failures.map((result) => `${result.id}: ${String(result.error?.message || result.error || "delete failed")}`).join(" | ")}`);
      return false;
    }
    setDriveNotice(`Deleted ${deletedIds.size} file${deletedIds.size === 1 ? "" : "s"}.`);
    return true;
  }

  async function hydrateFile(fileId) {
    const res = await api(`/api/orgs/${encodeURIComponent(orgId)}/drive/files/${encodeURIComponent(fileId)}`);
    const hydrated = res?.file || null;
    if (!hydrated) return null;
    setFiles((prev) => prev.map((f) => (f.id === fileId ? withFileUrls(orgId, { ...f, ...hydrated }) : f)));
    return hydrated;
  }

  function openFileInBrowser(file) {
    const name = String(file?.name || "");
    const mime = String(file?.mime || "");
    const textContent = String(file?.textContent || "");
    if (isDrawioFile(file)) {
      if (file?.encrypted && !window.confirm("This will send this decrypted diagram to diagrams.net in your browser. Continue?")) return;
      window.open(`https://app.diagrams.net/#R${encodeURIComponent(textContent || EMPTY_DRAWIO_DIAGRAM)}`, "_blank", "noopener,noreferrer");
      return;
    }
    if ((/\.bfform$/i.test(name) || mime === "application/vnd.bondfire.form+json") && textContent) {
      try {
        const parsed = JSON.parse(textContent);
        const token = String(parsed?.publicShare?.token || "");
        if (parsed?.publicShare?.enabled && token) {
          window.open(`${window.location.origin}/api/public/forms/${encodeURIComponent(file.id)}?token=${encodeURIComponent(token)}`, "_blank", "noopener,noreferrer");
          return;
        }
        const blob = new Blob([`<!doctype html><html><head><meta charset="utf-8" /><title>${name}</title><style>body{font-family:Inter,system-ui,sans-serif;background:#090909;color:#fff;padding:24px}pre{white-space:pre-wrap;background:#111214;border:1px solid #232427;border-radius:12px;padding:16px}</style></head><body><h1>${name}</h1><pre>${textContent.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre></body></html>`], { type: "text/html" });
        window.open(URL.createObjectURL(blob), "_blank", "noopener,noreferrer");
        return;
      } catch {}
    }
    if ((/\.bfsheet$/i.test(name) || mime === "application/vnd.bondfire.sheet+json") && textContent) {
      try {
        const parsed = JSON.parse(textContent);
        const sheet = Array.isArray(parsed?.sheets) && parsed.sheets.length ? parsed.sheets[0] : null;
        const rows = Math.max(25, Number(sheet?.rowCount || 25));
        const cols = Math.max(10, Number(sheet?.columnCount || 10));
        const labels = Array.from({ length: cols }, (_, idx) => {
          let n = idx + 1; let out = ""; while (n > 0) { const rem = (n - 1) % 26; out = String.fromCharCode(65 + rem) + out; n = Math.floor((n - 1) / 26); } return out;
        });
        const cells = sheet?.cells || {};
        const esc = (value) => String(value || "").replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        const table = `<table><thead><tr><th>#</th>${labels.map((label)=>`<th>${label}</th>`).join("")}</tr></thead><tbody>${Array.from({ length: rows }, (_, r)=>`<tr><th>${r+1}</th>${labels.map((label)=>`<td>${esc(cells[`${label}${r+1}`]?.input || "")}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
        const blob = new Blob([`<!doctype html><html><head><meta charset="utf-8" /><title>${name}</title><style>body{font-family:Inter,system-ui,sans-serif;background:#090909;color:#fff;padding:24px}table{border-collapse:collapse;background:#111214}th,td{border:1px solid #26282c;padding:8px 10px;min-width:120px}th{background:#15171b;position:sticky;top:0}</style></head><body><h1>${name}</h1>${table}</body></html>`], { type: "text/html" });
        window.open(URL.createObjectURL(blob), "_blank", "noopener,noreferrer");
        return;
      } catch {}
    }
    if (file?.dataUrl) {
      const a = document.createElement("a");
      a.href = file.dataUrl;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.click();
      return;
    }
    window.open(file?.previewUrl || `/api/orgs/${encodeURIComponent(orgId)}/drive/files/${encodeURIComponent(file.id)}/download`, "_blank", "noopener,noreferrer");
  }
  async function openFile(file) {
    let nextFile = withFileUrls(orgId, file);
    if (!nextFile) return;
    if ((nextFile.encrypted || isEditableTextFile(nextFile) || isDocxFile(nextFile)) && !nextFile.textContent && !nextFile.dataUrl) {
      nextFile = await hydrateFile(nextFile.id);
      if (!nextFile) return;
      nextFile = withFileUrls(orgId, nextFile);
    }
    if (canPreviewFileInApp(nextFile)) {
      if (isBondfireFormFile(nextFile, nextFile.textContent || "")) {
        try {
          await syncPublicFormProjection(nextFile.id, nextFile.textContent || "");
        } catch (error) {
          setDriveNotice(`Public form sync needs a save: ${String(error?.message || error || "unknown error")}`);
        }
      }
      skipNextSave.current = true;
      setSelectedId(nextFile.id);
      setSelectedKind("file");
      setTitle(nextFile.name || "untitled");
      setContent(nextFile.textContent || "");
      setStatus("saved");
      return;
    }
    openFileInBrowser(nextFile);
  }
  async function downloadFile(file) {
    if (file.encrypted) {
      const hydrated = file.dataUrl ? file : await hydrateFile(file.id);
      if (!hydrated?.dataUrl) throw new Error('Encrypted file could not be opened.');
      const link = document.createElement('a'); link.href = hydrated.dataUrl; link.download = hydrated.name || 'download'; link.click(); return;
    }
    const a = document.createElement("a");
    a.href = file?.downloadUrl || `/api/orgs/${encodeURIComponent(orgId)}/drive/files/${encodeURIComponent(file.id)}/download?download=1`;
    a.download = file.name || "download";
    a.click();
  }

  async function downloadFiles(ids) {
    const targets = (ids || [])
      .map((id) => files.find((file) => String(file.id) === String(id)))
      .filter(Boolean);
    const failures = [];
    for (const [index, file] of targets.entries()) {
      try {
        await downloadFile(file);
      } catch (error) {
        failures.push(`${file.name || file.id}: ${String(error?.message || error || "download failed")}`);
      }
      if (index < targets.length - 1) await new Promise((resolve) => window.setTimeout(resolve, 120));
    }
    if (failures.length) setDriveNotice(`Downloaded ${targets.length - failures.length} of ${targets.length} files. Failed: ${failures.join(" | ")}`);
  }

  function currentSaveSnapshot() {
    return {
      id: selectedId,
      kind: selectedKind,
      title,
      content,
      canEdit: canEditSelected,
      fileEditable: fileIsEditable,
      fileMarkdown: fileIsMarkdown,
      fileSubtype: selectedFileSubtype,
      fileMime: selectedFile?.mime || "",
    };
  }

  async function persistSaveSnapshot(snapshot) {
    if (!snapshot?.id) return;
    if (snapshot.kind === "note") {
      const parsed = parseFrontmatter(snapshot.content);
      const propertyTags = parsed.properties.find((p) => p.key.toLowerCase() === "tags")?.value || "";
      const combinedTags = [...new Set([...parseTags(parsed.body), ...String(propertyTags).split(",").map((x) => x.trim().toLowerCase()).filter(Boolean)])];
      const res = await api(`/api/orgs/${encodeURIComponent(orgId)}/drive/notes/${encodeURIComponent(snapshot.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ title: snapshot.title, body: snapshot.content, tags: combinedTags }),
      });
      if (res?.note) setNotes((prev) => prev.map((n) => (n.id === snapshot.id ? res.note : n)));
      return;
    }
    if (snapshot.kind === "file" && snapshot.fileEditable) {
      const mime = snapshot.fileMime || (snapshot.fileMarkdown ? "text/markdown;charset=utf-8" : "text/plain;charset=utf-8");
      const dataUrl = textToDataUrl(snapshot.content, mime);
      const res = await api(`/api/orgs/${encodeURIComponent(orgId)}/drive/files/${encodeURIComponent(snapshot.id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: snapshot.title,
          mime,
          size: new Blob([snapshot.content], { type: mime }).size,
          dataUrl,
          textContent: snapshot.content,
        }),
      });
      if (res?.file) {
        setFiles((prev) => prev.map((file) => (file.id === snapshot.id ? withFileUrls(orgId, { ...file, ...res.file }) : file)));
      }
      if (snapshot.fileSubtype === "form") await syncPublicFormProjection(snapshot.id, snapshot.content);
    }
  }

  async function saveNow() {
    const snapshot = currentSaveSnapshot();
    if (!snapshot.id) return false;
    if (!snapshot.canEdit) {
      setStatus("view only");
      return false;
    }
    pendingSave.current = snapshot;
    setStatus("saving");

    if (!saveDrain.current) {
      const run = (async () => {
        while (pendingSave.current) {
          const next = pendingSave.current;
          pendingSave.current = null;
          await persistSaveSnapshot(next);
        }
      })();
      saveDrain.current = run.finally(() => {
        saveDrain.current = null;
      });
    }

    try {
      await saveDrain.current;
      if (!pendingSave.current) {
        setStatus("saved");
        setDriveNotice((notice) => notice.startsWith("Save failed:") ? "" : notice);
      }
      return true;
    } catch (error) {
      pendingSave.current = null;
      setStatus("error");
      setDriveNotice(`Save failed: ${String(error?.message || error || "unknown error")}`);
      return false;
    }
  }

  async function flushPendingDriveSave() {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
      return saveNow();
    }
    if (saveDrain.current) {
      try {
        await saveDrain.current;
        return true;
      } catch {
        return false;
      }
    }
    if (status === "saved") return true;
    return saveNow();
  }

  async function flushSaveBeforePublicUse() {
    const saved = await flushPendingDriveSave();
    if (!saved) return false;
    if (selectedKind === "file" && selectedFileSubtype === "form" && selectedId) {
      try {
        await syncPublicFormProjection(selectedId, content);
        await verifyPublicFormProjection(selectedId, content);
        return true;
      } catch (error) {
        setDriveNotice(`Public form sync failed: ${String(error?.message || error || "unknown error")}`);
        return false;
      }
    }
    return true;
  }

  useEffect(() => {
    if (!selectedId) return;
    if (selectedKind !== "note" && !(selectedKind === "file" && fileIsEditable)) return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    setStatus("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { saveTimer.current = null; void saveNow(); }, 350);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [selectedId, selectedKind, title, content, fileIsEditable]);

  async function fileToStoredRecord(file, parentId, relativePath = "") {
    let textContent = "";
    if (isEditableTextFile({ name: file?.name, mime: file?.type })) {
      try { textContent = await file.text(); } catch {}
    }
    return {
      name: file?.name || "file",
      parentId,
      updatedAt: Date.now(),
      size: Number(file?.size || 0),
      mime: file?.type || "application/octet-stream",
      textContent,
      relativePath,
    };
  }

  async function uploadFileRecord(rawFile, parentId, relativePath = "", { deferState = false } = {}) {
    if (isBondfireTemplateFile(rawFile)) {
      let parsed = null;
      try {
        parsed = JSON.parse(await rawFile.text());
      } catch {
        throw new Error(`${rawFile.name}: invalid Bondfire template file.`);
      }
      const template = parsed?.template && typeof parsed.template === "object" ? parsed.template : parsed;
      const name = String(template?.name || template?.title || rawFile.name.replace(/\.bftemplate$/i, "") || "Template").trim();
      const title = String(template?.title || "");
      const body = String(template?.body || template?.content || "");
      if (!body.trim()) throw new Error(`${rawFile.name}: template body is empty.`);
      const res = await api(`/api/orgs/${encodeURIComponent(orgId)}/drive/templates`, {
        method: "POST",
        body: JSON.stringify({ name, title, body }),
      });
      if (!res?.template) throw new Error(`${rawFile.name}: template import was not acknowledged by the server.`);
      setTemplates((prev) => [res.template, ...prev.filter((tpl) => tpl.id !== res.template.id)]);
      return { ...res.template, importedTemplate: true };
    }

    const record = await fileToStoredRecord(rawFile, parentId, relativePath);
    const isPreviewableBinary = canPreviewFileInApp(record) && !isEditableTextFile(record);
    const localPreviewUrl = isPreviewableBinary ? URL.createObjectURL(rawFile) : "";
    if (localPreviewUrl) objectUrlRegistry.current.add(localPreviewUrl);

    const tempId = `uploading_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const optimisticFile = withFileUrls(orgId, {
      id: tempId,
      ...record,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      previewObjectUrl: localPreviewUrl || undefined,
      isUploading: true,
    });
    if (!deferState) setFiles((prev) => [optimisticFile, ...prev.filter((existing) => existing.id !== tempId)]);

    try {
      const headers = {
        "x-drive-name": record.name || rawFile.name || "file",
        "x-drive-mime": record.mime || rawFile.type || "application/octet-stream",
      };
      if (parentId) headers["x-drive-parent-id"] = String(parentId);
      if (relativePath) headers["x-drive-relative-path"] = String(relativePath);

      const res = isEditableTextFile(record)
        ? await api(`/api/orgs/${encodeURIComponent(orgId)}/drive/files`, {
            method: "POST",
            body: JSON.stringify({
              name: record.name,
              parentId: parentId || null,
              mime: record.mime,
              size: record.size,
              textContent: record.textContent,
              dataUrl: textToDataUrl(record.textContent, record.mime),
            }),
          })
        : await api(`/api/orgs/${encodeURIComponent(orgId)}/drive/files`, {
            method: "POST", headers, body: rawFile,
          });

      const createdFile = res?.file || (res?.id ? { id: res.id } : null);
      if (!createdFile?.id) throw new Error("UPLOAD_FAILED");

      const nextFile = withFileUrls(orgId, {
        ...record,
        ...createdFile,
        previewObjectUrl: localPreviewUrl || undefined,
      });
      if (!deferState) setFiles((prev) => [nextFile, ...prev.filter((existing) => existing.id !== tempId && existing.id !== nextFile.id)]);
      if (isBondfireFormFile(nextFile, record.textContent)) await syncPublicFormProjection(nextFile.id, record.textContent);
      return nextFile;
    } catch (error) {
      if (!deferState) setFiles((prev) => prev.filter((existing) => existing.id !== tempId));
      if (localPreviewUrl) {
        try { URL.revokeObjectURL(localPreviewUrl); } catch {}
        objectUrlRegistry.current.delete(localPreviewUrl);
      }
      throw error;
    }
  }

  function folderIndexKey(parentId, name) {
    return `${parentId || "__root__"}\u0000${String(name || "")}`;
  }

  async function uploadFilesToFolder(fileList, targetFolder = currentFolder) {
    const chosen = Array.from(fileList || []);
    if (!chosen.length) return false;
    setDriveNotice(`Uploading ${chosen.length} file${chosen.length === 1 ? "" : "s"}…`);
    const results = await mapWithConcurrency(chosen, async (rawFile) => {
      try {
        return { file: await uploadFileRecord(rawFile, targetFolder || null, "", { deferState: true }) };
      } catch (error) {
        console.error("Drive file upload failed", rawFile?.name, error);
        return { name: rawFile?.name || "file", error };
      }
    }, 6);
    const createdFiles = results.map((result) => result?.file).filter((file) => file && !file.importedTemplate);
    if (createdFiles.length) {
      const createdIds = new Set(createdFiles.map((file) => file.id));
      setFiles((previous) => [...createdFiles, ...previous.filter((file) => !createdIds.has(file.id))]);
    }
    const failures = results.filter((result) => result?.error);
    if (failures.length) {
      setDriveNotice(`Uploaded ${results.length - failures.length} of ${results.length} files. Failed: ${failures.map((result) => `${result.name}: ${String(result.error?.message || result.error || "upload failed")}`).join(" | ")}`);
      return false;
    }
    setDriveNotice(`Uploaded all ${createdFiles.length} file${createdFiles.length === 1 ? "" : "s"}.`);
    return true;
  }

  async function onUploadFiles(event) {
    const input = event.target;
    await uploadFilesToFolder(input.files, currentFolder);
    input.value = "";
  }

  async function ensureFolderChain(segments, context = {}) {
    let parentId = context.baseParentId ?? currentFolder;
    const folderIndex = context.folderIndex || new Map();
    const pendingByKey = context.pendingByKey || new Map();
    const createdFolders = context.createdFolders || new Map();
    for (const rawSegment of segments) {
      const segment = String(rawSegment || "").trim();
      if (!segment) continue;
      const key = folderIndexKey(parentId, segment);
      let existing = folderIndex.get(key) || null;
      if (!existing && pendingByKey.has(key)) existing = await pendingByKey.get(key);
      if (!existing) {
        const request = api(`/api/orgs/${encodeURIComponent(orgId)}/drive/folders`, {
          method: "POST",
          body: JSON.stringify({ name: segment, parentId }),
        }).then((res) => {
          const folder = res?.folder || null;
          if (!folder) throw new Error(`Could not create folder "${segment}".`);
          folderIndex.set(key, folder);
          createdFolders.set(folder.id, folder);
          return folder;
        });
        pendingByKey.set(key, request);
        existing = await request;
      }
      parentId = existing.id;
    }
    return parentId;
  }

  async function onUploadFolder(event) {
    const chosen = Array.from(event.target.files || []);
    if (!chosen.length) return;
    setDriveNotice(`Uploading ${chosen.length} file${chosen.length === 1 ? "" : "s"}…`);
    const pathEntries = chosen.map((file) => {
      const relativePath = String(file.webkitRelativePath || "");
      return { file, relativePath, segments: relativePath.split("/").filter(Boolean) };
    });
    const sharedRoot = pathEntries[0]?.segments?.[0] || "";
    const hasCoherentRoot = !!sharedRoot && pathEntries.every((entry) => entry.segments.length >= 2 && entry.segments[0] === sharedRoot);
    const folderContext = {
      baseParentId: currentFolder,
      folderIndex: new Map(folders.map((folder) => [folderIndexKey(folder.parentId || null, folder.name), folder])),
      pendingByKey: new Map(),
      createdFolders: new Map(),
    };
    const results = await mapWithConcurrency(pathEntries, async (entry) => {
      const parts = entry.segments.length ? entry.segments : [entry.file.name];
      const fileName = parts.at(-1) || entry.file.name || "file";
      const foldersForFile = hasCoherentRoot ? parts.slice(0, -1) : [];
      const rel = hasCoherentRoot ? entry.relativePath : "";
      try {
        const parentId = foldersForFile.length ? await ensureFolderChain(foldersForFile, folderContext) : currentFolder;
        const wrapped = new File([entry.file], fileName, { type: entry.file.type, lastModified: entry.file.lastModified });
        return { file: await uploadFileRecord(wrapped, parentId, rel, { deferState: true }), label: entry.relativePath || fileName };
      } catch (error) {
        console.error("Drive folder upload failed", entry.relativePath || entry.file?.name, error);
        return { label: entry.relativePath || entry.file?.name || "file", error };
      }
    }, 6);
    const createdFolders = [...folderContext.createdFolders.values()];
    if (createdFolders.length) setFolders((previous) => [...previous, ...createdFolders.filter((folder) => !previous.some((existing) => existing.id === folder.id))]);
    const createdFiles = results.map((result) => result?.file).filter((file) => file && !file.importedTemplate);
    if (createdFiles.length) {
      const createdIds = new Set(createdFiles.map((file) => file.id));
      setFiles((previous) => [...createdFiles, ...previous.filter((file) => !createdIds.has(file.id))]);
    }
    event.target.value = "";
    const failures = results.filter((result) => result?.error);
    if (failures.length) setDriveNotice(`Uploaded ${results.length - failures.length} of ${results.length} files. Failed: ${failures.map((result) => `${result.label}: ${String(result.error?.message || result.error || "upload failed")}`).join(" | ")}`);
    else setDriveNotice(`Uploaded all ${createdFiles.length} files.`);
  }

  async function onDropFilesOnFolder(fileList, folderId) {
    await uploadFilesToFolder(fileList, folderId || null);
  }

  async function openLinkedNoteByTitle(rawTitle) {
    const clean = String(rawTitle || "").trim();
    const existingId = noteMap.get(clean.toLowerCase());
    if (existingId) {
      const n = notes.find((x) => x.id === existingId);
      setCurrentFolder(n?.parentId || null);
      selectNote(existingId);
      return;
    }
    if (!window.confirm(`Create note "${clean}"?`)) return;
    await createNoteWithPayload({ title: clean || "untitled", body: "", parentId: currentFolder, tags: [] });
  }

  function wrapSelection(prefix, suffix = prefix) {
    const el = editorRef.current;
    if (!el) return;
    const start = el.selectionStart || 0;
    const end = el.selectionEnd || 0;
    const selected = content.slice(start, end);
    setContent(content.slice(0, start) + prefix + selected + suffix + content.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + prefix.length, end + prefix.length);
    });
  }
  function insertLink() {
    const el = editorRef.current;
    if (!el) return;
    const start = el.selectionStart || 0;
    const end = el.selectionEnd || 0;
    const selected = content.slice(start, end);
    const label = selected || window.prompt("Link text", "Link");
    if (!label) return;
    const rawUrl = window.prompt("Link URL", "https://");
    const url = String(rawUrl || "").trim();
    if (!url || url === "https://") return;
    const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(url);
    if (url.startsWith("//") || (hasScheme && !/^(https?|mailto|tel):/i.test(url))) {
      window.alert("That link uses an unsafe URL scheme. Use https, http, mailto, tel, or a normal relative link.");
      return;
    }
    const insertion = `[${String(label).replace(/\n/g, " ")}](${url})`;
    setContent(content.slice(0, start) + insertion + content.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + insertion.length, start + insertion.length);
    });
  }
  function prefixLines(prefix) {
    const el = editorRef.current;
    if (!el) return;
    const start = el.selectionStart || 0;
    const end = el.selectionEnd || 0;
    const selected = content.slice(start, end) || "";
    const nextSelected = selected.split("\n").map((line) => `${prefix}${line}`).join("\n");
    setContent(content.slice(0, start) + nextSelected + content.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start, start + nextSelected.length);
    });
  }
  function insertBlock(block) {
    const el = editorRef.current;
    if (!el) return;
    const start = el.selectionStart || 0;
    setContent(content.slice(0, start) + block + content.slice(start));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + block.length, start + block.length);
    });
  }
  function insertFrontmatterTemplate() {
    const parsed = parseFrontmatter(content);
    if (parsed.hasFrontmatter) return;
    setContent(serializeFrontmatter([{ key: "type", value: "bit-log" }, { key: "date", value: "" }, { key: "status", value: "" }, { key: "tags", value: "" }], content));
  }
  function updateFrontmatterProperty(key, value) {
    const parsed = parseFrontmatter(content);
    setContent(serializeFrontmatter(parsed.properties.map((p) => (p.key === key ? { ...p, value } : p)), parsed.body));
  }
  function addFrontmatterProperty() {
    const parsed = parseFrontmatter(content);
    const key = prompt("Property name?");
    if (!key) return;
    if (!parsed.hasFrontmatter) {
      setContent(serializeFrontmatter([{ key: String(key).trim(), value: "" }], content));
      return;
    }
    if (parsed.properties.some((p) => p.key === String(key).trim())) return;
    setContent(serializeFrontmatter([...parsed.properties, { key: String(key).trim(), value: "" }], parsed.body));
  }
  function removeFrontmatterProperty(key) {
    const parsed = parseFrontmatter(content);
    setContent(serializeFrontmatter(parsed.properties.filter((p) => p.key !== key), parsed.body));
  }
  async function saveCurrentAsTemplate() {
    if (!content) return;
    const name = prompt("Template name?", title || "Untitled template");
    if (!name) return;
    const res = await api(`/api/orgs/${encodeURIComponent(orgId)}/drive/templates`, {
      method: "POST",
      body: JSON.stringify({ name: String(name).trim(), title: title || "untitled", body: content || "" }),
    });
    if (res?.template) {
      setTemplates((prev) => [res.template, ...prev.filter((x) => x.id !== res.template.id)]);
    }
  }
  async function editTemplate(id) {
    const tpl = templates.find((x) => x.id === id);
    if (!tpl) return;
    const nextName = prompt("Template name", tpl.name || "");
    if (nextName === null) return;
    const nextTitle = prompt("Template note title", tpl.title || "");
    if (nextTitle === null) return;
    const nextBody = prompt("Template body", tpl.body || "");
    if (nextBody === null) return;
    const res = await api(`/api/orgs/${encodeURIComponent(orgId)}/drive/templates/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ name: String(nextName).trim(), title: String(nextTitle), body: String(nextBody) }),
    });
    if (res?.template) setTemplates((prev) => prev.map((x) => (x.id === id ? res.template : x)));
  }
  async function applyTemplate(template) {
    if (!template) return;
    const renderedTitle = renderTemplate(template.title || template.name || "untitled", { title });
    const renderedBody = renderTemplate(template.body || "", { title: renderedTitle });
    if (!selectedId || selectedKind !== "note") {
      await createNoteWithPayload({ title: renderedTitle, body: renderedBody, parentId: currentFolder, tags: [] });
      return;
    }
    const el = editorRef.current;
    const insertion = renderedBody || "";
    if (!el) {
      setContent((prev) => `${prev}${prev ? "\n" : ""}${insertion}`);
      return;
    }
    const start = el.selectionStart || 0;
    const end = el.selectionEnd || 0;
    setContent((prev) => prev.slice(0, start) + insertion + prev.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + insertion.length, start + insertion.length);
    });
  }
  async function deleteTemplate(id) {
    await api(`/api/orgs/${encodeURIComponent(orgId)}/drive/templates/${encodeURIComponent(id)}`, { method: "DELETE" });
    setTemplates((prev) => prev.filter((tpl) => tpl.id !== id));
  }

  async function fetchDriveRecord(kind, id, request = api) {
    const segment = kind === "drive/folders" ? "folders" : kind === "drive/notes" ? "notes" : kind === "drive/files" ? "files" : "";
    if (!segment) throw new Error("Unsupported Drive share target.");
    const data = await request(`/api/orgs/${encodeURIComponent(orgId)}/drive/${segment}/${encodeURIComponent(id)}`);
    return kind === "drive/folders" ? data?.folder : kind === "drive/notes" ? data?.note : data?.file;
  }

  async function resealDriveRecord(kind, id, request = api) {
    const row = await fetchDriveRecord(kind, id, request);
    if (!row) throw new Error("A Drive item disappeared while its access was being updated.");
    const parentId = row.parentId || null;
    if (kind === "drive/folders") {
      await request(`/api/orgs/${encodeURIComponent(orgId)}/drive/folders/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ name: row.name || "Folder", parentId }),
      });
      return;
    }
    if (kind === "drive/notes") {
      await request(`/api/orgs/${encodeURIComponent(orgId)}/drive/notes/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ title: row.title || "untitled", body: row.body || "", tags: Array.isArray(row.tags) ? row.tags : [], parentId }),
      });
      return;
    }
    const payload = {
      name: row.name || "file",
      mime: row.mime || "application/octet-stream",
      size: Number(row.size || 0),
      parentId,
    };
    if (row.dataUrl) payload.dataUrl = row.dataUrl;
    else if (row.textContent !== undefined) payload.textContent = String(row.textContent || "");
    await request(`/api/orgs/${encodeURIComponent(orgId)}/drive/files/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  }

  function shareTargetsFor(target) {
    if (target.kind !== "drive/folders") return [{ kind: target.kind, id: target.id }];
    const folderIds = new Set([target.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const folder of folders) {
        if (!folder.parentId || !folderIds.has(folder.parentId) || folderIds.has(folder.id)) continue;
        const directOverride = folder.id !== target.id
          && folder.shareRestricted
          && folder.shareRootKind === "drive/folders"
          && folder.shareRootId === folder.id;
        if (directOverride) continue;
        folderIds.add(folder.id);
        changed = true;
      }
    }
    const targets = [...folderIds].map((id) => ({ kind: "drive/folders", id }));
    for (const note of notes) {
      if (!note.parentId || !folderIds.has(note.parentId)) continue;
      const directOverride = note.shareRestricted && note.shareRootKind === "drive/notes" && note.shareRootId === note.id;
      if (!directOverride) targets.push({ kind: "drive/notes", id: note.id });
    }
    for (const file of files) {
      if (!file.parentId || !folderIds.has(file.parentId)) continue;
      const directOverride = file.shareRestricted && file.shareRootKind === "drive/files" && file.shareRootId === file.id;
      if (!directOverride) targets.push({ kind: "drive/files", id: file.id });
    }
    return targets;
  }

  async function applyDriveShare({ target, members, meUserId, grants, onProgress }) {
    if (!target?.id || !target?.kind) throw new Error("Choose a Drive item to share.");

    const selectedTargetKind = selectedKind === "note" ? "drive/notes" : selectedKind === "file" ? "drive/files" : "";
    if (selectedId === target.id && selectedTargetKind === target.kind) {
      onProgress?.("Finishing current save…");
      const saved = await flushPendingDriveSave();
      if (!saved) throw new Error("The current Drive item could not finish saving. Resolve the save error before changing access.");
    }

    const request = (label, timeoutMs = 15000) => (path, options = {}) => apiWithTimeout(label, path, options, timeoutMs);

    let resumeKey = null;
    onProgress?.("Checking encrypted access…");
    try {
      const pending = await resolveDriveShareKey(
        orgId,
        target.kind,
        target.id,
        request("Checking encrypted access", 10000),
        { preferPending: true },
      );
      if (pending?.pendingVersion && pending?.key) resumeKey = pending.key;
    } catch {}

    onProgress?.("Preparing encryption keys…");
    const prepared = await withDeadline("Preparing encryption keys", () => buildDriveSharePreparation({
      orgId,
      kind: target.kind,
      itemId: target.id,
      members,
      meUserId,
      grants,
      itemKey: resumeKey,
    }), 15000);

    onProgress?.("Staging access change…");
    const stage = await apiWithTimeout("Staging Drive sharing", `/api/orgs/${encodeURIComponent(orgId)}/drive/shares`, {
      method: "POST",
      body: JSON.stringify({
        action: "prepare",
        kind: target.kind,
        itemId: target.id,
        grants: prepared.grants,
        wraps: prepared.wraps,
      }),
    }, 15000);
    const version = Number(stage?.version || 0);
    if (!version) throw new Error("The sharing key rotation was not prepared.");
    cacheDriveShareKey(orgId, target.kind, target.id, version, prepared.itemKey);

    const targets = shareTargetsFor(target);
    setDriveNotice(`Updating encrypted access for ${targets.length} Drive item${targets.length === 1 ? "" : "s"}…`);
    try {
      for (let index = 0; index < targets.length; index += 1) {
        const item = targets[index];
        onProgress?.(`Encrypting item ${index + 1} of ${targets.length}…`);
        await resealDriveRecord(item.kind, item.id, request("Encrypting shared Drive item", 20000));
      }
      onProgress?.("Finalizing access…");
      await apiWithTimeout("Finalizing Drive sharing", `/api/orgs/${encodeURIComponent(orgId)}/drive/shares`, {
        method: "POST",
        body: JSON.stringify({ action: "finalize", kind: target.kind, itemId: target.id }),
      }, 15000);
      setDriveNotice(`Sharing updated for "${target.label || "Drive item"}".`);
      Promise.resolve().then(async () => {
        await Promise.allSettled([
          loadDrive({ preserveSelection: true }),
          loadSharedItems(),
        ]);
      });
    } catch (error) {
      setDriveNotice("Sharing update is incomplete. Retry the same sharing change to resume safely; the pending item key has been preserved.");
      throw error;
    }
  }

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const media = window.matchMedia("(max-width: 900px)");
    const sync = () => setIsMobile(!!media.matches);
    sync();
    if (typeof media.addEventListener === "function") media.addEventListener("change", sync);
    else media.addListener(sync);
    return () => {
      if (typeof media.removeEventListener === "function") media.removeEventListener("change", sync);
      else media.removeListener(sync);
    };
  }, []);

  useEffect(() => {
    if (!isMobile) setMobileSidebarOpen(false);
  }, [isMobile]);

  const showEditableDocument = selectedKind === "note" || (selectedKind === "file" && fileIsEditable);
  const effectiveViewMode = isStructuredDriveDoc && activeViewMode === "split" ? "edit" : activeViewMode;
  const showEditor = canEditSelected && showEditableDocument && effectiveViewMode !== "read";
  const showPreview = showEditableDocument && (!canEditSelected || effectiveViewMode !== "edit");

  useEffect(() => {
    if (effectiveViewMode !== "split" || !showEditor || !showPreview || isStructuredDriveDoc) return undefined;
    const editor = editorRef.current;
    const preview = previewScrollRef.current;
    if (!editor || !preview) return undefined;
    const syncScroll = (source, target) => {
      const sourceMax = Math.max(0, source.scrollHeight - source.clientHeight);
      const targetMax = Math.max(0, target.scrollHeight - target.clientHeight);
      const ratio = sourceMax ? source.scrollTop / sourceMax : 0;
      target.scrollTop = ratio * targetMax;
    };
    const syncFrom = (source, target) => {
      if (scrollSyncLockRef.current) return;
      scrollSyncLockRef.current = true;
      syncScroll(source, target);
      window.requestAnimationFrame(() => { scrollSyncLockRef.current = false; });
    };
    const onEditorScroll = () => syncFrom(editor, preview);
    const onPreviewScroll = () => syncFrom(preview, editor);
    editor.addEventListener("scroll", onEditorScroll, { passive: true });
    preview.addEventListener("scroll", onPreviewScroll, { passive: true });
    const frame = window.requestAnimationFrame(() => syncScroll(editor, preview));
    return () => {
      window.cancelAnimationFrame(frame);
      editor.removeEventListener("scroll", onEditorScroll);
      preview.removeEventListener("scroll", onPreviewScroll);
    };
  }, [effectiveViewMode, showEditor, showPreview, isStructuredDriveDoc, selectedId]);

  const workspaceHeight = focusMode ? "100vh" : "calc(100vh - 86px)";
  const createModalActions = [
    { id: "folder", label: "Folder", hint: "Create a new folder in the current location.", icon: "📁", onClick: createFolder },
    { id: "upload-file", label: "Upload files", hint: "Import one or more existing files.", icon: "⤴", onClick: () => { if (fileInputRef.current) fileInputRef.current.value = ""; fileInputRef.current?.click(); } },
    { id: "upload-folder", label: "Upload folder", hint: "Import a whole folder tree.", icon: "🗂", onClick: () => { const input = folderInputRef.current; if (input) { input.value = ""; input.setAttribute("webkitdirectory", "true"); input.setAttribute("directory", "true"); } input?.click(); } },
    { id: "note", label: "Rich note", hint: "Markdown note with templates and backlinks.", icon: "📝", onClick: createNote },
    { id: "sheet", label: "Sheet", hint: "Simple grid document stored directly in Drive.", icon: "📊", onClick: createSpreadsheet },
    { id: "form", label: "Form", hint: "Build an intake form with a live preview.", icon: "☑", onClick: createForm },
    { id: "drawio", label: "Diagram", hint: "Create or edit a diagrams.net file in Drive.", icon: "◇", onClick: createDrawio },
  ];

  const driveGridStyle = isMobile ? { display: "block", height: "100%" } : { display: "grid", gridTemplateColumns: `${sidebarWidth}px 6px minmax(0,1fr)`, height: "100%" };

  return (
    <div style={{ position: focusMode ? "fixed" : "relative", inset: focusMode ? 0 : "auto", zIndex: focusMode ? 80 : "auto", background: "#0b0b0b", height: workspaceHeight }}>
      <input ref={fileInputRef} type="file" multiple style={{ display: "none" }} onChange={onUploadFiles} />
      <input ref={folderInputRef} type="file" multiple style={{ display: "none" }} onChange={onUploadFolder} />

      <div style={driveGridStyle}>
        {isMobile ? (
          <>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", padding: "8px 8px 0" }}>
              <button className="btn" type="button" onClick={() => setMobileSidebarOpen(true)} style={{ padding: "7px 10px" }}>Explorer</button>
              <button className="btn" type="button" onClick={() => setCreateModalOpen(true)} style={{ padding: "7px 10px" }}>New</button>
              <button className="btn" type="button" onClick={() => { if (fileInputRef.current) fileInputRef.current.value = ""; fileInputRef.current?.click(); }} style={{ padding: "7px 10px" }}>Upload</button>
              <div className="helper" style={{ marginLeft: "auto" }}>Mobile Drive</div>
            </div>
            {mobileSidebarOpen ? (
              <div style={{ position: "fixed", inset: focusMode ? 0 : "56px 8px 8px", zIndex: 95, background: "rgba(10,10,12,0.98)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, overflow: "hidden", boxShadow: "0 18px 48px rgba(0,0,0,0.45)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 10px", borderBottom: "1px solid rgba(255,255,255,0.08)", background: "#101012" }}>
                  <div style={{ fontWeight: 800 }}>Drive Explorer</div>
                  <button className="btn" type="button" onClick={() => setMobileSidebarOpen(false)} style={{ padding: "6px 10px" }}>Done</button>
                </div>
                <div style={{ height: "calc(100% - 48px)", overflow: "auto" }}>
                  <DriveSidebar
                    folders={folders}
                    notes={notes}
                    files={files}
                    currentFolder={currentFolder}
                    selectedId={selectedId}
                    selectedKind={selectedKind}
                    search={search}
                    setSearch={setSearch}
                    onSelectFolder={(id) => { setCurrentFolder(id); setMobileSidebarOpen(false); }}
                    onSelectNote={(id) => { selectNote(id); setMobileSidebarOpen(false); }}
                    onSelectFile={(file) => { openFile(file); setMobileSidebarOpen(false); }}
                    onNewNote={createNote}
                    onNewFolder={createFolder}
                    onNewSpreadsheet={createSpreadsheet}
                    onNewForm={createForm}
                    onOpenCreatePicker={() => setCreateModalOpen(true)}
                    onUploadFile={() => { if (fileInputRef.current) fileInputRef.current.value = ""; fileInputRef.current?.click(); }}
                    onUploadFolder={() => { const input = folderInputRef.current; if (input) { input.value = ""; input.setAttribute("webkitdirectory", "true"); input.setAttribute("directory", "true"); } input?.click(); }}
                    onDropFilesOnFolder={onDropFilesOnFolder}
                    onRenameFolder={renameFolder}
                    onMoveFolder={moveFolder}
                    onMoveFolderToFolder={moveFolder}
                    onDeleteFolder={deleteFolder}
                    onRenameNote={renameNote}
                    onMoveNote={moveNote}
                    onDeleteNote={deleteNote}
                    onRenameFile={renameFile}
                    onMoveFile={moveFile}
                    onMoveFileToFolder={moveFileToFolder}
                    onMoveFilesToFolder={moveFilesToFolder}
                    onDeleteFile={deleteFile}
                    onDeleteFiles={deleteFiles}
                    onMoveFiles={moveFiles}
                    onDownloadFiles={downloadFiles}
                    onDownloadFile={downloadFile}
                    onOpenFileInBrowser={openFileInBrowser}
                    onShareItem={setShareTarget}
                    repairCandidateCount={explodedFolderCandidates.length}
                    onRepairExplodedFolders={repairExplodedFolders}
                    sharedItems={sharedItems}
                    templates={templates}
                    onApplyTemplate={applyTemplate}
                    onNewFromTemplate={createNoteFromTemplate}
                    onDeleteTemplate={deleteTemplate}
                    onEditTemplate={editTemplate}
                  />
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <div style={{ borderRight: "1px solid #1b1b1b", overflow: "hidden" }}>
              <DriveSidebar
                folders={folders}
                notes={notes}
                files={files}
                currentFolder={currentFolder}
                selectedId={selectedId}
                selectedKind={selectedKind}
                search={search}
                setSearch={setSearch}
                onSelectFolder={setCurrentFolder}
                onSelectNote={selectNote}
                onSelectFile={openFile}
                onNewNote={createNote}
                onNewFolder={createFolder}
                onNewSpreadsheet={createSpreadsheet}
                onNewForm={createForm}
                onOpenCreatePicker={() => setCreateModalOpen(true)}
                onUploadFile={() => {
                  if (fileInputRef.current) fileInputRef.current.value = "";
                  fileInputRef.current?.click();
                }}
                onUploadFolder={() => {
                  const input = folderInputRef.current;
                  if (input) {
                    input.value = "";
                    input.setAttribute("webkitdirectory", "true");
                    input.setAttribute("directory", "true");
                  }
                  input?.click();
                }}
                onDropFilesOnFolder={onDropFilesOnFolder}
                onRenameFolder={renameFolder}
                onMoveFolder={moveFolder}
                onMoveFolderToFolder={moveFolder}
                onDeleteFolder={deleteFolder}
                onRenameNote={renameNote}
                onMoveNote={moveNote}
                onDeleteNote={deleteNote}
                onRenameFile={renameFile}
                onMoveFile={moveFile}
                onMoveFileToFolder={moveFileToFolder}
                onMoveFilesToFolder={moveFilesToFolder}
                onDeleteFile={deleteFile}
                onDeleteFiles={deleteFiles}
                onMoveFiles={moveFiles}
                onDownloadFiles={downloadFiles}
                onDownloadFile={downloadFile}
                onOpenFileInBrowser={openFileInBrowser}
                onShareItem={setShareTarget}
                repairCandidateCount={explodedFolderCandidates.length}
                onRepairExplodedFolders={repairExplodedFolders}
                sharedItems={sharedItems}
                templates={templates}
                onApplyTemplate={applyTemplate}
                onNewFromTemplate={createNoteFromTemplate}
                onDeleteTemplate={deleteTemplate}
                onEditTemplate={editTemplate}
              />
            </div>

            <div onMouseDown={() => beginResize("sidebar")} style={{ cursor: "col-resize", background: "rgba(255,255,255,0.03)" }} title="Drag to resize explorer" />
          </>
        )}

        <div style={{ minWidth: 0, overflow: "auto", padding: isMobile ? 8 : 8 }}>
          <Breadcrumbs folders={folders} currentFolder={currentFolder} setCurrentFolder={setCurrentFolder} compact />
          {driveNotice ? (
            <div
              role="status"
              className="helper"
              style={{
                marginBottom: 10,
                padding: "8px 10px",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 10,
                background: "rgba(255,255,255,0.03)",
                whiteSpace: "pre-wrap",
              }}
            >
              {driveNotice}
            </div>
          ) : null}

          {loadState === "loading" ? (
            <div className="card" style={{ padding: 14, maxWidth: 560 }}>
              <h2 style={{ marginTop: 0, marginBottom: 10 }}>Drive</h2>
              <div className="helper">Loading org Drive…</div>
            </div>
          ) : loadState === "error" ? (
            <div className="card" style={{ padding: 14, maxWidth: 560 }}>
              <h2 style={{ marginTop: 0, marginBottom: 10 }}>Drive</h2>
              <div className="helper" style={{ marginBottom: 12 }}>{loadError || "Drive failed to load."}</div>
              <button className="btn" type="button" onClick={() => loadDrive({ preserveSelection: false })}>Retry</button>
            </div>
          ) : showEditableDocument ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                <input
                  className={isStructuredDriveDoc ? "bf-drive-titleInput is-structured" : "bf-drive-titleInput"}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  readOnly={!canEditSelected}
                  placeholder="Untitled"
                  style={{ flex: 1, minWidth: isMobile ? 120 : 220 }}
                />
                <span className="helper">{canEditSelected ? status : "view only"}</span>
                <button
                  className="btn"
                  type="button"
                  onClick={() => setShareTarget({
                    kind: selectedKind === "note" ? "drive/notes" : "drive/files",
                    id: selectedId,
                    label: selectedKind === "note" ? (selectedNote?.title || "Untitled note") : (selectedFile?.name || "File"),
                  })}
                  style={{ padding: "6px 9px" }}
                >
                  Share
                </button>
                {selectedFile && !fileIsEditable ? <span className="helper">read only</span> : null}
              </div>

              {isStructuredDriveDoc ? (
                <div role="tablist" aria-label="Structured document view" style={{ display: "inline-flex", gap: 6, marginBottom: 8, padding: 4, border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, background: "rgba(255,255,255,0.03)" }}>
                  {canEditSelected ? <button className="btn" type="button" role="tab" aria-selected={effectiveViewMode === "edit"} onClick={() => setActiveViewMode("edit")} style={{ background: effectiveViewMode === "edit" ? "rgba(255,255,255,0.14)" : undefined }}>Editor</button> : null}
                  <button className="btn" type="button" role="tab" aria-selected={effectiveViewMode === "read"} onClick={() => setActiveViewMode("read")} style={{ background: effectiveViewMode === "read" ? "rgba(255,255,255,0.14)" : undefined }}>Preview</button>
                </div>
              ) : <RichTextToolbar
                onBold={showEditor ? () => wrapSelection("**") : undefined}
                onItalic={showEditor ? () => wrapSelection("*") : undefined}
                onH1={showEditor ? () => prefixLines("# ") : undefined}
                onH2={showEditor ? () => prefixLines("## ") : undefined}
                onBullet={showEditor ? () => prefixLines("- ") : undefined}
                onQuote={showEditor ? () => prefixLines("> ") : undefined}
                onCode={showEditor ? () => wrapSelection("`") : undefined}
                onRule={showEditor ? () => insertBlock("\n---\n") : undefined}
                onLink={showEditor ? insertLink : undefined}
                onWikiLink={showEditor ? () => wrapSelection("[[", "]]") : undefined}
                menuOpen={menuOpen}
                onToggleMenu={() => setMenuOpen((v) => !v)}
                menuItems={[
                  { label: "Source", onClick: () => { setActiveViewMode("edit"); setMenuOpen(false); } },
                  { label: "Reading", onClick: () => { setActiveViewMode("read"); setMenuOpen(false); } },
                  { label: "Split", onClick: () => { setActiveViewMode("split"); setMenuOpen(false); } },
                  { label: "Props", onClick: () => { insertFrontmatterTemplate(); setMenuOpen(false); } },
                  { label: inspectorOpen ? "Hide inspector" : "Inspector", onClick: () => { setInspectorOpen((v) => !v); setMenuOpen(false); } },
                  { label: "Save as template", onClick: () => { saveCurrentAsTemplate(); setMenuOpen(false); } },
                  selectedFile ? { label: "Open in browser", onClick: () => { openFileInBrowser(selectedFile); setMenuOpen(false); } } : null,
                  selectedFile ? { label: "Download", onClick: () => { downloadFile(selectedFile); setMenuOpen(false); } } : null,
                  { label: focusMode ? "Exit focus" : "Focus", onClick: () => { setFocusMode((v) => !v); setMenuOpen(false); } },
                ].filter(Boolean)}
              />}

              <div id="bf-drive-editor-zone" className={isStructuredDriveDoc ? "bf-drive-editorZone is-structured" : "bf-drive-editorZone"} style={{ display: "grid", gridTemplateColumns: !isStructuredDriveDoc && !isMobile && effectiveViewMode === "split" ? `${Math.round(splitRatio * 100)}% 6px minmax(0,1fr)` : "minmax(0,1fr)", gap: !isStructuredDriveDoc && !isMobile && effectiveViewMode === "split" ? 6 : 0, alignItems: "start" }}>
                {showEditor ? (
                  <div style={{ minWidth: 0 }}>
                    {selectedFileSubtype === "drawio" ? (
                      <DrawioFileView key={selectedFile?.id || title} value={content} onChange={setContent} title={title} mode="edit" privateContent={!!selectedFile?.encrypted} />
                    ) : selectedFileSubtype === "sheet" ? (
                      <SpreadsheetFileView value={content} onChange={setContent} mode="edit" />
                    ) : selectedFileSubtype === "form" ? (
                      <FormFileView value={content} onChange={setContent} mode="edit" fileId={selectedFile?.id || ""} orgId={orgId} saveStatus={status} onBeforePublicUse={flushSaveBeforePublicUse} />
                    ) : (
                      <NoteEditor value={content} onChange={setContent} focusMode={focusMode} editorRef={editorRef} compact />
                    )}
                  </div>
                ) : null}
                {canEditSelected && !isStructuredDriveDoc && !isMobile && effectiveViewMode === "split" ? <div onMouseDown={() => beginResize("split")} style={{ cursor: "col-resize", background: "rgba(255,255,255,0.03)", minHeight: focusMode ? "84vh" : "72vh" }} title="Drag to resize split" /> : null}
                {showPreview ? (
                  <div ref={previewScrollRef} style={{ minWidth: 0, height: effectiveViewMode === "split" ? (focusMode ? "84vh" : "72vh") : undefined, overflowY: effectiveViewMode === "split" ? "auto" : undefined }}>
                    {selectedFileSubtype === "drawio" ? (
                      <DrawioFileView key={selectedFile?.id || title} value={content} title={title} mode="preview" privateContent={!!selectedFile?.encrypted} />
                    ) : selectedFileSubtype === "sheet" ? (
                      <SpreadsheetFileView value={content} mode="preview" />
                    ) : selectedFileSubtype === "form" ? (
                      <FormFileView value={content} onChange={setContent} mode="preview" fileId={selectedFile?.id || ""} orgId={orgId} />
                    ) : selectedKind === "file" && !fileIsMarkdown ? (
                      <pre style={{ whiteSpace: "pre-wrap", margin: 0, background: "rgba(255,255,255,0.02)", border: "1px solid #1f1f1f", borderRadius: 12, padding: 12, minHeight: "72vh", overflow: "auto" }}>{String(content || "")}</pre>
                    ) : (
                      <NotePreview content={content} onOpenLink={openLinkedNoteByTitle} focusMode={focusMode} onUpdateProperty={updateFrontmatterProperty} onAddProperty={addFrontmatterProperty} onRemoveProperty={removeFrontmatterProperty} propertiesCollapsed={propertiesCollapsed} onToggleProperties={() => setPropertiesCollapsed((v) => !v)} compact />
                    )}
                  </div>
                ) : null}
              </div>
            </>
          ) : selectedFile ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                <h2 style={{ margin: 0, fontSize: 20 }}>{selectedFile.name}</h2>
                <span className="helper">{selectedFile.mime || "file"}</span>
                <span className="helper">{Math.round((Number(selectedFile.size || 0) / 1024) * 10) / 10} KB</span>
                <button className="btn" type="button" onClick={() => setShareTarget({ kind: "drive/files", id: selectedFile.id, label: selectedFile.name || "File" })}>Share</button>
                {selectedFile.sharePermission === "view" ? <span className="helper">view only</span> : null}
              </div>
              <DriveFilePreview file={selectedFile} />
            </>
          ) : (
            <div className="card" style={{ padding: 14, maxWidth: 760 }}>
              <h2 style={{ marginTop: 0, marginBottom: 10 }}>Drive</h2>
              <div className="helper" style={{ marginBottom: 14 }}>
                Select a note or file from the explorer, or create something new from the sidebar.
              </div>
              <div style={{ display: "grid", gap: 10 }}>
                <div>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>What works here</div>
                  <div className="helper">Notes, folders, uploaded files, markdown editing, templates, backlinks, frontmatter properties, split view, and inspector.</div>
                </div>
                <div>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>Storage</div>
                  <div className="helper">Drive content now loads from this org instead of living only in browser localStorage.</div>
                </div>
                <div>
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>Templates</div>
                  <div className="helper">Templates can create a new note, insert into the current note, and be edited in app.</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <DriveCreateModal open={createModalOpen} onClose={() => setCreateModalOpen(false)} actions={createModalActions} />
      <DriveShareModal
        open={!!shareTarget}
        orgId={orgId}
        target={shareTarget}
        onClose={() => setShareTarget(null)}
        onApply={applyDriveShare}
      />

      {inspectorOpen && selectedNote ? (
        <div style={{ position: "fixed", top: isMobile ? "auto" : (focusMode ? 8 : 94), right: isMobile ? 8 : 8, left: isMobile ? 8 : "auto", bottom: isMobile ? 8 : "auto", width: isMobile ? "auto" : 250, maxHeight: isMobile ? "55vh" : (focusMode ? "calc(100vh - 16px)" : "calc(100vh - 102px)"), overflow: "auto", zIndex: 90 }}>
          <NoteInspector note={selectedNote} backlinks={backlinks} onOpenNote={selectNote} onClose={() => setInspectorOpen(false)} compact />
        </div>
      ) : null}
    </div>
  );
}
