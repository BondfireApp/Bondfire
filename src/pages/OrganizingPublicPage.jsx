import React from "react";
import LaborHistoryArchive from "../components/LaborHistoryArchive.jsx";
import { usePublicDocumentBrand } from "../lib/publicDocumentBrand.js";
import { sealSubmission } from "../../shared/privateSubmission.js";
import "../styles/organizing-public.css";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");
const APP_ORIGIN = (import.meta.env.VITE_APP_ORIGIN || "https://bondfireapp.org").replace(/\/+$/, "");

async function fetchJson(path) {
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) throw new Error(data?.error || data?.message || `HTTP ${response.status}`);
  return data;
}

function safeAction(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (value.startsWith("#")) return value;
  if (/^(https?:\/\/|mailto:|tel:|sms:|signal:)/i.test(value)) return value;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  return `https://${value}`;
}

function actionSpec(raw) {
  const value = String(raw || "").trim();
  if (!value) return { kind: "none", url: "" };
  const lowered = value.toLowerCase();
  if (lowered === "newsletter") return { kind: "anchor", url: "#newsletter" };
  if (value.startsWith("#")) return { kind: "anchor", url: value };
  if (lowered.startsWith("modal:")) {
    return { kind: "modal", modal: lowered.slice(6).trim(), url: value };
  }
  return { kind: "external", url: safeAction(value) };
}

async function postJson(path, body) {
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) throw new Error(data?.error || data?.message || `HTTP ${response.status}`);
  return data;
}

