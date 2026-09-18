import React from "react";
import AppShell from "./AppShell";
import App from "./App";
import CanonicalPrivateOriginGuard from "./components/CanonicalPrivateOriginGuard.jsx";
import "./reliability.css";

export default function AppRoot() {
  return (
    <>
      <CanonicalPrivateOriginGuard />
      <AppShell>
        <App />
      </AppShell>
    </>
  );
}
