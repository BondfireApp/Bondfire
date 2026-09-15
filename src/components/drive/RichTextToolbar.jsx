import React from "react";

function Btn({ children, onClick, title }) {
  if (!onClick) return null;
  return <button className="btn" type="button" onClick={onClick} title={title} style={{ padding: "3px 7px", fontSize: 11, lineHeight: 1 }}>{children}</button>;
}

export default function RichTextToolbar({ onBold, onItalic, onH1, onH2, onBullet, onQuote, onCode, onRule, onLink, onWikiLink, menuOpen = false, onToggleMenu, menuItems = [] }) {
  const hasFormatting = !!(onBold || onItalic || onH1 || onH2 || onBullet || onQuote || onCode || onRule || onLink || onWikiLink);
  return (
    <div style={{ position: "relative", marginBottom: 6 }}>
      <div className="card" style={{ padding: 5, display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
        {hasFormatting ? <>
          <Btn onClick={onBold} title="Bold">B</Btn>
          <Btn onClick={onItalic} title="Italic"><i>I</i></Btn>
          <Btn onClick={onH1} title="Heading 1">H1</Btn>
          <Btn onClick={onH2} title="Heading 2">H2</Btn>
          <Btn onClick={onBullet} title="Bullet list">•</Btn>
          <Btn onClick={onQuote} title="Quote">❝</Btn>
          <Btn onClick={onCode} title="Inline code">{`</>`}</Btn>
          <Btn onClick={onLink} title="Link">Link</Btn>
          <Btn onClick={onWikiLink} title="Wiki link">[[ ]]</Btn>
          <Btn onClick={onRule} title="Horizontal rule">—</Btn>
        </> : <div className="helper">Document actions</div>}
        <button className="btn" type="button" onClick={onToggleMenu} title="View and document menu" style={{ marginLeft: "auto", padding: "3px 10px", fontSize: 14 }}>☰</button>
      </div>
      {menuOpen ? <div style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", minWidth: 220, background: "rgba(16,16,20,0.98)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: 6, boxShadow: "0 14px 36px rgba(0,0,0,0.45)", zIndex: 130, display: "grid", gap: 4 }}>
        {menuItems.map((item, idx) => <button key={`${item.label}-${idx}`} className="btn" type="button" onClick={item.onClick} style={{ textAlign: "left", justifyContent: "flex-start", padding: "7px 10px" }}>{item.label}</button>)}
      </div> : null}
    </div>
  );
}
