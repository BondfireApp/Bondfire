import React from "react";
import { Link, Route, Routes } from "react-router-dom";
import PublicPage from "./PublicPage.jsx";

const actionStyle = {
  display: "grid",
  minHeight: 180,
  padding: 22,
  border: "1px solid var(--bf-v3-line)",
  borderRadius: "var(--bf-v3-radius)",
  background: "var(--bf-v3-panel)",
  color: "var(--bf-v3-cream)",
  textDecoration: "none",
  alignContent: "space-between",
  gap: 28,
};

const numberStyle = {
  color: "var(--bf-v3-ember)",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: ".14em",
};

const titleStyle = {
  margin: 0,
  fontFamily: '"Arial Narrow", "Roboto Condensed", "Helvetica Neue", Arial, sans-serif',
  fontSize: "clamp(28px, 4vw, 46px)",
  fontWeight: 900,
  letterSpacing: "-.055em",
  lineHeight: 0.95,
};

const sectionStyle = {
  marginTop: 44,
  paddingTop: 30,
  borderTop: "1px solid var(--bf-v3-line)",
};

const infoCardStyle = {
  padding: 20,
  border: "1px solid var(--bf-v3-line)",
  borderRadius: "var(--bf-v3-radius)",
  background: "rgba(255,255,255,.025)",
};

const publicLinkStyle = {
  color: "var(--bf-v3-cream)",
  textDecoration: "underline",
  textUnderlineOffset: 4,
};

