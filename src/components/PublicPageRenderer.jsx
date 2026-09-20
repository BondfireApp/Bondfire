import React from "react";
import { sealSubmission } from "../../shared/privateSubmission.js";
import { safePublicUrl } from "../../shared/publicPageModel.js";
import "./PublicPageBuilder.css";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");

const FONT_STACKS = {
  system: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  sans: 'Arial, Helvetica, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
  display: '"Trebuchet MS", "Avenir Next", sans-serif',
};

function blockStyle(block) {
  const s = block?.style || {};
  return {
    fontFamily: FONT_STACKS[s.fontFamily] || FONT_STACKS.system,
    fontSize: s.fontSize ? s.fontSize + "px" : undefined,
    fontWeight: s.fontWeight || undefined,
    fontStyle: s.fontStyle || undefined,
    color: s.color || undefined,
    backgroundColor: s.backgroundColor || undefined,
    textAlign: s.textAlign || undefined,
    lineHeight: s.lineHeight || undefined,
    letterSpacing: s.letterSpacing || undefined,
    padding: s.padding || undefined,
    margin: s.margin || undefined,
    borderRadius: s.borderRadius || undefined,
    maxWidth: s.maxWidth || undefined,
  };
}

function themeStyle(page) {
  const theme = page?.theme || {};
  return {
    "--pp-accent": theme.accentColor || "#6d5efc",
    "--pp-bg": theme.backgroundColor || "#f6f7fb",
    "--pp-text": theme.textColor || "#232947",
    "--pp-max": theme.maxWidth || "1120px",
    fontFamily: FONT_STACKS[theme.fontFamily] || FONT_STACKS.system,
  };
}

function linkTarget(url) {
  const value = String(url || "");
  return value.startsWith("http") || value.startsWith("mailto:") || value.startsWith("tel:") || value.startsWith("sms:") || value.startsWith("signal:");
}

async function submitPublic(slug, type, content) {
  const pageResponse = await fetch(API_BASE + "/api/public/" + encodeURIComponent(slug), { headers: { Accept: "application/json" } });
  const pageData = await pageResponse.json().catch(() => ({}));
  let body = content;
  if (pageData?.private_mode) {
    const keyResponse = await fetch(API_BASE + "/api/public/" + encodeURIComponent(slug) + "/submission-key");
    const keyData = await keyResponse.json().catch(() => ({}));
    body = await sealSubmission(keyData, type, content);
  }
  const path = type === "newsletter"
    ? "/api/p/" + encodeURIComponent(slug) + "/newsletter/subscribe"
    : "/api/p/" + encodeURIComponent(slug) + "/intake";
  const response = await fetch(API_BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) throw new Error(data?.error || data?.message || "Submission failed.");
  return data;
}

function ActionLink({ action, children, className = "pp-button", disabled = false }) {
  const url = String(action?.url || "");
  if (!url || url.startsWith("modal:") || url === "newsletter") {
    return <button className={className} type="button" disabled={disabled}>{children}</button>;
  }
  return (
    <a className={className} href={url} target={linkTarget(url) ? "_blank" : undefined} rel={linkTarget(url) ? "noreferrer" : undefined}>
      {children}
    </a>
  );
}

function NewsletterBlock({ block, slug, preview }) {
  const [email, setEmail] = React.useState("");
  const [name, setName] = React.useState("");
  const [message, setMessage] = React.useState("");
  const props = block.props || {};
  async function submit(event) {
    event.preventDefault();
    if (preview) return;
    setMessage("");
    try {
      await submitPublic(slug, "newsletter", { name, email });
      setName("");
      setEmail("");
      setMessage("Subscribed.");
    } catch (error) {
      setMessage(error?.message || "Subscription failed.");
    }
  }
  return (
    <section className="pp-module" style={blockStyle(block)} id="newsletter">
      <h2>{props.title || "Stay connected"}</h2>
      {props.description ? <p>{props.description}</p> : null}
      <form className="pp-form" onSubmit={submit}>
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name (optional)" aria-label="Name" disabled={preview} />
        <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email address" type="email" required aria-label="Email address" disabled={preview} />
        <button className="pp-button" type="submit" disabled={preview}>{props.buttonLabel || "Subscribe"}</button>
      </form>
      {message ? <p className="pp-status" role="status">{message}</p> : null}
    </section>
  );
}

