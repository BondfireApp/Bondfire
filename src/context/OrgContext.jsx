import React, { createContext, useContext, useState } from "react";

const OrgContext = createContext(null);

export function OrgProvider({ children }) {
  // default to demo org so UI renders even without backend
  const [orgId, setOrgId] = useState(localStorage.getItem("active_org") || "org-demo-a");
  const [orgName, setOrgName] = useState(orgId === "org-demo-a" ? "Harbor Mutual Aid" : "South Sound Free Fridge");
  const setOrg = (id, name) => {
    setOrgId(id);
    setOrgName(name || (id === "org-demo-a" ? "Harbor Mutual Aid" : "South Sound Free Fridge"));
    localStorage.setItem("active_org", id);
  };
  return <OrgContext.Provider value={{ orgId, orgName, setOrg }}>{children}</OrgContext.Provider>;
}

export const useOrg = () => useContext(OrgContext);
