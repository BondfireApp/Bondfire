import * as React from "react";
import { useParams } from "react-router-dom";
import { api } from "../utils/api.js";

const SECTION_KEYS = ["hero", "archive", "about", "join", "membership", "events", "newsletter", "contact"];
const IMAGE_LIMIT = 450_000;

function lines(value) {
  return Array.isArray(value) ? value.join("\n") : "";
}

function fromLines(value) {
  return String(value || "").split("\n").map((item) => item.trim()).filter(Boolean);
}

function joinCardsToText(items) {
  return (Array.isArray(items) ? items : []).map((item) => `${item?.title || ""} | ${item?.body || ""}`).join("\n");
}

function joinCardsFromText(value) {
  return String(value || "").split("\n").map((line) => {
    const [title, ...body] = line.split("|").map((part) => part.trim());
    return title || body.length ? { title, body: body.join(" | ") } : null;
  }).filter(Boolean).slice(0, 6);
}

function linksToText(items) {
  return (Array.isArray(items) ? items : []).map((item) => `${item?.label || ""} | ${item?.url || ""}`).join("\n");
}

function linksFromText(value, limit = 6) {
  return String(value || "").split("\n").map((line) => {
    const [label, ...url] = line.split("|").map((part) => part.trim());
    return label && url.length ? { label, url: url.join(" | ") } : null;
  }).filter(Boolean).slice(0, limit);
}

function archiveToText(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => [item.title || "", item.image_url || "", item.caption || ""].join(" | "))
    .join("\n");
}

function archiveFromText(value) {
  return String(value || "").split("\n").map((line) => {
    const [title, image_url, ...caption] = line.split("|").map((part) => part.trim());
    if (!title && !image_url && !caption.length) return null;
    return { title, image_url, caption: caption.join(" | ") };
  }).filter(Boolean).slice(0, 24);
}

function Field({ label, children }) {
  return <label className="grid" style={{ gap: 6 }}><span className="helper">{label}</span>{children}</label>;
}

function SectionToggle({ name, checked, onChange }) {
  return (
    <label className="row" style={{ gap: 8, alignItems: "center" }}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{name}</span>
    </label>
  );
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that image."));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("That image could not be decoded."));
    image.src = src;
  });
}

async function portableImage(file) {
  if (!file || !String(file.type || "").startsWith("image/")) throw new Error("Choose an image file.");
  const original = await readFile(file);
  if (original.length <= IMAGE_LIMIT) return original;
  const image = await loadImage(original);
  const scale = Math.min(1, 1600 / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.86, 0.76, 0.66, 0.56]) {
    const compressed = canvas.toDataURL("image/webp", quality);
    if (compressed.length <= IMAGE_LIMIT) return compressed;
  }
  throw new Error("That image is still too large after compression. Choose a smaller image.");
}

function ImageField({ label, value, onChange }) {
  const inputRef = React.useRef(null);
  const [working, setWorking] = React.useState(false);
  return (
    <div className="grid" style={{ gap: 6 }}>
      <Field label={label}><input className="input" value={value || ""} onChange={(event) => onChange(event.target.value)} placeholder="https://… or /site-asset.jpg" /></Field>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button className="btn" type="button" disabled={working} onClick={() => inputRef.current?.click()}>{working ? "Preparing…" : "Upload image"}</button>
        {value ? <button className="btn" type="button" disabled={working} onClick={() => onChange("")}>Remove image</button> : null}
        <input
          ref={inputRef}
          hidden
          type="file"
          accept="image/*"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            setWorking(true);
            try { onChange(await portableImage(file)); }
            catch (error) { window.alert(error?.message || "Unable to prepare image."); }
            finally { setWorking(false); }
          }}
        />
      </div>
      {value ? <img src={value} alt="" style={{ maxWidth: 240, maxHeight: 150, objectFit: "contain", borderRadius: 8 }} /> : null}
    </div>
  );
}