function GetHelpBlock({ block, slug, preview }) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [contact, setContact] = React.useState("");
  const [details, setDetails] = React.useState("");
  const [message, setMessage] = React.useState("");
  const props = block.props || {};
  async function submit(event) {
    event.preventDefault();
    if (preview) return;
    setMessage("");
    try {
      await submitPublic(slug, "intake", { name, contact, details });
      setName("");
      setContact("");
      setDetails("");
      setMessage("Your request was sent.");
    } catch (error) {
      setMessage(error?.message || "Could not send the request.");
    }
  }
  return (
    <section className="pp-module" style={blockStyle(block)}>
      <h2>{props.title || "Get help"}</h2>
      {props.description ? <p>{props.description}</p> : null}
      <button className="pp-button" type="button" onClick={() => setOpen((value) => !value)} disabled={preview}>{props.label || "Get Help"}</button>
      {open && !preview ? (
        <form className="pp-form pp-help-form" onSubmit={submit}>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" required />
          <input value={contact} onChange={(event) => setContact(event.target.value)} placeholder="How can we reach you?" required />
          <textarea value={details} onChange={(event) => setDetails(event.target.value)} placeholder="What do you need?" required rows={4} />
          <button className="pp-button" type="submit">Send request</button>
        </form>
      ) : null}
      {message ? <p className="pp-status" role="status">{message}</p> : null}
    </section>
  );
}

function renderEmbed(url, title) {
  const parsed = safePublicUrl(url);
  if (!parsed) return null;
  let src = parsed;
  try {
    const host = new URL(parsed).hostname.toLowerCase();
    if (host === "youtube.com" || host === "www.youtube.com" || host === "m.youtube.com" || host === "youtu.be") {
      const video = host === "youtu.be" ? new URL(parsed).pathname.slice(1) : new URL(parsed).searchParams.get("v");
      if (video) src = "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(video);
    } else if (host === "vimeo.com" || host === "www.vimeo.com" || host === "player.vimeo.com") {
      const id = new URL(parsed).pathname.split("/").filter(Boolean).pop();
      if (id) src = "https://player.vimeo.com/video/" + encodeURIComponent(id);
    } else {
      return <a href={parsed} target="_blank" rel="noreferrer">{title || "Open embedded content"}</a>;
    }
  } catch {
    return null;
  }
  return <iframe className="pp-embed" src={src} title={title || "Embedded content"} loading="lazy" allowFullScreen />;
}


function InlineEditable({ value, onChange, className = "", as = "div", style }) {
  const Tag = as;
  return (
    <Tag
      className={"pp-inline-editable " + className}
      style={style}
      contentEditable
      suppressContentEditableWarning
      onInput={(event) => onChange?.(event.currentTarget.textContent || "")}
      onClick={(event) => event.stopPropagation()}
    >
      {value || ""}
    </Tag>
  );
}

function StandardBlock({ block, slug, preview, editor = false, onChangeProps }) {
  const props = block.props || {};
  const style = blockStyle(block);
  switch (block.type) {
    case "hero":
      return (
        <section className="pp-hero" style={style}>
          <div className="pp-hero-copy">
            {props.eyebrow || editor ? <InlineEditable value={props.eyebrow} onChange={(value) => onChangeProps?.({ eyebrow: value })} className="pp-eyebrow" as="p" /> : null}
            <InlineEditable value={props.title || props.text || "Public page"} onChange={(value) => onChangeProps?.({ title: value })} as="h1" />
            {props.text || editor ? <InlineEditable value={props.text} onChange={(value) => onChangeProps?.({ text: value })} className="pp-lede" as="p" /> : null}
            {Array.isArray(props.buttons) && props.buttons.length ? <div className="pp-actions">{props.buttons.map((item, index) => <ActionLink key={index} action={item}>{item.label}</ActionLink>)}</div> : null}
          </div>
          {props.imageUrl ? <img className="pp-hero-image" src={props.imageUrl} alt="" /> : null}
        </section>
      );
    case "heading":
      return editor
        ? <InlineEditable value={props.text || "Heading"} onChange={(value) => onChangeProps?.({ text: value })} className="pp-heading" as="h2" style={style} />
        : <h2 className="pp-heading" style={style}>{props.text || "Heading"}</h2>;
    case "text":
      return editor
        ? <InlineEditable value={props.text || ""} onChange={(value) => onChangeProps?.({ text: value })} className="pp-text" as="p" style={style} />
        : <p className="pp-text" style={style}>{props.text || ""}</p>;
    case "list":
      return <ul className="pp-list" style={style}>{(props.items || []).map((item, index) => <li key={index}>{item}</li>)}</ul>;
    case "button":
      return <div className="pp-actions" style={style}><ActionLink action={props}>{props.label || "Button"}</ActionLink></div>;
    case "image":
      return props.url ? <figure className="pp-figure" style={style}><img src={props.url} alt={props.alt || ""} /><figcaption>{props.caption || ""}</figcaption></figure> : null;
    case "quote":
      return <blockquote className="pp-quote" style={style}>
        {editor ? <InlineEditable value={props.text || ""} onChange={(value) => onChangeProps?.({ text: value })} as="p" /> : <p>{props.text || ""}</p>}
        {props.attribution || editor ? (editor ? <InlineEditable value={props.attribution} onChange={(value) => onChangeProps?.({ attribution: value })} as="cite" /> : <cite>{props.attribution}</cite>) : null}
      </blockquote>;
    case "divider":
      return <hr className="pp-divider" style={style} />;
    case "spacer":
      return <div aria-hidden="true" style={{ height: Number(props.height) || 48, ...style }} />;
    case "embed":
      return <div className="pp-embed-wrap" style={style}>{renderEmbed(props.url, props.title)}</div>;
    case "newsletter":
      return <NewsletterBlock block={block} slug={slug} preview={preview} />;
    case "get_help":
      return <GetHelpBlock block={block} slug={slug} preview={preview} />;
    case "needs":
    case "pledges":
    case "events":
      return <section className="pp-module" style={style} id={block.type}><h2>{props.title}</h2>{props.description ? <p>{props.description}</p> : null}<p className="pp-module-note">This section is available on the public page.</p></section>;
    default:
      return null;
  }
}

