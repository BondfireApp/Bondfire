import React, { createContext, useContext, useState } from "react";

const AuthContext = createContext(null);
const DEFAULT_USER = { id: "demo-user", name: "Demo", role: "admin" }; // roles: admin | staff | volunteer

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem("demo_user")) || DEFAULT_USER; } catch { return DEFAULT_USER; }
  });
  const setRole = (role) => {
    const next = { ...user, role };
    setUser(next);
    localStorage.setItem("demo_user", JSON.stringify(next));
  };
  return <AuthContext.Provider value={{ user, setRole }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

export function Protected({ roles, children }) {
  const { user } = useAuth();
  if (!roles || roles.includes(user.role)) return children;
  return <div className="p-4 text-red-600">Access denied for role: {user.role}</div>;
}