export const PublicSiteContentCard = React.forwardRef(function PublicSiteContentCard(_, ref) {
  const { orgId } = useParams();
  const [form, setForm] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState("");

  const set = (key, value) => setForm((current) => ({ ...(current || {}), [key]: value }));

  const load = React.useCallback(async () => {
    if (!orgId) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await api(`/api/orgs/${encodeURIComponent(orgId)}/public/get`, { method: "GET" });
      const pub = result?.public || {};
      setForm({
        template: pub.template || "default",
        title: pub.title || "",
        location: pub.location || "",
        branch_label: pub.branch_label || "",
        logo_url: pub.logo_url || pub.logoUrl || pub.logo_data_url || pub.logoDataUrl || "",
        hero_headline: pub.hero_headline || "",
        hero_text: pub.hero_text || "",
        hero_image_url: pub.hero_image_url || "",
        font_family: pub.font_family || "system",
        accent_color: pub.accent_color || "#6d5efc",
        theme_mode: pub.theme_mode || "light",
        primary_actions: linksToText(pub.primary_actions),
        about_intro: pub.about_intro || "",
        purpose_title: pub.purpose_title || "",
        site_purpose_items: lines(pub.site_purpose_items),
        about_title: pub.about_title || "",
        about_card_title: pub.about_card_title || "",
        about_card_body: pub.about_card_body || "",
        location_card_title: pub.location_card_title || "",
        location_card_body: pub.location_card_body || "",
        show_what_we_do: pub.show_what_we_do !== false,
        what_we_do: lines(pub.what_we_do),
        join_title: pub.join_title || "",
        join_intro: pub.join_intro || "",
        join_cards: joinCardsToText(pub.join_cards),
        get_involved_links: linksToText(pub.get_involved_links),
        membership_title: pub.membership_title || "",
        membership_intro: pub.membership_intro || "",
        membership_details_title: pub.membership_details_title || "",
        membership_details_body: pub.membership_details_body || "",
        membership_includes_title: pub.membership_includes_title || "",
        membership_includes_items: lines(pub.membership_includes_items),
        membership_dues_title: pub.membership_dues_title || "",
        membership_dues_items: lines(pub.membership_dues_items),
        membership_cta_title: pub.membership_cta_title || "",
        membership_cta_body: pub.membership_cta_body || "",
        membership_poster_url: pub.membership_poster_url || "",
        membership_url: pub.membership_url || "",
        archive_title: pub.archive_title || "",
        archive_intro: pub.archive_intro || "",
        archive_items: archiveToText(pub.archive_items),
        events_title: pub.events_title || "",
        events_intro: pub.events_intro || "",
        events_items: lines(pub.events_items),
        contact_title: pub.contact_title || "",
        contact_intro: pub.contact_intro || "",
        contact_card_title: pub.contact_card_title || "",
        contact_card_body: pub.contact_card_body || "",
        member_access_title: pub.member_access_title || "",
        member_access_body: pub.member_access_body || "",
        section_order: Array.isArray(pub.section_order) && pub.section_order.length ? pub.section_order.join(", ") : SECTION_KEYS.join(", "),
        section_visibility: Object.fromEntries(SECTION_KEYS.map((key) => [key, pub.section_visibility?.[key] !== false])),
      });
    } catch (error) {
      setMessage(error?.message || "Unable to load public-site content.");
    } finally {
      setBusy(false);
    }
  }, [orgId]);

  React.useEffect(() => { load(); }, [load]);

  async function save({ silent = false, throwOnError = false } = {}) {
    if (!orgId || !form) return false;
    setBusy(true);
    if (!silent) setMessage("");
    try {
      const logoIsData = String(form.logo_url || "").startsWith("data:image/");
      const payload = {
        template: form.template,
        title: form.title,
        location: form.location,
        branch_label: form.branch_label,
        logo_url: logoIsData ? "" : form.logo_url,
        logo_data_url: logoIsData ? form.logo_url : "",
        hero_headline: form.hero_headline,
        hero_text: form.hero_text,
        hero_image_url: form.hero_image_url,
        font_family: form.font_family,
        accent_color: form.accent_color,
        theme_mode: form.theme_mode,
        primary_actions: linksFromText(form.primary_actions, 3),
        about_intro: form.about_intro,
        purpose_title: form.purpose_title,
        site_purpose_items: fromLines(form.site_purpose_items),
        about_title: form.about_title,
        about_card_title: form.about_card_title,
        about_card_body: form.about_card_body,
        location_card_title: form.location_card_title,
        location_card_body: form.location_card_body,
        show_what_we_do: !!form.show_what_we_do,
        what_we_do: fromLines(form.what_we_do),
        join_title: form.join_title,
        join_intro: form.join_intro,
        join_cards: joinCardsFromText(form.join_cards),
        get_involved_links: linksFromText(form.get_involved_links, 6),
        membership_title: form.membership_title,
        membership_intro: form.membership_intro,
        membership_details_title: form.membership_details_title,
        membership_details_body: form.membership_details_body,
        membership_includes_title: form.membership_includes_title,
        membership_includes_items: fromLines(form.membership_includes_items),
        membership_dues_title: form.membership_dues_title,
        membership_dues_items: fromLines(form.membership_dues_items),
        membership_cta_title: form.membership_cta_title,
        membership_cta_body: form.membership_cta_body,
        membership_poster_url: form.membership_poster_url,
        membership_url: form.membership_url,
        archive_title: form.archive_title,
        archive_intro: form.archive_intro,
        archive_items: archiveFromText(form.archive_items),
        events_title: form.events_title,
        events_intro: form.events_intro,
        events_items: fromLines(form.events_items),
        contact_title: form.contact_title,
        contact_intro: form.contact_intro,
        contact_card_title: form.contact_card_title,
        contact_card_body: form.contact_card_body,
        member_access_title: form.member_access_title,
        member_access_body: form.member_access_body,
        section_order: String(form.section_order || "").split(",").map((item) => item.trim()).filter((item) => SECTION_KEYS.includes(item)),
        section_visibility: form.section_visibility,
      };
      await api(`/api/orgs/${encodeURIComponent(orgId)}/public/save`, { method: "POST", body: JSON.stringify(payload) });
      if (!silent) setMessage("Public-site content saved.");
      await load();
      return true;
    } catch (error) {
      if (!silent) setMessage(error?.message || "Unable to save public-site content.");
      if (throwOnError) throw error;
      return false;
    } finally {
      setBusy(false);
    }
  }

  React.useImperativeHandle(ref, () => ({
    save: () => save({ silent: true, throwOnError: true }),
  }), [form, orgId]);

  if (!form) return <section className="card" style={{ padding: 16 }}><p className="helper">{busy ? "Loading public-site content…" : message || "Public-site content unavailable."}</p></section>;

  return (
    <section className="card" style={{ padding: 16 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h3 style={{ marginTop: 0 }}>Site layout and organization content</h3>
          <p className="helper" style={{ marginBottom: 0 }}>Build the public Organization Page here. The organizing layout supports unions, chapters, associations, established groups, and other organizations that need more than a mutual-aid listing.</p>
        </div>
        <button className="btn-red" type="button" onClick={() => save()} disabled={busy}>{busy ? "Saving…" : "Save site content"}</button>
      </div>

      {message ? <p className="helper">{message}</p> : null}

      <div className="grid" style={{ gap: 14, marginTop: 14 }}>
        <div className="bf-two">
          <Field label="Public-site layout">
            <select className="input" value={form.template} onChange={(event) => set("template", event.target.value)}>
              <option value="default">Standard mutual-aid page</option>
              <option value="organizing">Organizing / membership site</option>
            </select>
          </Field>
          <Field label="Public site name"><input className="input" value={form.title} onChange={(event) => set("title", event.target.value)} placeholder="Organization name" /></Field>
          <Field label="Display / chapter label"><input className="input" value={form.branch_label} onChange={(event) => set("branch_label", event.target.value)} placeholder="Local 123 · Olympia Branch · Community Chapter" /></Field>
          <Field label="Location"><input className="input" value={form.location} onChange={(event) => set("location", event.target.value)} /></Field>
        </div>

        <div className="card" style={{ padding: 12 }}>
          <h4 style={{ marginTop: 0 }}>Sections</h4>
          <div className="bf-two">
            {SECTION_KEYS.map((key) => <SectionToggle key={key} name={key[0].toUpperCase() + key.slice(1)} checked={form.section_visibility?.[key] !== false} onChange={(checked) => set("section_visibility", { ...form.section_visibility, [key]: checked })} />)}
          </div>
          <Field label="Section order (comma separated)"><input className="input" value={form.section_order} onChange={(event) => set("section_order", event.target.value)} /></Field>
        </div>

        <div className="card" style={{ padding: 12 }}>
          <h4 style={{ marginTop: 0 }}>Brand and hero</h4>
          <ImageField label="Logo" value={form.logo_url} onChange={(value) => set("logo_url", value)} />
          <Field label="Headline"><input className="input" value={form.hero_headline} onChange={(event) => set("hero_headline", event.target.value)} /></Field>
          <Field label="Intro"><textarea className="textarea" rows={3} value={form.hero_text} onChange={(event) => set("hero_text", event.target.value)} /></Field>
          <ImageField label="Hero image" value={form.hero_image_url} onChange={(value) => set("hero_image_url", value)} />
          <div className="bf-two">
            <Field label="Font family"><input className="input" value={form.font_family} onChange={(event) => set("font_family", event.target.value)} placeholder="system" /></Field>
            <Field label="Accent color"><input className="input" type="color" value={form.accent_color || "#6d5efc"} onChange={(event) => set("accent_color", event.target.value)} /></Field>
            <Field label="Theme"><select className="input" value={form.theme_mode} onChange={(event) => set("theme_mode", event.target.value)}><option value="light">Light</option><option value="dark">Dark</option></select></Field>
          </div>
          <Field label="Hero buttons: Label | URL, one per line"><textarea className="textarea" rows={4} value={form.primary_actions} onChange={(event) => set("primary_actions", event.target.value)} /></Field>
        </div>

        <div className="card" style={{ padding: 12 }}>
          <h4 style={{ marginTop: 0 }}>About and purpose</h4>
          <Field label="About heading"><input className="input" value={form.about_title} onChange={(event) => set("about_title", event.target.value)} /></Field>
          <Field label="About intro"><textarea className="textarea" rows={3} value={form.about_intro} onChange={(event) => set("about_intro", event.target.value)} /></Field>
          <Field label="Purpose heading"><input className="input" value={form.purpose_title} onChange={(event) => set("purpose_title", event.target.value)} /></Field>
          <Field label="Purpose items (one per line)"><textarea className="textarea" rows={4} value={form.site_purpose_items} onChange={(event) => set("site_purpose_items", event.target.value)} /></Field>
          <div className="bf-two">
            <Field label="About card title"><input className="input" value={form.about_card_title} onChange={(event) => set("about_card_title", event.target.value)} /></Field>
            <Field label="Location card title"><input className="input" value={form.location_card_title} onChange={(event) => set("location_card_title", event.target.value)} /></Field>
          </div>
          <Field label="About card body"><textarea className="textarea" rows={3} value={form.about_card_body} onChange={(event) => set("about_card_body", event.target.value)} /></Field>
          <Field label="Location card body"><textarea className="textarea" rows={2} value={form.location_card_body} onChange={(event) => set("location_card_body", event.target.value)} /></Field>
          <SectionToggle name="Show What we do" checked={form.show_what_we_do} onChange={(checked) => set("show_what_we_do", checked)} />
          <Field label="What we do (one per line)"><textarea className="textarea" rows={5} value={form.what_we_do} onChange={(event) => set("what_we_do", event.target.value)} /></Field>
        </div>

        <div className="card" style={{ padding: 12 }}>
          <h4 style={{ marginTop: 0 }}>Join / participate</h4>
          <Field label="Join heading"><input className="input" value={form.join_title} onChange={(event) => set("join_title", event.target.value)} /></Field>
          <Field label="Join intro"><textarea className="textarea" rows={3} value={form.join_intro} onChange={(event) => set("join_intro", event.target.value)} /></Field>
          <Field label="Join cards: Title | Body, one per line"><textarea className="textarea" rows={5} value={form.join_cards} onChange={(event) => set("join_cards", event.target.value)} /></Field>
          <Field label="Join links: Label | URL, one per line"><textarea className="textarea" rows={5} value={form.get_involved_links} onChange={(event) => set("get_involved_links", event.target.value)} /></Field>
        </div>

        <div className="card" style={{ padding: 12 }}>
          <h4 style={{ marginTop: 0 }}>Membership</h4>
          <div className="bf-two">
            <Field label="Membership heading"><input className="input" value={form.membership_title} onChange={(event) => set("membership_title", event.target.value)} /></Field>
            <Field label="Membership / join URL"><input className="input" value={form.membership_url} onChange={(event) => set("membership_url", event.target.value)} placeholder="https://…" /></Field>
          </div>
          <Field label="Membership intro"><textarea className="textarea" rows={3} value={form.membership_intro} onChange={(event) => set("membership_intro", event.target.value)} /></Field>
          <Field label="Eligibility heading"><input className="input" value={form.membership_details_title} onChange={(event) => set("membership_details_title", event.target.value)} /></Field>
          <Field label="Eligibility text"><textarea className="textarea" rows={3} value={form.membership_details_body} onChange={(event) => set("membership_details_body", event.target.value)} /></Field>
          <Field label="Who this includes heading"><input className="input" value={form.membership_includes_title} onChange={(event) => set("membership_includes_title", event.target.value)} /></Field>
          <Field label="Who this includes (one per line)"><textarea className="textarea" rows={4} value={form.membership_includes_items} onChange={(event) => set("membership_includes_items", event.target.value)} /></Field>
          <Field label="Dues / contribution heading"><input className="input" value={form.membership_dues_title} onChange={(event) => set("membership_dues_title", event.target.value)} /></Field>
          <Field label="Dues / contribution lines"><textarea className="textarea" rows={4} value={form.membership_dues_items} onChange={(event) => set("membership_dues_items", event.target.value)} /></Field>
          <Field label="Call-to-action heading"><input className="input" value={form.membership_cta_title} onChange={(event) => set("membership_cta_title", event.target.value)} /></Field>
          <Field label="Call-to-action text"><textarea className="textarea" rows={3} value={form.membership_cta_body} onChange={(event) => set("membership_cta_body", event.target.value)} /></Field>
          <ImageField label="Membership image" value={form.membership_poster_url} onChange={(value) => set("membership_poster_url", value)} />
        </div>

        <div className="card" style={{ padding: 12 }}>
          <h4 style={{ marginTop: 0 }}>History / archive</h4>
          <Field label="Archive heading"><input className="input" value={form.archive_title} onChange={(event) => set("archive_title", event.target.value)} /></Field>
          <Field label="Archive intro"><textarea className="textarea" rows={3} value={form.archive_intro} onChange={(event) => set("archive_intro", event.target.value)} /></Field>
          <Field label="Archive items: Title | Image URL | Caption, one per line"><textarea className="textarea" rows={7} value={form.archive_items} onChange={(event) => set("archive_items", event.target.value)} /></Field>
        </div>

        <div className="card" style={{ padding: 12 }}>
          <h4 style={{ marginTop: 0 }}>Events and contact</h4>
          <Field label="Events heading"><input className="input" value={form.events_title} onChange={(event) => set("events_title", event.target.value)} /></Field>
          <Field label="Events intro"><textarea className="textarea" rows={2} value={form.events_intro} onChange={(event) => set("events_intro", event.target.value)} /></Field>
          <Field label="Event / activity notes (one per line)"><textarea className="textarea" rows={4} value={form.events_items} onChange={(event) => set("events_items", event.target.value)} /></Field>
          <Field label="Contact heading"><input className="input" value={form.contact_title} onChange={(event) => set("contact_title", event.target.value)} /></Field>
          <Field label="Contact intro"><textarea className="textarea" rows={2} value={form.contact_intro} onChange={(event) => set("contact_intro", event.target.value)} /></Field>
          <Field label="Contact card title"><input className="input" value={form.contact_card_title} onChange={(event) => set("contact_card_title", event.target.value)} /></Field>
          <Field label="Contact card body"><textarea className="textarea" rows={3} value={form.contact_card_body} onChange={(event) => set("contact_card_body", event.target.value)} /></Field>
          <Field label="Member access heading"><input className="input" value={form.member_access_title} onChange={(event) => set("member_access_title", event.target.value)} /></Field>
          <Field label="Member access text"><textarea className="textarea" rows={3} value={form.member_access_body} onChange={(event) => set("member_access_body", event.target.value)} /></Field>
        </div>
      </div>
    </section>
  );
});
