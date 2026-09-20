import React from "react";
import { api } from "../utils/api.js";
import {
  createBlock,
  normalizePublicPage,
  PUBLIC_PAGE_BLOCK_TYPES,
  PUBLIC_PAGE_FONT_OPTIONS,
} from "../../shared/publicPageModel.js";
import PublicPageRenderer from "./PublicPageRenderer.jsx";

const LABELS = {
  hero: "Hero",
  heading: "Heading",
  text: "Text",
  list: "List",
  button: "Button",
  image: "Image",
  quote: "Quote",
  divider: "Divider",
  spacer: "Spacer",
  embed: "Video / embed",
  get_help: "Get Help",
  newsletter: "Newsletter",
  needs: "Needs",
  pledges: "Pledges",
  events: "Events",
};

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");

function Field({ label, children, hint }) {
  return (
    <label className="live-editor-field">
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function ImageUpload({ value, onChange }) {
  const inputRef = React.useRef(null);
  const [busy, setBusy] = React.useState(false);

  async function choose(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const source = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Could not read that image."));
        reader.onload = () => resolve(String(reader.result || ""));
        reader.readAsDataURL(file);
      });
      if (source.length <= 500000) {
        onChange(source);
      } else {
        const image = await new Promise((resolve, reject) => {
          const element = new Image();
          element.onerror = () => reject(new Error("That image could not be decoded."));
          element.onload = () => resolve(element);
          element.src = source;
        });
        const scale = Math.min(1, 1600 / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
        const compressed = canvas.toDataURL("image/webp", 0.78);
        if (compressed.length > 500000) throw new Error("Choose a smaller image.");
        onChange(compressed);
      }
    } catch (error) {
      window.alert(error?.message || "Unable to prepare that image.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="live-editor-field">
      <span>Image</span>
      <input value={value || ""} onChange={(event) => onChange(event.target.value)} placeholder="https://… or upload" />
      <div className="live-editor-inline-actions">
        <button type="button" className="live-editor-secondary" onClick={() => inputRef.current?.click()} disabled={busy}>
          {busy ? "Preparing…" : "Upload image"}
        </button>
        {value ? <button type="button" className="live-editor-secondary" onClick={() => onChange("")} disabled={busy}>Remove</button> : null}
      </div>
      <input ref={inputRef} hidden type="file" accept="image/*" onChange={choose} />
    </div>
  );
}

function Inspector({ block, updateProps, updateStyle }) {
  if (!block) {
    return (
      <div className="live-editor-empty-inspector">
        <div className="live-editor-inspector-icon" aria-hidden="true">↖</div>
        <strong>Select something to edit</strong>
        <p>Click a block on the page to change its content, typography, spacing, or links.</p>
      </div>
    );
  }

  const props = block.props || {};
  const style = block.style || {};
  const setProp = (key, value) => updateProps({ [key]: value });
  const setStyle = (key, value) => updateStyle({ [key]: value });

  return (
    <div className="live-editor-inspector">
      <div className="live-editor-inspector-heading">
        <div>
          <span className="live-editor-eyebrow">Selected block</span>
          <h2>{LABELS[block.type] || block.type}</h2>
        </div>
        <span className="live-editor-type-pill">{block.type}</span>
      </div>

      {["hero", "heading", "text", "quote"].includes(block.type) ? (
        <>
          {block.type === "hero" ? <Field label="Eyebrow"><input value={props.eyebrow || ""} onChange={(event) => setProp("eyebrow", event.target.value)} /></Field> : null}
          <Field label={block.type === "hero" ? "Headline" : "Text"}>
            <textarea rows={block.type === "hero" ? 4 : 6} value={props.text || props.title || ""} onChange={(event) => setProp(block.type === "hero" && props.title ? "title" : "text", event.target.value)} />
          </Field>
          {block.type === "hero" ? <Field label="Intro"><textarea rows={4} value={props.text || ""} onChange={(event) => setProp("text", event.target.value)} /></Field> : null}
          {block.type === "quote" ? <Field label="Attribution"><input value={props.attribution || ""} onChange={(event) => setProp("attribution", event.target.value)} /></Field> : null}
        </>
      ) : null}

      {block.type === "list" ? (
        <Field label="List items" hint="One item per line">
          <textarea rows={7} value={(props.items || []).join("\n")} onChange={(event) => setProp("items", event.target.value.split("\n"))} />
        </Field>
      ) : null}

      {block.type === "button" ? (
        <>
          <Field label="Button label"><input value={props.label || ""} onChange={(event) => setProp("label", event.target.value)} /></Field>
          <Field label="Link"><input value={props.url || ""} onChange={(event) => setProp("url", event.target.value)} placeholder="/about or https://…" /></Field>
        </>
      ) : null}

      {block.type === "image" ? (
        <>
          <ImageUpload value={props.url} onChange={(value) => setProp("url", value)} />
          <Field label="Alt text" hint="Describe the image for screen readers"><input value={props.alt || ""} onChange={(event) => setProp("alt", event.target.value)} /></Field>
          <Field label="Caption"><input value={props.caption || ""} onChange={(event) => setProp("caption", event.target.value)} /></Field>
        </>
      ) : null}

      {block.type === "hero" ? <ImageUpload value={props.imageUrl} onChange={(value) => setProp("imageUrl", value)} /> : null}

      {block.type === "embed" ? (
        <>
          <Field label="Video or embed URL"><input value={props.url || ""} onChange={(event) => setProp("url", event.target.value)} placeholder="https://youtube.com/watch?v=…" /></Field>
          <Field label="Accessible title"><input value={props.title || ""} onChange={(event) => setProp("title", event.target.value)} /></Field>
        </>
      ) : null}

      {["get_help", "newsletter", "needs", "pledges", "events"].includes(block.type) ? (
        <>
          <Field label="Section title"><input value={props.title || ""} onChange={(event) => setProp("title", event.target.value)} /></Field>
          <Field label="Description"><textarea rows={4} value={props.description || ""} onChange={(event) => setProp("description", event.target.value)} /></Field>
          {block.type === "get_help" ? <Field label="Button label"><input value={props.label || ""} onChange={(event) => setProp("label", event.target.value)} /></Field> : null}
          {block.type === "newsletter" ? <Field label="Button label"><input value={props.buttonLabel || ""} onChange={(event) => setProp("buttonLabel", event.target.value)} /></Field> : null}
        </>
      ) : null}

      {block.type === "spacer" ? <Field label="Height (px)"><input type="number" min="8" max="320" value={props.height || 48} onChange={(event) => setProp("height", Number(event.target.value) || 48)} /></Field> : null}

      <div className="live-editor-divider" />
      <div className="live-editor-section-title">Typography</div>
      <Field label="Font family">
        <select value={style.fontFamily || "system"} onChange={(event) => setStyle("fontFamily", event.target.value)}>
          {PUBLIC_PAGE_FONT_OPTIONS.map((font) => <option key={font.value} value={font.value}>{font.label}</option>)}
        </select>
      </Field>
      <div className="live-editor-two">
        <Field label="Size"><input type="number" min="12" max="96" value={style.fontSize || 18} onChange={(event) => setStyle("fontSize", Number(event.target.value) || 18)} /></Field>
        <Field label="Weight">
          <select value={style.fontWeight || 400} onChange={(event) => setStyle("fontWeight", Number(event.target.value))}>
            {[400, 500, 600, 700, 800].map((weight) => <option key={weight} value={weight}>{weight}</option>)}
          </select>
        </Field>
      </div>
      <div className="live-editor-two">
        <Field label="Text color"><input type="color" value={/^#[0-9a-f]{6}$/i.test(style.color || "") ? style.color : "#232947"} onChange={(event) => setStyle("color", event.target.value)} /></Field>
        <Field label="Align">
          <select value={style.textAlign || "left"} onChange={(event) => setStyle("textAlign", event.target.value)}>
            <option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
          </select>
        </Field>
      </div>
      <div className="live-editor-two">
        <Field label="Line height"><input type="number" min="1" max="2.4" step="0.1" value={style.lineHeight || 1.5} onChange={(event) => setStyle("lineHeight", Number(event.target.value) || 1.5)} /></Field>
        <Field label="Letter spacing"><input value={style.letterSpacing || ""} onChange={(event) => setStyle("letterSpacing", event.target.value)} placeholder="0.01em" /></Field>
      </div>
      <div className="live-editor-section-title">Block layout</div>
      <Field label="Background color">
        <input type="text" value={style.backgroundColor || ""} onChange={(event) => setStyle("backgroundColor", event.target.value)} placeholder="#ffffff or transparent" />
      </Field>
      <Field label="Padding"><input value={style.padding || ""} onChange={(event) => setStyle("padding", event.target.value)} placeholder="24px" /></Field>
      <Field label="Margin"><input value={style.margin || ""} onChange={(event) => setStyle("margin", event.target.value)} placeholder="0 0 24px" /></Field>
      <Field label="Border radius"><input value={style.borderRadius || ""} onChange={(event) => setStyle("borderRadius", event.target.value)} placeholder="12px" /></Field>
      <Field label="Maximum width"><input value={style.maxWidth || ""} onChange={(event) => setStyle("maxWidth", event.target.value)} placeholder="100%" /></Field>
    </div>
  );
}

function loadEditorPage(orgId) {
  return api("/api/orgs/" + encodeURIComponent(orgId) + "/public/get", { method: "GET" });
}

async function readError(error) {
  return error?.message || "Could not save the public page.";
}

export default function LivePublicPageEditor({ slug, orgId, initialData, onClose, onPublished }) {
  const [page, setPage] = React.useState(() => normalizePublicPage(initialData?.public?.page || {}));
  const [selectedId, setSelectedId] = React.useState("");
  const [past, setPast] = React.useState([]);
  const [future, setFuture] = React.useState([]);
  const [device, setDevice] = React.useState("desktop");
  const [preview, setPreview] = React.useState(false);
  const [status, setStatus] = React.useState("Loading draft…");
  const [loadError, setLoadError] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const latestPage = React.useRef(page);
  const ready = React.useRef(false);
  const saveTimer = React.useRef(null);

  React.useEffect(() => {
    latestPage.current = page;
  }, [page]);

  React.useEffect(() => {
    let active = true;
    loadEditorPage(orgId)
      .then((data) => {
        if (!active) return;
        const next = normalizePublicPage(data?.draft_page || data?.public?.page || {});
        setPage(next);
        latestPage.current = next;
        setPast([]);
        setFuture([]);
        ready.current = true;
        setStatus("Saved draft");
      })
      .catch(async (error) => {
        if (!active) return;
        setLoadError(await readError(error));
        setStatus("Unable to load draft");
      });
    return () => {
      active = false;
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [orgId]);

  const commit = React.useCallback((next, options = {}) => {
    const normalized = normalizePublicPage(next);
    setPast((items) => [...items.slice(-39), latestPage.current]);
    setFuture([]);
    latestPage.current = normalized;
    setPage(normalized);
    if (!options.silent) setStatus("Unsaved changes");
  }, []);

  const updateBlock = React.useCallback((id, patch) => {
    commit({
      ...latestPage.current,
      blocks: latestPage.current.blocks.map((block) => block.id === id ? { ...block, ...patch } : block),
    });
  }, [commit]);

  const updateProps = React.useCallback((id, patch) => {
    const block = latestPage.current.blocks.find((item) => item.id === id);
    if (!block) return;
    updateBlock(id, { props: { ...(block.props || {}), ...patch } });
  }, [updateBlock]);

  const updateStyle = React.useCallback((id, patch) => {
    const block = latestPage.current.blocks.find((item) => item.id === id);
    if (!block) return;
    updateBlock(id, { style: { ...(block.style || {}), ...patch } });
  }, [updateBlock]);

  const addBlock = (type) => {
    const block = createBlock(type);
    const blocks = [...latestPage.current.blocks];
    const selectedIndex = blocks.findIndex((item) => item.id === selectedId);
    blocks.splice(selectedIndex < 0 ? blocks.length : selectedIndex + 1, 0, block);
    commit({ ...latestPage.current, blocks });
    setSelectedId(block.id);
    setPreview(false);
  };

  const moveBlock = (fromId, toId) => {
    if (!fromId || !toId || fromId === toId) return;
    const blocks = [...latestPage.current.blocks];
    const from = blocks.findIndex((item) => item.id === fromId);
    const to = blocks.findIndex((item) => item.id === toId);
    if (from < 0 || to < 0) return;
    const [moved] = blocks.splice(from, 1);
    blocks.splice(to, 0, moved);
    commit({ ...latestPage.current, blocks });
  };

  const removeBlock = (id) => {
    const block = latestPage.current.blocks.find((item) => item.id === id);
    if (!block || !window.confirm("Remove this block from the page? This can be undone.")) return;
    commit({ ...latestPage.current, blocks: latestPage.current.blocks.filter((item) => item.id !== id) });
    setSelectedId("");
  };

  const duplicateBlock = (id) => {
    const source = latestPage.current.blocks.find((item) => item.id === id);
    if (!source) return;
    const copy = createBlock(source.type);
    const next = { ...copy, props: { ...(source.props || {}) }, style: { ...(source.style || {}) }, hidden: !!source.hidden };
    const index = latestPage.current.blocks.findIndex((item) => item.id === id);
    const blocks = [...latestPage.current.blocks];
    blocks.splice(index + 1, 0, next);
    commit({ ...latestPage.current, blocks });
    setSelectedId(next.id);
  };

  const toggleHidden = (id) => {
    const block = latestPage.current.blocks.find((item) => item.id === id);
    if (block) updateBlock(id, { hidden: !block.hidden });
  };

  const undo = () => {
    const previous = past[past.length - 1];
    if (!previous) return;
    setPast((items) => items.slice(0, -1));
    setFuture((items) => [latestPage.current, ...items]);
    latestPage.current = previous;
    setPage(previous);
    setStatus("Unsaved changes");
  };

  const redo = () => {
    const next = future[0];
    if (!next) return;
    setFuture((items) => items.slice(1));
    setPast((items) => [...items, latestPage.current]);
    latestPage.current = next;
    setPage(next);
    setStatus("Unsaved changes");
  };

  const savePage = React.useCallback(async (nextPage = latestPage.current) => {
    setSaving(true);
    try {
      const clean = normalizePublicPage(nextPage);
      await api("/api/orgs/" + encodeURIComponent(orgId) + "/public/save", {
        method: "POST",
        body: JSON.stringify({ page: clean }),
      });
      if (latestPage.current === nextPage || JSON.stringify(latestPage.current) === JSON.stringify(clean)) {
        setStatus("Saved draft");
      }
      return clean;
    } catch (error) {
      setStatus(await readError(error));
      throw error;
    } finally {
      setSaving(false);
    }
  }, [orgId]);

  React.useEffect(() => {
    if (!ready.current || !page || status === "Loading draft…") return undefined;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (status !== "Unsaved changes") return undefined;
    saveTimer.current = setTimeout(() => {
      savePage(latestPage.current).catch(() => {});
    }, 850);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [page, status, savePage]);

  const publish = async () => {
    if (saving) return;
    if (!window.confirm("Publish these changes to the public page?")) return;
    try {
      await savePage(latestPage.current);
      const result = await api("/api/orgs/" + encodeURIComponent(orgId) + "/public/publish", { method: "POST", body: "{}" });
      setStatus("Published");
      onPublished?.(result?.published_page || latestPage.current);
    } catch {
      // savePage has already exposed the reason in the toolbar.
    }
  };

  const close = () => {
    if (status === "Unsaved changes" && !window.confirm("You have unpublished changes. Close the editor?")) return;
    onClose?.();
  };

  const selected = page.blocks.find((block) => block.id === selectedId) || null;

  return (
    <div className="live-page-editor" role="dialog" aria-modal="true" aria-label="Edit public page">
      <header className="live-editor-toolbar">
        <div className="live-editor-brand">
          <button type="button" className="live-editor-close" onClick={close} aria-label="Close page editor">×</button>
          <div>
            <strong>Edit public page</strong>
            <span>{slug}</span>
          </div>
        </div>
        <div className="live-editor-toolbar-center">
          <button type="button" className="live-editor-icon-button" onClick={undo} disabled={!past.length} title="Undo">↶</button>
          <button type="button" className="live-editor-icon-button" onClick={redo} disabled={!future.length} title="Redo">↷</button>
          <span className={"live-editor-save-state" + (saving ? " is-saving" : "")}>{saving ? "Saving…" : status}</span>
        </div>
        <div className="live-editor-toolbar-actions">
          {["desktop", "tablet", "mobile"].map((item) => (
            <button key={item} type="button" className={"live-editor-device" + (device === item ? " is-active" : "")} onClick={() => setDevice(item)}>{item[0].toUpperCase() + item.slice(1)}</button>
          ))}
          <button type="button" className={"live-editor-preview-button" + (preview ? " is-active" : "")} onClick={() => setPreview((value) => !value)}>
            {preview ? "Back to edit" : "Preview"}
          </button>
          <button type="button" className="live-editor-publish" onClick={publish} disabled={saving || !!loadError}>Publish</button>
        </div>
      </header>

      {loadError ? <div className="live-editor-error" role="alert">{loadError}</div> : null}

      <div className="live-editor-workspace">
        {!preview ? (
          <aside className="live-editor-sidebar live-editor-add-panel" aria-label="Add page blocks">
            <div className="live-editor-panel-heading">
              <span className="live-editor-eyebrow">Build</span>
              <h2>Add to page</h2>
              <p>Drop in a block, then edit it directly on the page.</p>
            </div>
            <div className="live-editor-block-library">
              {PUBLIC_PAGE_BLOCK_TYPES.map((type) => (
                <button key={type} type="button" onClick={() => addBlock(type)}>
                  <span className={"live-editor-block-icon live-editor-icon-" + type} aria-hidden="true">{type === "text" ? "T" : type === "image" ? "▧" : type === "divider" ? "—" : "+"}</span>
                  <span>{LABELS[type]}</span>
                </button>
              ))}
            </div>
            <div className="live-editor-tip">
              <strong>Editing tip</strong>
              <span>Click any block to select it. Drag the handle to reorder it. Text blocks can be edited right on the page.</span>
            </div>
          </aside>
        ) : null}

        <main className={"live-editor-canvas-shell" + (preview ? " is-preview" : "")}>
          <div className={"live-editor-device-frame " + device}>
            <PublicPageRenderer
              page={page}
              slug={slug}
              preview={preview}
              editor={!preview}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onChangeProps={updateProps}
              onToggleHidden={toggleHidden}
              onDuplicate={duplicateBlock}
              onRemove={removeBlock}
              onMove={moveBlock}
            />
          </div>
        </main>

        {!preview ? (
          <aside className="live-editor-sidebar live-editor-inspector-panel" aria-label="Block settings">
            <Inspector
              block={selected}
              updateProps={(patch) => selected && updateProps(selected.id, patch)}
              updateStyle={(patch) => selected && updateStyle(selected.id, patch)}
            />
          </aside>
        ) : null}
      </div>
    </div>
  );
}
