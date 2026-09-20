import React from "react";
import { useParams } from "react-router-dom";
import { api } from "../utils/api.js";
import {
  createBlock,
  legacyPageFromConfig,
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

const FONT_STACKS = {
  system: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  sans: 'Arial, Helvetica, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
  display: '"Trebuchet MS", "Avenir Next", sans-serif',
};

function Field({ label, children }) {
  return <label className="ppb-sidebar-field"><span>{label}</span>{children}</label>;
}

function ImageUpload({ label, value, onChange }) {
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
    <div className="ppb-sidebar-field">
      <span>{label}</span>
      <input value={value || ""} onChange={(event) => onChange(event.target.value)} placeholder="https://… or upload" />
      <div className="ppb-row">
        <button className="ppb-small-button" type="button" onClick={() => inputRef.current?.click()} disabled={busy}>{busy ? "Preparing…" : "Upload image"}</button>
        {value ? <button className="ppb-small-button" type="button" onClick={() => onChange("")} disabled={busy}>Remove</button> : null}
      </div>
      <input ref={inputRef} hidden type="file" accept="image/*" onChange={choose} />
    </div>
  );
}


function editableStyle(block) {
  const style = block?.style || {};
  return {
    fontFamily: FONT_STACKS[style.fontFamily] || FONT_STACKS.system,
    fontSize: style.fontSize ? style.fontSize + "px" : undefined,
    fontWeight: style.fontWeight || undefined,
    fontStyle: style.fontStyle || undefined,
    color: style.color || undefined,
    backgroundColor: style.backgroundColor || undefined,
    textAlign: style.textAlign || undefined,
    lineHeight: style.lineHeight || undefined,
    letterSpacing: style.letterSpacing || undefined,
    padding: style.padding || undefined,
    margin: style.margin || undefined,
    borderRadius: style.borderRadius || undefined,
    maxWidth: style.maxWidth || undefined,
  };
}

function EditableText({ value, onChange, className = "", as = "div", style }) {
  const Tag = as;
  return (
    <Tag
      className={"ppb-editable " + className}
      style={style}
      contentEditable
      suppressContentEditableWarning
      onInput={(event) => onChange(event.currentTarget.textContent || "")}
    >
      {value || ""}
    </Tag>
  );
}

function DirectBlockEditor({ block, updateProps }) {
  const props = block.props || {};
  const style = editableStyle(block);
  if (block.type === "hero") {
    return (
      <section className="pp-hero" style={style}>
        <div className="pp-hero-copy">
          <EditableText value={props.eyebrow} onChange={(value) => updateProps({ eyebrow: value })} className="pp-eyebrow" as="p" />
          <EditableText value={props.title} onChange={(value) => updateProps({ title: value })} as="h1" />
          <EditableText value={props.text} onChange={(value) => updateProps({ text: value })} className="pp-lede" as="p" />
        </div>
        {props.imageUrl ? <img className="pp-hero-image" src={props.imageUrl} alt="" /> : null}
      </section>
    );
  }
  if (block.type === "heading") return <EditableText value={props.text} onChange={(value) => updateProps({ text: value })} className="pp-heading" as="h2" style={style} />;
  if (block.type === "quote") return <blockquote className="pp-quote" style={style}><EditableText value={props.text} onChange={(value) => updateProps({ text: value })} as="p" /><EditableText value={props.attribution} onChange={(value) => updateProps({ attribution: value })} as="cite" /></blockquote>;
  return <EditableText value={props.text} onChange={(value) => updateProps({ text: value })} className="pp-text" as="p" style={style} />;
}

