import React, { useEffect, useState } from "react";
export default function HelpFab({ pulseKey, isOpen, onToggle, contentTitle = "Help", children }) {
  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    setPulse(true);
    const t = setTimeout(() => setPulse(false), 2600);
    return () => clearTimeout(t);
  }, [pulseKey]);
  return (<>
    <style>{`@keyframes bfHelpPulse {0% { transform: scale(1); box-shadow: 0 10px 28px rgba(0,0,0,0.45); opacity: 0.92; }35% { transform: scale(1.08); box-shadow: 0 0 0 10px rgba(120,60,220,0.12), 0 10px 34px rgba(0,0,0,0.5); opacity: 1; }100% { transform: scale(1); box-shadow: 0 10px 28px rgba(0,0,0,0.45); opacity: 0.92; }}`}</style>
    <button type="button" onClick={onToggle} title="Help" style={{ position: "fixed", right: 18, bottom: 18, width: 58, height: 58, borderRadius: 999, border: "1px solid rgba(255,255,255,0.12)", background: "linear-gradient(180deg, rgba(120,60,220,0.95), rgba(70,25,150,0.95))", color: "#fff", fontSize: 28, fontWeight: 800, boxShadow: "0 10px 30px rgba(0,0,0,0.45)", zIndex: 120, cursor: "pointer", animation: pulse ? "bfHelpPulse 1.2s ease 2" : "none", opacity: 0.96 }}>?</button>
    {isOpen ? <div style={{ position: "fixed", right: 18, bottom: 86, width: 360, maxHeight: "70vh", overflow: "auto", background: "rgba(16,16,20,0.98)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 18, padding: 14, boxShadow: "0 14px 40px rgba(0,0,0,0.45)", zIndex: 121 }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8 }}><strong>{contentTitle}</strong><button className="btn" type="button" onClick={onToggle}>Close</button></div>{children}</div> : null}
  </>);
}
