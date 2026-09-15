// src/pages/MeetingDetail.jsx
import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../utils/api.js";

function getOrgId() {
  try {
    const m = (window.location.hash || "").match(/#\/org\/([^/]+)/);
    return m && m[1] ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

function toLocalDateTimeInput(valueMs) {
  if (!valueMs) return "";
  const d = new Date(Number(valueMs));
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  // datetime-local wants local time without seconds
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalDateTimeInput(s) {
  if (!s) return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

export default function MeetingDetail() {
  const nav = useNavigate();
  const { meetingId, orgId: orgIdParam } = useParams();
  const orgId = orgIdParam || getOrgId();

  const [m, setM] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const [myRsvp, setMyRsvp] = useState(null);
  const [rsvpCounts, setRsvpCounts] = useState({ combined: { yes: 0, maybe: 0, no: 0, total: 0 }, member: { yes: 0, maybe: 0, no: 0, total: 0 }, public: { yes: 0, maybe: 0, no: 0, total: 0 } });
  const [privateMode, setPrivateMode] = useState(false);
  const [rsvpBusy, setRsvpBusy] = useState(false);
  const [rsvpMsg, setRsvpMsg] = useState("");

  async function refresh() {
    if (!orgId || !meetingId) return;
    const bust = `ts=${Date.now()}`;
    const data = await api(`/api/orgs/${encodeURIComponent(orgId)}/meetings/${encodeURIComponent(meetingId)}?${bust}`);
    setM(data.meeting || null);
    setPrivateMode(!!data.private_mode);
    if(data.private_mode)return;
    setRsvpCounts(data?.meeting?.rsvp_counts || { combined: { yes: 0, maybe: 0, no: 0, total: 0 }, member: { yes: 0, maybe: 0, no: 0, total: 0 }, public: { yes: 0, maybe: 0, no: 0, total: 0 } });

    // Load current user's RSVP (members can read their own RSVP; admins can read lists).
    try {
      const r = await api(
        `/api/orgs/${encodeURIComponent(orgId)}/meetings/${encodeURIComponent(meetingId)}/rsvp?ts=${Date.now()}`
      );
      if (r && Object.prototype.hasOwnProperty.call(r, "my_rsvp")) setMyRsvp(r.my_rsvp);
      else if (r && Object.prototype.hasOwnProperty.call(r, "my_rsvp")) setMyRsvp(r.my_rsvp);
      else if (r && Object.prototype.hasOwnProperty.call(r, "rsvp")) setMyRsvp(r.rsvp);
      else setMyRsvp(null);
    } catch {
      setMyRsvp(null);
    }
  }

  useEffect(() => {
    refresh().catch((e) => setErr(e?.message || String(e)));
  }, [orgId, meetingId]);

  async function save(patch) {
    if (!orgId || !meetingId) return;
    setBusy(true);
    setErr("");
    try {
      await api(`/api/orgs/${encodeURIComponent(orgId)}/meetings/${encodeURIComponent(meetingId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      await refresh();
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function del() {
    if (!orgId || !meetingId) return;
    if (!confirm("Delete this meeting?")) return;
    setBusy(true);
    setErr("");
    try {
      await api(`/api/orgs/${encodeURIComponent(orgId)}/meetings/${encodeURIComponent(meetingId)}`, {
        method: "DELETE",
      });
      nav(`/org/${encodeURIComponent(orgId)}/meetings`, { replace: true });
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!orgId) return <div style={{ padding: 16 }}>No org selected.</div>;
  if (!m) return <div style={{ padding: 16 }}>{err ? `Error: ${err}` : "Loading..."}</div>;

  async function setRsvp(status) {
    if (!orgId || !meetingId) return;
    setRsvpMsg("");
    setRsvpBusy(true);
    try {
      const note = myRsvp?.note || "";
      await api(`/api/orgs/${encodeURIComponent(orgId)}/meetings/${encodeURIComponent(meetingId)}/rsvp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, note }),
      });
      setRsvpMsg("Saved.");
      await refresh();
      setTimeout(() => setRsvpMsg(""), 900);
    } catch (e) {
      setRsvpMsg(e?.message || "RSVP failed");
    } finally {
      setRsvpBusy(false);
    }
  }

  return (
    <div className="card" style={{ margin: 16, padding: 12 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <h2 className="section-title" style={{ margin: 0, flex: 1 }}>
          Meeting
        </h2>
        <button className="btn" onClick={() => nav(-1)} disabled={busy}>
          Back
        </button>
        <button className="btn" onClick={del} disabled={busy}>
          Delete
        </button>
      </div>

      {err && (
        <div className="helper" style={{ color: "tomato", marginTop: 8 }}>
          {err}
        </div>
      )}

      <div className="grid" style={{ gap: 10, marginTop: 12 }}>
        {privateMode ? <p>Meeting details are encrypted. RSVP collection is not available in member-only mode yet.</p> : <>
        <div className="card" style={{ padding: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontWeight: 800 }}>RSVP Summary</div>
            <div className="helper">{Number(rsvpCounts?.combined?.total || 0)} total responses</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8, marginTop: 10 }}>
            <div className="card" style={{ padding: 10 }}>
              <div className="helper">Yes</div>
              <div style={{ fontWeight: 900, fontSize: 24 }}>{Number(rsvpCounts?.combined?.yes || 0)}</div>
            </div>
            <div className="card" style={{ padding: 10 }}>
              <div className="helper">Maybe</div>
              <div style={{ fontWeight: 900, fontSize: 24 }}>{Number(rsvpCounts?.combined?.maybe || 0)}</div>
            </div>
            <div className="card" style={{ padding: 10 }}>
              <div className="helper">No</div>
              <div style={{ fontWeight: 900, fontSize: 24 }}>{Number(rsvpCounts?.combined?.no || 0)}</div>
            </div>
            <div className="card" style={{ padding: 10 }}>
              <div className="helper">Public RSVPs</div>
              <div style={{ fontWeight: 900, fontSize: 24 }}>{Number(rsvpCounts?.public?.total || 0)}</div>
            </div>
          </div>
        </div>

        <div className="card" style={{ padding: 12 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ fontWeight: 800 }}>Your RSVP</div>
            <div className="helper" style={{ opacity: 0.9 }}>
              {myRsvp?.status ? String(myRsvp.status) : "none"}
            </div>
            <div style={{ flex: 1 }} />
            {rsvpMsg ? (
              <div className={String(rsvpMsg).toLowerCase().includes("fail") ? "error" : "helper"}>{rsvpMsg}</div>
            ) : null}
          </div>
          <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <button className="btn" type="button" onClick={() => setRsvp("yes")} disabled={busy || rsvpBusy}>
              Yes
            </button>
            <button className="btn" type="button" onClick={() => setRsvp("maybe")} disabled={busy || rsvpBusy}>
              Maybe
            </button>
            <button className="btn" type="button" onClick={() => setRsvp("no")} disabled={busy || rsvpBusy}>
              No
            </button>
          </div>
        </div>
        </>}

        <input
          className="input"
          defaultValue={m.title || ""}
          placeholder="Title"
          onBlur={(e) => {
            const v = e.target.value || "";
            if (v !== (m.title || "")) save({ title: v }).catch(console.error);
          }}
        />

        <div className="grid cols-2" style={{ gap: 10 }}>
          <div>
            <div className="helper">Start</div>
            <input
              className="input"
              type="datetime-local"
              defaultValue={toLocalDateTimeInput(m.starts_at)}
              onBlur={(e) => {
                const ms = fromLocalDateTimeInput(e.target.value);
                if (ms !== (m.starts_at ?? null)) save({ starts_at: ms }).catch(console.error);
              }}
            />
          </div>
          <div>
            <div className="helper">End</div>
            <input
              className="input"
              type="datetime-local"
              defaultValue={toLocalDateTimeInput(m.ends_at)}
              onBlur={(e) => {
                const ms = fromLocalDateTimeInput(e.target.value);
                if (ms !== (m.ends_at ?? null)) save({ ends_at: ms }).catch(console.error);
              }}
            />
          </div>
        </div>

        <input
          className="input"
          defaultValue={m.location || ""}
          placeholder="Location"
          onBlur={(e) => {
            const v = e.target.value || "";
            if (v !== (m.location || "")) save({ location: v }).catch(console.error);
          }}
        />

        <label className="row" style={{ gap: 8, alignItems: "center" }}>
          <input
            type="checkbox"
            defaultChecked={!!m.is_public}
            onChange={(e) => save({ is_public: e.target.checked }).catch(console.error)}
          />
          <span>Public (show on public page)</span>
        </label>

        <textarea
          className="textarea"
          defaultValue={m.agenda || ""}
          placeholder="Agenda"
          rows={4}
          onBlur={(e) => {
            const v = e.target.value || "";
            if (v !== (m.agenda || "")) save({ agenda: v }).catch(console.error);
          }}
        />

        <textarea
          className="textarea"
          defaultValue={m.notes || ""}
          placeholder="Notes"
          rows={6}
          onBlur={(e) => {
            const v = e.target.value || "";
            if (v !== (m.notes || "")) save({ notes: v }).catch(console.error);
          }}
        />
      </div>
    </div>
  );
}