function BlockEditor({ block, selected, onSelect, onMove, onRemove, onDuplicate, onToggleHidden, updateProps, updateStyle, dragHandlers }) {
  const direct = ["hero", "heading", "text", "quote"].includes(block.type);
  return (
    <div
      className={"ppb-block-editor" + (selected ? " is-selected" : "") + (block.hidden ? " ppb-hidden" : "")}
      draggable
      onDragStart={(event) => dragHandlers.start(event, block.id)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => dragHandlers.drop(event, block.id)}
      onClick={() => onSelect(block.id)}
      tabIndex={0}
      aria-label={LABELS[block.type] || block.type}
    >
      <div className="ppb-block-controls">
        <button type="button" title="Drag to move" onClick={(event) => event.stopPropagation()}>↕</button>
        <button type="button" title={block.hidden ? "Show block" : "Hide block"} onClick={(event) => { event.stopPropagation(); onToggleHidden(block.id); }}>{block.hidden ? "Show" : "Hide"}</button>
        <button type="button" title="Duplicate block" onClick={(event) => { event.stopPropagation(); onDuplicate(block.id); }}>Copy</button>
        <button type="button" title="Remove block" onClick={(event) => { event.stopPropagation(); onRemove(block.id); }}>×</button>
      </div>
      {direct ? (
        <DirectBlockEditor block={block} updateProps={updateProps} />
      ) : (
        <PublicPageRenderer page={{ blocks: [block], theme: {} }} preview selectedId={selected ? block.id : ""} onSelect={onSelect} />
      )}
    </div>
  );
}

