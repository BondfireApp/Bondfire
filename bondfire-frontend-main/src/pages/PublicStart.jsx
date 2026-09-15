import React from "react";
import { Link } from "react-router-dom";

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

export default function PublicStart() {
  return (
    <div className="bf-build-page">
      <header className="bf-build-hero">
        <div>
          <p className="bf-build-eyebrow">BONDFIRE // V3</p>
          <h1>What do you need to do?</h1>
          <p className="bf-build-lede">
            Enter an existing Bondfire, record something now, or build a new space around the work.
          </p>
        </div>
        <div className="bf-build-counter" aria-hidden="true">
          <span>ENTRY</span>
          <strong>03</strong>
          <small>clear paths</small>
        </div>
      </header>

      <main
        style={{
          width: "min(1180px, calc(100% - 32px))",
          margin: "0 auto",
          padding: "clamp(28px, 5vw, 64px) 0 72px",
        }}
      >
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
              <h2 style={titleStyle}>SIGN IN</h2>
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
              <h2 style={titleStyle}>REC</h2>
              <p className="helper" style={{ margin: "14px 0 0", maxWidth: 360 }}>
                Start encrypted capture without creating an account first.
              </p>
            </div>
          </Link>

          <Link to="/build" style={actionStyle}>
            <span style={numberStyle}>03 // NEW SPACE</span>
            <div>
              <h2 style={titleStyle}>BUILD A NEW INSTANCE</h2>
              <p className="helper" style={{ margin: "14px 0 0", maxWidth: 360 }}>
                Choose the modules first. Bondfire asks for the owning account when the build is ready.
              </p>
            </div>
          </Link>
        </div>

        <div
          style={{
            marginTop: 28,
            paddingTop: 18,
            borderTop: "1px solid var(--bf-v3-line)",
            display: "flex",
            gap: 12,
            justifyContent: "space-between",
            flexWrap: "wrap",
          }}
        >
          <span className="bf-build-label">NO ACCOUNT REQUIRED FOR REC</span>
          <span className="helper">Capture first. Identity can come later.</span>
        </div>
      </main>
    </div>
  );
}