export function PublicPageRenderer({
  page,
  slug = "",
  preview = false,
  editor = false,
  selectedId = "",
  onSelect,
  onChangeProps,
  onToggleHidden,
  onDuplicate,
  onRemove,
  onMove,
}) {
  const normalized = page || { blocks: [] };
  const [draggedId, setDraggedId] = React.useState("");

  function frameFor(block) {
    const visible = !block.hidden;
    if (!editor) {
      if (!visible) return null;
      return (
        <div key={block.id} className="pp-render-block">
          <StandardBlock block={block} slug={slug} preview={preview} />
        </div>
      );
    }
    return (
      <div
        key={block.id}
        className={"pp-render-block pp-live-block" + (selectedId === block.id ? " pp-selected" : "") + (block.hidden ? " pp-is-hidden" : "")}
        draggable
        tabIndex={0}
        aria-label={(block.hidden ? "Hidden " : "") + (block.type || "page") + " block"}
        onClick={(event) => { event.stopPropagation(); onSelect?.(block.id); }}
        onDragStart={(event) => {
          setDraggedId(block.id);
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", block.id);
        }}
        onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }}
        onDrop={(event) => {
          event.preventDefault();
          const fromId = event.dataTransfer.getData("text/plain") || draggedId;
          if (fromId) onMove?.(fromId, block.id);
          setDraggedId("");
        }}
      >
        <div className="pp-live-block-toolbar" onClick={(event) => event.stopPropagation()}>
          <span className="pp-live-drag-handle" title="Drag to reorder" aria-hidden="true">⋮⋮</span>
          <span className="pp-live-block-name">{block.type}</span>
          <button type="button" onClick={() => onToggleHidden?.(block.id)}>{block.hidden ? "Show" : "Hide"}</button>
          <button type="button" onClick={() => onDuplicate?.(block.id)}>Duplicate</button>
          <button type="button" className="pp-live-danger" onClick={() => onRemove?.(block.id)}>Delete</button>
        </div>
        {block.hidden ? <div className="pp-live-hidden-label">Hidden on the public page</div> : null}
        <StandardBlock
          block={block}
          slug={slug}
          preview={preview || editor}
          editor={editor}
          onChangeProps={(patch) => onChangeProps?.(block.id, patch)}
        />
      </div>
    );
  }

  return (
    <main className={"pp-page" + (preview ? " pp-preview" : "") + (editor ? " pp-editor-canvas" : "")} style={themeStyle(normalized)} onClick={() => editor && onSelect?.("")}>
      <div className="pp-page-inner">
        {Array.isArray(normalized.blocks) ? normalized.blocks.map(frameFor) : null}
        {editor && !normalized.blocks.length ? <div className="pp-empty-page">Add a block from the left to start building this page.</div> : null}
      </div>
    </main>
  );
}

export default PublicPageRenderer;