export default function PublicStart() {
  const [domainState, setDomainState] = React.useState({ checking: true, mappedSlug: "", publication: false });

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const response = await fetch("/api/public/domain", { headers: { Accept: "application/json" } });
        const data = await response.json().catch(() => ({}));
        if (!alive) return;

        if (response.ok && data?.mapped && data?.surface === "organization" && data?.slug) {
          setDomainState({ checking: false, mappedSlug: String(data.slug), publication: false });
          return;
        }

        if (response.ok && data?.mapped && data?.surface === "publication" && data?.publicationUrl) {
          try {
            const target = new URL(data.publicationUrl, window.location.origin);
            if (target.hostname !== window.location.hostname || target.pathname !== window.location.pathname) {
              window.location.replace(target.toString());
              return;
            }
          } catch {}
          setDomainState({ checking: false, mappedSlug: "", publication: true });
          return;
        }
      } catch {}

      if (alive) setDomainState({ checking: false, mappedSlug: "", publication: false });
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (domainState.checking) {
    return <div style={{ padding: 24 }} className="helper">Loading site…</div>;
  }

  if (domainState.mappedSlug) {
    const routedLocation = `/p/${encodeURIComponent(domainState.mappedSlug)}`;
    return (
      <Routes location={routedLocation}>
        <Route path="/p/:slug" element={<PublicPage />} />
      </Routes>
    );
  }

  if (domainState.publication) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Publication Site</h1>
        <p className="helper">This publication domain is connected, but its public publication route is not available at this URL yet.</p>
      </div>
    );
  }

  return (
    <div className="bf-build-page">
      <header className="bf-build-hero">
        <div>
          <p className="bf-build-eyebrow">BONDFIRE // ZERO-KNOWLEDGE COORDINATION</p>
          <h1>Coordination infrastructure that doesn&apos;t need to know your business.</h1>
          <p className="bf-build-lede">
            Bondfire is modular infrastructure for groups doing things together. Private organization content is encrypted on your device before it is persisted, so the server stores ciphertext instead of readable copies of your private work.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 20 }}>
            <Link to="/build" className="btn-red">Get started</Link>
            <a href="/zero-knowledge/" className="btn">How zero-knowledge works</a>
          </div>
        </div>
        <div className="bf-build-counter" aria-hidden="true">
          <span>PRIVATE BY</span>
          <strong>ZK</strong>
          <small>design</small>
        </div>
      </header>

      <main
        style={{
          width: "min(1180px, calc(100% - 32px))",
          margin: "0 auto",
          padding: "clamp(28px, 5vw, 64px) 0 72px",
        }}
      >
        <section aria-labelledby="entry-heading">
          <div style={{ display: "flex", gap: 12, justifyContent: "space-between", alignItems: "end", flexWrap: "wrap", marginBottom: 16 }}>
            <div>
              <p className="bf-build-label" style={{ margin: "0 0 8px" }}>ENTER BONDFIRE</p>
              <h2 id="entry-heading" style={{ ...titleStyle, fontSize: "clamp(28px, 4vw, 42px)" }}>What do you need to do?</h2>
            </div>
            <span className="helper">Three clear paths. No scavenger hunt required.</span>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))",
              gap: 14,
            }}
            aria-label="Bondfire entry choices"
          >
            <Link to="/signin?mode=login" style={actionStyle}>
              <span style={numberStyle}>01 // ACCOUNT</span>
              <div>
                <h3 style={titleStyle}>SIGN IN</h3>
                <p className="helper" style={{ margin: "14px 0 0", maxWidth: 360 }}>
                  Open the organizations and workspaces you already belong to.
                </p>
              </div>
            </Link>

            <Link
              to="/capture"
              style={{
                ...actionStyle,
                borderColor: "var(--bf-v3-ember)",
                background: "rgba(255, 91, 69, .075)",
              }}
            >
              <span style={numberStyle}>02 // IMMEDIATE</span>
              <div>
                <h3 style={titleStyle}>REC</h3>
                <p className="helper" style={{ margin: "14px 0 0", maxWidth: 360 }}>
                  Start encrypted capture without creating an account first.
                </p>
              </div>
            </Link>

            <Link to="/build" style={actionStyle}>
              <span style={numberStyle}>03 // NEW SPACE</span>
              <div>
                <h3 style={titleStyle}>BUILD A NEW INSTANCE</h3>
                <p className="helper" style={{ margin: "14px 0 0", maxWidth: 360 }}>
                  Choose the modules first. Bondfire asks for the owning account when the build is ready.
                </p>
              </div>
            </Link>
          </div>
        </section>

        <section style={sectionStyle} aria-labelledby="zk-heading">
          <p className="bf-build-label" style={{ margin: "0 0 8px" }}>ZERO-KNOWLEDGE BY DESIGN</p>
          <h2 id="zk-heading" style={{ ...titleStyle, fontSize: "clamp(30px, 4.5vw, 50px)", maxWidth: 780 }}>
            The server should know as little as possible about your group&apos;s private work.
          </h2>
          <p className="helper" style={{ maxWidth: 800, margin: "18px 0 24px", fontSize: 16, lineHeight: 1.65 }}>
            Bondfire encrypts private organization content on the client before persistence. Authorized members decrypt the information they have permission to access. The infrastructure storing that content does not need a readable copy.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 230px), 1fr))", gap: 12 }}>
            <div style={infoCardStyle}>
              <span style={numberStyle}>01 // CREATE</span>
              <h3 style={{ margin: "12px 0 8px" }}>You create it</h3>
              <p className="helper" style={{ margin: 0, lineHeight: 1.6 }}>Private organization information begins inside your workspace.</p>
            </div>
            <div style={infoCardStyle}>
              <span style={numberStyle}>02 // ENCRYPT</span>
              <h3 style={{ margin: "12px 0 8px" }}>Your device encrypts it</h3>
              <p className="helper" style={{ margin: 0, lineHeight: 1.6 }}>Private content is encrypted client-side before it is persisted.</p>
            </div>
            <div style={infoCardStyle}>
              <span style={numberStyle}>03 // STORE</span>
              <h3 style={{ margin: "12px 0 8px" }}>Bondfire stores ciphertext</h3>
              <p className="helper" style={{ margin: 0, lineHeight: 1.6 }}>Authorized clients decrypt private content when members need to use it.</p>
            </div>
          </div>

          <div style={{ ...infoCardStyle, marginTop: 12, borderColor: "rgba(255,91,69,.4)" }}>
            <strong>Public means public.</strong>
            <p className="helper" style={{ margin: "7px 0 0", lineHeight: 1.6 }}>
              Information a group deliberately publishes through an Organization Page, Publication Site, public event, or other public surface is intentionally readable and is handled separately from private organization data.
            </p>
          </div>

          <p style={{ margin: "18px 0 0" }}>
            <a href="/zero-knowledge/" style={publicLinkStyle}>Read the plain-language zero-knowledge explanation →</a>
          </p>
        </section>

        <section style={sectionStyle} aria-labelledby="purpose-heading">
          <p className="bf-build-label" style={{ margin: "0 0 8px" }}>WHAT BONDFIRE IS FOR</p>
          <h2 id="purpose-heading" style={{ ...titleStyle, fontSize: "clamp(30px, 4.5vw, 50px)", maxWidth: 760 }}>
            Organize without assembling six different platforms.
          </h2>
          <p className="helper" style={{ maxWidth: 800, margin: "18px 0 24px", fontSize: 16, lineHeight: 1.65 }}>
            Bondfire gives mutual-aid networks, community organizations, collectives, gatherings, projects, and other groups one modular workspace. Enable the tools your organization needs and leave the rest off.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: 12 }}>
            {[
              ["PRIVATE BY DEFAULT", "Private organization content is encrypted rather than treated as platform-readable data."],
              ["MODULAR", "Use the coordination tools your group actually needs instead of adopting one giant mandatory stack."],
              ["HOSTED OR SELF-HOSTED", "Use the hosted Bondfire service or run the software independently."],
              ["NO DATA-PRODUCT MODEL", "Bondfire is built for coordination, not for turning organization activity into an advertising profile."],
            ].map(([label, copy]) => (
              <div key={label} style={infoCardStyle}>
                <span style={numberStyle}>{label}</span>
                <p className="helper" style={{ margin: "12px 0 0", lineHeight: 1.6 }}>{copy}</p>
              </div>
            ))}
          </div>
        </section>

        <footer
          style={{
            ...sectionStyle,
            display: "flex",
            gap: 16,
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <span className="helper">Bondfire // private infrastructure for people doing things together.</span>
          <nav aria-label="Public information" style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <a href="/about/" style={publicLinkStyle}>About</a>
            <a href="/zero-knowledge/" style={publicLinkStyle}>Zero-Knowledge</a>
            <a href="https://github.com/BondfireApp/Bondfire" style={publicLinkStyle}>Source Code</a>
          </nav>
        </footer>
      </main>
    </div>
  );
}