function BlockInspector({ block, updateProps, updateStyle }) {
  if (!block) return <p className="ppb-muted">Select a block to edit its content and styling.</p>;
  const props = block.props || {};
  const set = (key, value) => updateProps({ [key]: value });
  const style = block.style || {};
  return (
    <div>
      <h4>{LABELS[block.type] || block.type}</h4>
      {block.type === "hero" ? <>
        <Field label="Eyebrow"><input value={props.eyebrow || ""} onChange={(event) => set("eyebrow", event.target.value)} /></Field>
        <Field label="Title"><input value={props.title || ""} onChange={(event) => set("title", event.target.value)} /></Field>
        <Field label="Intro"><textarea rows={4} value={props.text || ""} onChange={(event) => set("text", event.target.value)} /></Field>
        <ImageUpload label="Hero image" value={props.imageUrl || ""} onChange={(value) => set("imageUrl", value)} />
      </> : null}
      {["heading", "text", "quote"].includes(block.type) ? <Field label="Text"><textarea rows={6} value={props.text || ""} onChange={(event) => set("text", event.target.value)} /></Field> : null}
      {block.type === "quote" ? <Field label="Attribution"><input value={props.attribution || ""} onChange={(event) => set("attribution", event.target.value)} /></Field> : null}
      {block.type === "list" ? <Field label="Items, one per line"><textarea rows={8} value={(props.items || []).join("\n")} onChange={(event) => set("items", event.target.value.split("\n"))} /></Field> : null}
      {block.type === "button" ? <>
        <Field label="Button label"><input value={props.label || ""} onChange={(event) => set("label", event.target.value)} /></Field>
        <Field label="URL"><input value={props.url || ""} onChange={(event) => set("url", event.target.value)} /></Field>
      </> : null}
      {block.type === "image" ? <>
        <ImageUpload label="Image" value={props.url || ""} onChange={(value) => set("url", value)} />
        <Field label="Alt text"><input value={props.alt || ""} onChange={(event) => set("alt", event.target.value)} /></Field>
        <Field label="Caption"><textarea rows={3} value={props.caption || ""} onChange={(event) => set("caption", event.target.value)} /></Field>
      </> : null}
      {block.type === "spacer" ? <Field label="Height in pixels"><input type="number" min="8" max="320" value={props.height || 48} onChange={(event) => set("height", Number(event.target.value))} /></Field> : null}
      {block.type === "embed" ? <>
        <Field label="YouTube or Vimeo URL"><input value={props.url || ""} onChange={(event) => set("url", event.target.value)} /></Field>
        <Field label="Embed title"><input value={props.title || ""} onChange={(event) => set("title", event.target.value)} /></Field>
      </> : null}
      {["get_help", "newsletter", "needs", "pledges", "events"].includes(block.type) ? <>
        <Field label="Title"><input value={props.title || ""} onChange={(event) => set("title", event.target.value)} /></Field>
        <Field label="Description"><textarea rows={4} value={props.description || ""} onChange={(event) => set("description", event.target.value)} /></Field>
      </> : null}
      {block.type === "get_help" ? <Field label="Button label"><input value={props.label || ""} onChange={(event) => set("label", event.target.value)} /></Field> : null}
      {block.type === "newsletter" ? <Field label="Button label"><input value={props.buttonLabel || ""} onChange={(event) => set("buttonLabel", event.target.value)} /></Field> : null}

      <h4 style={{ marginTop: 18 }}>Typography and layout</h4>
      <div className="ppb-two">
        <Field label="Font"><select value={style.fontFamily || "system"} onChange={(event) => updateStyle({ fontFamily: event.target.value })}>{PUBLIC_PAGE_FONT_OPTIONS.map((font) => <option key={font.value} value={font.value}>{font.label}</option>)}</select></Field>
        <Field label="Size"><input type="number" min="12" max="96" value={style.fontSize || 18} onChange={(event) => updateStyle({ fontSize: Number(event.target.value) })} /></Field>
        <Field label="Weight"><select value={style.fontWeight || 400} onChange={(event) => updateStyle({ fontWeight: Number(event.target.value) })}><option value="400">Regular</option><option value="500">Medium</option><option value="600">Semibold</option><option value="700">Bold</option><option value="800">Heavy</option></select></Field>
        <Field label="Align"><select value={style.textAlign || "left"} onChange={(event) => updateStyle({ textAlign: event.target.value })}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></Field>
      </div>
      <div className="ppb-two">
        <Field label="Text color"><input type="color" value={/^#[0-9a-f]{6}$/i.test(style.color || "") ? style.color : "#232947"} onChange={(event) => updateStyle({ color: event.target.value })} /></Field>
        <Field label="Background"><input type="color" value={/^#[0-9a-f]{6}$/i.test(style.backgroundColor || "") ? style.backgroundColor : "#ffffff"} onChange={(event) => updateStyle({ backgroundColor: event.target.value })} /></Field>
      </div>
      <Field label="Padding CSS value"><input placeholder="e.g. 24px" value={style.padding || ""} onChange={(event) => updateStyle({ padding: event.target.value })} /></Field>
      <Field label="Margin CSS value"><input placeholder="e.g. 12px 0" value={style.margin || ""} onChange={(event) => updateStyle({ margin: event.target.value })} /></Field>
      <Field label="Line height"><input type="number" min="1" max="2.4" step="0.1" value={style.lineHeight || 1.5} onChange={(event) => updateStyle({ lineHeight: Number(event.target.value) })} /></Field>
      <Field label="Italic"><input type="checkbox" checked={style.fontStyle === "italic"} onChange={(event) => updateStyle({ fontStyle: event.target.checked ? "italic" : "normal" })} /></Field>
    </div>
  );
}

export const PublicPageBuilder = React.forwardRef(function PublicPageBuilder(_, ref) {
  const { orgId } = useParams();
  const [page, setPage] = React.useState(null);
  const [publishedPage, setPublishedPage] = React.useState(null);
  const [selectedId, setSelectedId] = React.useState("");
  const [device, setDevice] = React.useState("desktop");
  const [status, setStatus] = React.useState("Loading editor…");
  const [dirty, setDirty] = React.useState(false);
  const [past, setPast] = React.useState([]);
  const [future, setFuture] = React.useState([]);
  const timerRef = React.useRef(null);

  const load = React.useCallback(async () => {
    if (!orgId) return;
    setStatus("Loading editor…");
    try {
      const result = await api("/api/orgs/" + encodeURIComponent(orgId) + "/public/get", { method: "GET" });
      const publicConfig = result?.public || {};
      const draft = normalizePublicPage(result?.draft_page || publicConfig.page || legacyPageFromConfig(publicConfig));
      const published = result?.published_page ? normalizePublicPage(result.published_page) : (publicConfig.page ? normalizePublicPage(publicConfig.page) : null);
      setPage(draft);
      setPublishedPage(published);
      setPast([]);
      setFuture([]);
      setDirty(false);
      setStatus(result?.draft_page ? "Draft loaded" : "Migrated from current public page");
    } catch (error) {
      setStatus(error?.message || "Unable to load page editor.");
    }
  }, [orgId]);

  React.useEffect(() => { load(); }, [load]);

  const saveDraft = React.useCallback(async (nextPage = page, silent = false) => {
    if (!orgId || !nextPage) return false;
    try {
      await api("/api/orgs/" + encodeURIComponent(orgId) + "/public/save", { method: "POST", body: JSON.stringify({ page: nextPage }) });
      setDirty(false);
      setStatus("Draft saved");
      return true;
    } catch (error) {
      setStatus(error?.message || "Draft save failed.");
      if (!silent) window.alert(error?.message || "Draft save failed.");
      return false;
    }
  }, [orgId, page]);

  const updatePage = React.useCallback((producer, autosave = true) => {
    setPage((current) => {
      if (!current) return current;
      const next = typeof producer === "function" ? producer(current) : producer;
      setPast((items) => items.concat([current]).slice(-30));
      setFuture([]);
      setDirty(true);
      setStatus("Unsaved changes");
      if (autosave) {
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => saveDraft(next, true), 1200);
      }
      return normalizePublicPage(next);
    });
  }, [saveDraft]);

  const updateBlock = (blockId, producer) => updatePage((current) => ({
    ...current,
    blocks: current.blocks.map((block) => block.id === blockId ? producer(block) : block),
  }));

  const updateProps = (blockId, values) => updateBlock(blockId, (block) => ({ ...block, props: { ...block.props, ...values } }));
  const updateStyle = (blockId, values) => updateBlock(blockId, (block) => ({ ...block, style: { ...block.style, ...values } }));

  const addBlock = (type) => {
    const next = createBlock(type);
    updatePage((current) => ({ ...current, blocks: [...current.blocks, next] }));
    setSelectedId(next.id);
  };

  const removeBlock = (blockId) => {
    if (!window.confirm("Remove this block from the draft?")) return;
    updatePage((current) => ({ ...current, blocks: current.blocks.filter((block) => block.id !== blockId) }));
    setSelectedId("");
  };

  const duplicateBlock = (blockId) => {
    updatePage((current) => {
      const index = current.blocks.findIndex((block) => block.id === blockId);
      if (index < 0) return current;
      const copy = { ...current.blocks[index], id: createBlock(current.blocks[index].type).id };
      return { ...current, blocks: [...current.blocks.slice(0, index + 1), copy, ...current.blocks.slice(index + 1)] };
    });
  };

  const toggleHidden = (blockId) => updateBlock(blockId, (block) => ({ ...block, hidden: !block.hidden }));

  const moveBlock = (sourceId, targetId) => updatePage((current) => {
    const source = current.blocks.find((block) => block.id === sourceId);
    if (!source || sourceId === targetId) return current;
    const without = current.blocks.filter((block) => block.id !== sourceId);
    const targetIndex = without.findIndex((block) => block.id === targetId);
    without.splice(Math.max(0, targetIndex), 0, source);
    return { ...current, blocks: without };
  });

  const dragHandlers = {
    start: (event, id) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", id);
    },
    drop: (event, id) => {
      event.preventDefault();
      const source = event.dataTransfer.getData("text/plain");
      if (source) moveBlock(source, id);
    },
  };

  const undo = () => {
    if (!past.length || !page) return;
    const previous = past[past.length - 1];
    setPast((items) => items.slice(0, -1));
    setFuture((items) => [page, ...items].slice(0, 30));
    setPage(previous);
    setDirty(true);
    setStatus("Unsaved changes");
  };

  const redo = () => {
    if (!future.length || !page) return;
    const next = future[0];
    setFuture((items) => items.slice(1));
    setPast((items) => [...items, page].slice(-30));
    setPage(next);
    setDirty(true);
    setStatus("Unsaved changes");
  };

  const publish = async () => {
    if (!page) return;
    if (!(await saveDraft(page))) return;
    try {
      await api("/api/orgs/" + encodeURIComponent(orgId) + "/public/publish", { method: "POST" });
      setPublishedPage(page);
      setStatus("Published");
    } catch (error) {
      setStatus(error?.message || "Publish failed.");
      window.alert(error?.message || "Publish failed.");
    }
  };

  React.useImperativeHandle(ref, () => ({ save: () => saveDraft(page) }), [page, saveDraft]);

  React.useEffect(() => () => clearTimeout(timerRef.current), []);

  if (!page) return <section className="card" style={{ padding: 16 }}><p className="helper">{status}</p></section>;

  const selected = page.blocks.find((block) => block.id === selectedId) || null;

  return (
    <section className="card" style={{ padding: 16 }}>
      <div className="ppb-toolbar">
        <div>
          <h3 style={{ margin: 0 }}>Live public page editor</h3>
          <p className="ppb-status">{status}{publishedPage ? " · A published version exists" : " · Nothing published from the new editor yet"}</p>
        </div>
        <div className="ppb-toolbar-actions">
          <button className="btn" type="button" onClick={undo} disabled={!past.length}>Undo</button>
          <button className="btn" type="button" onClick={redo} disabled={!future.length}>Redo</button>
          <button className="btn" type="button" onClick={() => saveDraft(page)} disabled={!dirty}>{dirty ? "Save draft" : "Saved"}</button>
          <button className="btn-red" type="button" onClick={publish}>Publish</button>
        </div>
      </div>

      <div className="public-page-builder">
        <aside className="ppb-panel">
          <h4>Add block</h4>
          <div className="ppb-library">
            {PUBLIC_PAGE_BLOCK_TYPES.map((type) => <button key={type} type="button" onClick={() => addBlock(type)}>{LABELS[type]}</button>)}
          </div>
          <h4 style={{ marginTop: 18 }}>Page settings</h4>
          <Field label="Page title"><input value={page.meta.title || ""} onChange={(event) => updatePage((current) => ({ ...current, meta: { ...current.meta, title: event.target.value } }))} /></Field>
          <Field label="Description"><textarea rows={4} value={page.meta.description || ""} onChange={(event) => updatePage((current) => ({ ...current, meta: { ...current.meta, description: event.target.value } }))} /></Field>
          <Field label="Default font"><select value={page.theme.fontFamily} onChange={(event) => updatePage((current) => ({ ...current, theme: { ...current.theme, fontFamily: event.target.value } }))}>{PUBLIC_PAGE_FONT_OPTIONS.map((font) => <option key={font.value} value={font.value}>{font.label}</option>)}</select></Field>
          <div className="ppb-two">
            <Field label="Accent"><input type="color" value={page.theme.accentColor || "#6d5efc"} onChange={(event) => updatePage((current) => ({ ...current, theme: { ...current.theme, accentColor: event.target.value } }))} /></Field>
            <Field label="Background"><input type="color" value={page.theme.backgroundColor || "#f6f7fb"} onChange={(event) => updatePage((current) => ({ ...current, theme: { ...current.theme, backgroundColor: event.target.value } }))} /></Field>
          </div>
          <p className="ppb-muted">Drag a block by its frame to reorder it. Click text in the canvas to edit it directly.</p>
        </aside>

        <div className="ppb-stage">
          <div className="ppb-row" style={{ justifyContent: "center", marginBottom: 10 }}>
            {["desktop", "tablet", "mobile"].map((item) => <button key={item} className="ppb-small-button" type="button" onClick={() => setDevice(item)} aria-pressed={device === item}>{item[0].toUpperCase() + item.slice(1)}</button>)}
          </div>
          <div className={"ppb-device " + device}>
            {page.blocks.map((block) => (
              <BlockEditor
                key={block.id}
                block={block}
                selected={block.id === selectedId}
                onSelect={setSelectedId}
                onRemove={removeBlock}
                onDuplicate={duplicateBlock}
                onToggleHidden={toggleHidden}
                updateProps={(values) => updateProps(block.id, values)}
                updateStyle={(values) => updateStyle(block.id, values)}
                dragHandlers={dragHandlers}
              />
            ))}
            {!page.blocks.length ? <p className="ppb-muted" style={{ padding: 40, textAlign: "center" }}>Add a block to begin.</p> : null}
          </div>
        </div>

        <aside className="ppb-panel ppb-inspector">
          <BlockInspector
            block={selected}
            updateProps={(values) => selected && updateProps(selected.id, values)}
            updateStyle={(values) => selected && updateStyle(selected.id, values)}
          />
        </aside>
      </div>
    </section>
  );
});
