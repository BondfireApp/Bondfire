import React from "react";

export default function Breadcrumbs({ folders, currentFolder, setCurrentFolder }) {
  const path = [];
  let current = currentFolder;
  while (current) {
    const found = folders.find((f) => f.id === current);
    if (!found) break;
    path.unshift(found);
    current = found.parentId;
  }

  return (
    <div style={{ marginBottom: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>
      <span style={{ cursor: "pointer" }} onClick={() => setCurrentFolder(null)}>Root</span>
      {path.map((f) => (
        <span key={f.id}>
          {" / "}
          <span style={{ cursor: "pointer" }} onClick={() => setCurrentFolder(f.id)}>
            {f.name}
          </span>
        </span>
      ))}
    </div>
  );
}
