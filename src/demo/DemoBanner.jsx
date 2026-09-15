import React from "react";
import { disableDemoMode, isDemoMode, resetDemo } from "./demoMode.js";
import { ensureDemoOrgList, resetDemoState } from "./demoStore.js";
import "./demo.css";

export default function DemoBanner() {
  const [active] = React.useState(() => isDemoMode());
  if (!active) return null;

  return (
    <div className="bf-demo-banner">
      <div className="bf-demo-banner-text">
        <strong>Demo Mode</strong>
        <span>Changes are saved only in this browser.</span>
      </div>
      <div className="bf-demo-banner-actions">
        <button className="btn" type="button" onClick={() => { resetDemo(); resetDemoState(); ensureDemoOrgList(); try { window.dispatchEvent(new Event("bf-auth-changed")); } catch {} window.location.reload(); }}>
          Reset Demo
        </button>
        <button className="btn" type="button" onClick={() => { try { window.dispatchEvent(new Event("bf-demo-tour-open")); } catch {} }}>
          Start Tour
        </button>
        <button className="btn-red" type="button" onClick={() => { disableDemoMode(); try { localStorage.removeItem("bf-demo-user"); } catch {} window.location.hash = "#/signin"; window.location.reload(); }}>
          Exit Demo
        </button>
      </div>
    </div>
  );
}
