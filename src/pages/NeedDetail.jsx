// src/pages/NeedDetail.jsx
import React, { useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useStore, updateNeed, deleteNeed } from "../utils/store.js";

export default function NeedDetail() {
  const { orgId, needId } = useParams();
  const navigate = useNavigate();

  // pull from store
  const needs = useStore((s) => s.needs || []);
  const need = useMemo(() => needs.find((n) => n.id === needId) || null, [needs, needId]);

  if (!need) {
    return (
      <div className="card" style={{ margin: 16 }}>
        <div className="row" style={{ marginBottom: 8 }}>
          <Link className="btn" to={`/org/${orgId}/needs`}>Back</Link>
        </div>
        <div className="helper">Need not found.</div>
      </div>
    );
  }

  const onDelete = () => {
    deleteNeed(need.id);
    navigate(`/org/${orgId}/needs`);
  };

  return (
    <div className="card" style={{ margin: 16 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Link className="btn" to={`/org/${orgId}/needs`}>Back</Link>
          <h2 className="section-title" style={{ margin: 0 }}>Need Detail</h2>
        </div>
        <button className="btn" onClick={onDelete}>Delete</button>
      </div>

      <div className="grid cols-2" style={{ gap: 12 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <div className="helper">Title</div>
          <input
            className="input"
            defaultValue={need.title}
            onBlur={(e) => updateNeed(need.id, { title: e.target.value })}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <div className="helper">Urgency</div>
          <input
            className="input"
            defaultValue={need.urgency || ""}
            onBlur={(e) => updateNeed(need.id, { urgency: e.target.value })}
          />
        </label>

        <label style={{ gridColumn: "1 / -1", display: "grid", gap: 6 }}>
          <div className="helper">Description</div>
          <textarea
            className="input"
            rows={6}
            defaultValue={need.description || ""}
            onBlur={(e) => updateNeed(need.id, { description: e.target.value })}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <div className="helper">Status</div>
          <select
            className="input"
            defaultValue={need.status || "open"}
            onChange={(e) => updateNeed(need.id, { status: e.target.value })}
          >
            <option value="open">open</option>
            <option value="in-progress">in-progress</option>
            <option value="resolved">resolved</option>
          </select>
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            defaultChecked={!!need.public}
            onChange={(e) => updateNeed(need.id, { public: e.target.checked })}
          />
          Public
        </label>

        <div className="helper" style={{ gridColumn: "1 / -1" }}>
          Created: {need.created ? new Date(need.created).toLocaleString() : "—"}
        </div>
      </div>
    </div>
  );
}