function scrollToSection(id) {
  const target = document.getElementById(String(id || "").replace(/^#/, ""));
  target?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function visible(pub, key) {
  return pub?.section_visibility?.[key] !== false;
}

function SectionLabel({ children }) {
  return <div className="bf-organizing-kicker">{children}</div>;
}

function SectionButton({ id, children, className = "" }) {
  return <button type="button" className={className} onClick={() => scrollToSection(id)}>{children}</button>;
}

function Actions({ items = [], onAction }) {
  const clean = (Array.isArray(items) ? items : []).filter((item) => item?.label && item?.url).slice(0, 6);
  if (!clean.length) return null;
  return (
    <div className="bf-organizing-actions">
      {clean.map((item, index) => {
        const spec = actionSpec(item.url);
        const className = `bf-organizing-button${index === 0 ? " primary" : ""}`;

        if (spec.kind === "modal") {
          return (
            <button
              key={`${item.label}-${index}`}
              type="button"
              className={className}
              onClick={() => onAction?.(spec, item)}
            >
              {item.label}
            </button>
          );
        }

        if (spec.kind === "anchor") {
          return (
            <button
              key={`${item.label}-${index}`}
              type="button"
              className={className}
              onClick={() => onAction?.(spec, item)}
            >
              {item.label}
            </button>
          );
        }

        const external = /^https?:\/\//i.test(spec.url);
        return (
          <a
            key={`${item.label}-${index}`}
            className={className}
            href={spec.url}
            target={external ? "_blank" : undefined}
            rel={external ? "noopener noreferrer" : undefined}
          >
            {item.label}
          </a>
        );
      })}
    </div>
  );
}

function ListCard({ title, items }) {
  const values = (Array.isArray(items) ? items : []).filter(Boolean);
  if (!title && !values.length) return null;
  return (
    <article className="bf-organizing-card">
      {title ? <h3>{title}</h3> : null}
      {values.length ? <ul className="bf-organizing-list">{values.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul> : null}
    </article>
  );
}

export default function OrganizingPublicPage({ slug, initialData = null }) {
  const publicSlug = String(slug || "").trim();
  const [state, setState] = React.useState(() => initialData
    ? { loading: false, error: "", data: initialData }
    : { loading: true, error: "", data: null });
  const [meetings, setMeetings] = React.useState([]);
  const [historyManifest, setHistoryManifest] = React.useState(null);
  const [activeModal, setActiveModal] = React.useState(null);
  const [intakeName, setIntakeName] = React.useState("");
  const [intakeContact, setIntakeContact] = React.useState("");
  const [intakeDetails, setIntakeDetails] = React.useState("");
  const [intakeExtra, setIntakeExtra] = React.useState("");
  const [intakeMessage, setIntakeMessage] = React.useState("");
  const [intakeBusy, setIntakeBusy] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const page = initialData || await fetchJson(`/api/public/${encodeURIComponent(publicSlug)}`);
        const meetingData = await fetchJson(`/api/public/${encodeURIComponent(publicSlug)}/meetings`).catch(() => ({ meetings: [] }));
        if (!alive) return;
        setState({ loading: false, error: "", data: page });
        setMeetings(Array.isArray(meetingData?.meetings) ? meetingData.meetings : []);
      } catch (error) {
        if (alive) setState({ loading: false, error: String(error?.message || error), data: null });
      }
    })();
    return () => { alive = false; };
  }, [publicSlug, initialData]);

  React.useEffect(() => {
    let alive = true;
    const manifestUrl = `/${encodeURIComponent(publicSlug)}/labor-history/manifest.json`;
    fetch(manifestUrl, { headers: { Accept: "application/json" } })
      .then((response) => response.ok ? response.json() : null)
      .then((manifest) => { if (alive) setHistoryManifest(manifest?.collections?.length ? manifest : null); })
      .catch(() => { if (alive) setHistoryManifest(null); });
    return () => { alive = false; };
  }, [publicSlug]);

  const documentPublic = state.data?.public || null;
  usePublicDocumentBrand(
    documentPublic?.title || documentPublic?.branch_label || "",
    documentPublic?.logoDataUrl || documentPublic?.logoUrl || historyManifest?.siteIconUrl || "",
  );

  if (state.loading) return <div className="bf-organizing-site"><div className="bf-organizing-empty">Loading organization site…</div></div>;
  if (state.error || !state.data?.public) return <div className="bf-organizing-site"><div className="bf-organizing-empty">This organization site is unavailable.</div></div>;

  const pub = state.data.public;
  const orgId = state.data.orgId || "";
  const title = pub.title || pub.branch_label || "Organization";
  const headline = pub.hero_headline || title;
  const lede = pub.hero_text || pub.about || "";
  const logo = pub.logoDataUrl || pub.logoUrl || historyManifest?.siteIconUrl || "";
  const accent = pub.accent_color || "#9a433a";
  const memberHref = `${APP_ORIGIN}/#/signin?org=${encodeURIComponent(orgId)}`;
  const publication = pub.connected_publication?.available && pub.connected_publication?.url ? pub.connected_publication : null;
  const membershipItems = Array.isArray(pub.membership_includes_items) ? pub.membership_includes_items : [];
  const duesItems = Array.isArray(pub.membership_dues_items) ? pub.membership_dues_items : [];
  const archiveItems = Array.isArray(pub.archive_items) ? pub.archive_items : [];
  const purposeItems = Array.isArray(pub.site_purpose_items) ? pub.site_purpose_items : [];
  const eventItems = Array.isArray(pub.events_items) ? pub.events_items : [];

  const openIntake = (kind) => {
    const normalized = String(kind || "").trim().toLowerCase();
    if (!["get_help", "volunteer", "offer_resources"].includes(normalized)) return;
    setActiveModal(normalized);
    setIntakeName("");
    setIntakeContact("");
    setIntakeDetails("");
    setIntakeExtra("");
    setIntakeMessage("");
  };

  const closeIntake = () => {
    if (intakeBusy) return;
    setActiveModal(null);
    setIntakeMessage("");
  };

  const handleAction = (spec) => {
    if (spec?.kind === "modal") {
      openIntake(spec.modal);
      return;
    }
    if (spec?.kind === "anchor") {
      scrollToSection(spec.url);
    }
  };

  const submitIntake = async (event) => {
    event?.preventDefault();
    if (!activeModal || intakeBusy) return;

    if (!String(intakeName || "").trim() || !String(intakeContact || "").trim()) {
      setIntakeMessage("Name and contact are required.");
      return;
    }

    setIntakeBusy(true);
    setIntakeMessage("");
    try {
      const clearBody = {
        kind: activeModal,
        name: String(intakeName || "").trim(),
        contact: String(intakeContact || "").trim(),
        details: String(intakeDetails || "").trim(),
        extra: String(intakeExtra || "").trim(),
      };

      let body = clearBody;
      if (state.data?.private_mode) {
        const recipient = await fetchJson(`/api/public/${encodeURIComponent(publicSlug)}/submission-key`);
        body = await sealSubmission(recipient, "intake", clearBody);
      }

      await postJson(`/api/p/${encodeURIComponent(publicSlug)}/intake`, body);
      setIntakeMessage("Sent. The branch can review it in the member workspace.");
      setTimeout(() => {
        setActiveModal(null);
        setIntakeMessage("");
      }, 1100);
    } catch (error) {
      setIntakeMessage(error?.message || "Unable to send the form.");
    } finally {
      setIntakeBusy(false);
    }
  };

  const modalCopy = activeModal === "get_help"
    ? {
        title: "Request Assistance",
        intro: `Tell ${title} what you need and how to reach you.`,
        details: "What assistance do you need?",
        extra: "Urgency, timing, or anything else we should know",
        submit: "Send Request",
      }
    : activeModal === "volunteer"
      ? {
          title: "Volunteer",
          intro: `Tell ${title} how you would like to help.`,
          details: "Skills, interests, or what you want to help with",
          extra: "Availability or scheduling notes",
          submit: "Send Volunteer Info",
        }
      : {
          title: "Offer Resources",
          intro: `Tell ${title} what you can offer and how to reach you.`,
          details: "What resources can you offer?",
          extra: "Quantity, timing, pickup details, or other notes",
          submit: "Send Offer",
        };

  const sections = {
    hero: (
      <section key="hero" className="bf-organizing-hero">
        <div>
          <SectionLabel>{pub.branch_label || pub.location || "Organization"}</SectionLabel>
          <h1>{headline}</h1>
          {lede ? <p className="bf-organizing-lede">{lede}</p> : null}
          <Actions items={pub.primary_actions} onAction={handleAction} />
        </div>
        <aside className="bf-organizing-card">
          {pub.hero_image_url ? <img className="bf-organizing-hero-image" src={pub.hero_image_url} alt="" /> : null}
          {pub.purpose_title ? <h2>{pub.purpose_title}</h2> : null}
          {purposeItems.length ? <ul className="bf-organizing-list">{purposeItems.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul> : null}
        </aside>
      </section>
    ),
    about: (
      <section key="about" id="about" className="bf-organizing-section">
        <SectionLabel>About</SectionLabel>
        <h2>{pub.about_title || "About this organization"}</h2>
        {pub.about_intro ? <p className="bf-organizing-section-copy">{pub.about_intro}</p> : null}
        <div className="bf-organizing-grid-2">
          {(pub.about_card_title || pub.about_card_body) ? <article className="bf-organizing-card"><h3>{pub.about_card_title || "Organization"}</h3><p>{pub.about_card_body}</p></article> : null}
          {(pub.location_card_title || pub.location_card_body || pub.location) ? <article className="bf-organizing-card"><h3>{pub.location_card_title || "Location"}</h3><p>{pub.location_card_body || pub.location}</p></article> : null}
        </div>
      </section>
    ),
    join: (
      <section key="join" id="join" className="bf-organizing-section">
        <SectionLabel>Get involved</SectionLabel>
        <h2>{pub.join_title || "Organize with us"}</h2>
        {pub.join_intro ? <p className="bf-organizing-section-copy">{pub.join_intro}</p> : null}
        <Actions items={pub.get_involved_links} onAction={handleAction} />
      </section>
    ),
    membership: (
      <section key="membership" id="membership" className="bf-organizing-section">
        <SectionLabel>Membership</SectionLabel>
        <h2>{pub.membership_title || "Membership"}</h2>
        {pub.membership_intro ? <p className="bf-organizing-section-copy">{pub.membership_intro}</p> : null}
        <div className="bf-organizing-grid-2">
          {(pub.membership_details_title || pub.membership_details_body) ? <article className="bf-organizing-card"><h3>{pub.membership_details_title}</h3><p>{pub.membership_details_body}</p></article> : null}
          <ListCard title={pub.membership_includes_title} items={membershipItems} />
          <ListCard title={pub.membership_dues_title} items={duesItems} />
          {(pub.membership_cta_title || pub.membership_cta_body || pub.membership_url) ? (
            <article className="bf-organizing-card">
              {pub.membership_poster_url ? <img className="bf-organizing-hero-image" src={pub.membership_poster_url} alt="" /> : null}
              <h3>{pub.membership_cta_title || "Join"}</h3>
              {pub.membership_cta_body ? <p>{pub.membership_cta_body}</p> : null}
              {pub.membership_url ? <a className="bf-organizing-button primary" href={pub.membership_url} target="_blank" rel="noopener noreferrer">Join / learn more</a> : null}
            </article>
          ) : null}
        </div>
      </section>
    ),
    archive: (
      <section key="archive" id="archive" className="bf-organizing-section">
        <SectionLabel>History and archive</SectionLabel>
        <h2>{pub.archive_title || "History and archive"}</h2>
        {pub.archive_intro ? <p className="bf-organizing-section-copy">{pub.archive_intro}</p> : null}
        {archiveItems.length ? <div className="bf-organizing-grid-3">{archiveItems.map((item, index) => (
          <article className="bf-organizing-card bf-organizing-archive-item" key={`${item.title}-${index}`}>
            {item.image_url ? <img src={item.image_url} alt="" /> : null}
            {item.title ? <h3>{item.title}</h3> : null}
            {item.caption ? <p>{item.caption}</p> : null}
          </article>
        ))}</div> : null}
        {historyManifest ? <LaborHistoryArchive manifest={historyManifest} /> : null}
      </section>
    ),
    events: (
      <section key="events" id="events" className="bf-organizing-section">
        <SectionLabel>Activity</SectionLabel>
        <h2>{pub.events_title || "Meetings and events"}</h2>
        {pub.events_intro ? <p className="bf-organizing-section-copy">{pub.events_intro}</p> : null}
        {eventItems.length ? <ListCard title="Updates" items={eventItems} /> : null}
        {meetings.length ? <div className="bf-organizing-grid-2">{meetings.map((meeting) => (
          <article className="bf-organizing-card bf-organizing-meeting" key={meeting.id || meeting.title}>
            <div><h3>{meeting.title || "Meeting"}</h3><p>{meeting.location || ""}</p></div>
            {meeting.starts_at ? <div className="bf-organizing-kicker">{new Date(Number(meeting.starts_at)).toLocaleString()}</div> : null}
          </article>
        ))}</div> : null}
      </section>
    ),
    contact: (
      <section key="contact" id="contact" className="bf-organizing-section">
        <SectionLabel>Contact and members</SectionLabel>
        <h2>{pub.contact_title || "Get in touch"}</h2>
        {pub.contact_intro ? <p className="bf-organizing-section-copy">{pub.contact_intro}</p> : null}
        <div className="bf-organizing-grid-2">
          {(pub.contact_card_title || pub.contact_card_body) ? <article className="bf-organizing-card"><h3>{pub.contact_card_title || "Contact"}</h3><p>{pub.contact_card_body}</p><Actions items={pub.get_involved_links} onAction={handleAction} /></article> : null}
          <article className="bf-organizing-card"><h3>{pub.member_access_title || "Member access"}</h3><p>{pub.member_access_body || "Members can sign in to the private Organization Workspace."}</p><a className="bf-organizing-button" href={memberHref}>Member Sign In</a></article>
        </div>
      </section>
    ),
  };

  const defaultOrder = ["hero", "about", "join", "membership", "archive", "events", "contact"];
  const requestedOrder = Array.isArray(pub.section_order) && pub.section_order.length ? pub.section_order : defaultOrder;
  const orderedKeys = [...new Set([...requestedOrder, ...defaultOrder])].filter((key) => sections[key] && visible(pub, key));

  return (
    <div className="bf-organizing-site" style={{ "--org-accent": accent, fontFamily: pub.font_family && pub.font_family !== "system" ? pub.font_family : undefined }}>
      <header className="bf-organizing-header">
        <div className="bf-organizing-brand">
          {logo ? <img className="bf-organizing-logo" src={logo} alt="" /> : null}
          <div><div className="bf-organizing-kicker">{pub.branch_label || "Organization"}</div><div className="bf-organizing-name">{title}</div></div>
        </div>
        <nav className="bf-organizing-nav" aria-label="Public site">
          <SectionButton id="about">About</SectionButton>
          {visible(pub, "membership") ? <SectionButton id="membership">Membership</SectionButton> : null}
          {visible(pub, "archive") && archiveItems.length ? <SectionButton id="archive">History</SectionButton> : null}
          {historyManifest ? <SectionButton id="labor-history">Labor History</SectionButton> : null}
          {publication ? <a href={publication.url} target="_blank" rel="noopener noreferrer">{publication.publication_name || "Publication"}</a> : null}
          <a className="bf-organizing-signin" href={memberHref}>Member Sign In</a>
        </nav>
      </header>

      <main className="bf-organizing-main">{orderedKeys.map((key) => sections[key])}</main>

      <footer className="bf-organizing-footer">
        <div>{title}</div>
        <div>{pub.location || ""}</div>
      </footer>

      {activeModal ? (
        <div className="bf-organizing-modal-wrap" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeIntake();
        }}>
          <div className="bf-organizing-modal" role="dialog" aria-modal="true" aria-labelledby="bf-organizing-intake-title">
            <div className="bf-organizing-modal-head">
              <div>
                <div className="bf-organizing-kicker">{pub.branch_label || title}</div>
                <h2 id="bf-organizing-intake-title">{modalCopy.title}</h2>
                <p>{modalCopy.intro}</p>
              </div>
              <button type="button" className="bf-organizing-modal-close" onClick={closeIntake} disabled={intakeBusy} aria-label="Close form">×</button>
            </div>

            <form className="bf-organizing-form" onSubmit={submitIntake}>
              <label>
                <span>Your name</span>
                <input value={intakeName} onChange={(event) => setIntakeName(event.target.value)} autoComplete="name" required />
              </label>
              <label>
                <span>Email, phone, or other contact</span>
                <input value={intakeContact} onChange={(event) => setIntakeContact(event.target.value)} required />
              </label>
              <label>
                <span>{modalCopy.details}</span>
                <textarea rows={5} value={intakeDetails} onChange={(event) => setIntakeDetails(event.target.value)} required />
              </label>
              <label>
                <span>{modalCopy.extra}</span>
                <textarea rows={3} value={intakeExtra} onChange={(event) => setIntakeExtra(event.target.value)} />
              </label>
              <div className="bf-organizing-modal-actions">
                <button type="submit" className="bf-organizing-button primary" disabled={intakeBusy}>
                  {intakeBusy ? "Sending…" : modalCopy.submit}
                </button>
                <button type="button" className="bf-organizing-button" onClick={closeIntake} disabled={intakeBusy}>Cancel</button>
              </div>
              {intakeMessage ? <div className="bf-organizing-form-message" role="status">{intakeMessage}</div> : null}
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
