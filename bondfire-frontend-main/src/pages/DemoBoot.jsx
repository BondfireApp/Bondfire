import React from "react";
import { Navigate } from "react-router-dom";
import { enableDemoMode } from "../demo/demoMode.js";
import { ensureDemoOrgList, resetDemoState } from "../demo/demoStore.js";

export default function DemoBoot() {
  React.useEffect(() => {
    enableDemoMode();
    resetDemoState();
    ensureDemoOrgList();
    try { localStorage.setItem("bf-demo-user", JSON.stringify({ id: "demo", name: "Demo User", email: "demo@bondfire.local", demo: true })); } catch {}
    try { window.dispatchEvent(new Event("bf-auth-changed")); setTimeout(() => window.dispatchEvent(new Event("bf-demo-tour-open")), 150); } catch {}
  }, []);
  return <Navigate to="/orgs" replace />;
}
