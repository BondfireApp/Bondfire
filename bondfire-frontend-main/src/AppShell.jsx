import React from "react";
import { OrgProvider } from "./context/OrgContext";
import { AuthProvider } from "./context/AuthContext";
import AppHeader from "./components/AppHeader";

export default function AppShell({ children }) {
  return (
    <AuthProvider>
      <OrgProvider>
        <div className="min-h-screen">
          <AppHeader />
          <main className="max-w-7xl mx-auto pt-24 pb-16 px-4">
            {children}
          </main>
        </div>
      </OrgProvider>
    </AuthProvider>
  );
}
