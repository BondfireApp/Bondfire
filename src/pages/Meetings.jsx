import React, { useEffect, useMemo, useState } from "react";
import { api } from "../utils/api.js";
import { decryptWithOrgKey, encryptWithOrgKey, getCachedOrgKey } from "../lib/zk.js";

function getOrgId() {
	try {
		const m = (window.location.hash || "").match(/#\/org\/([^/]+)/);
		return m && m[1] ? decodeURIComponent(m[1]) : null;
	} catch {
		return null;
	}
}

function fromInputDT(value) {
	if (!value) return null;
	const ms = Date.parse(value);
	return Number.isFinite(ms) ? ms : null;
}

function formatDT(ms) {
	if (!ms) return "";
	const d = new Date(Number(ms));
	return d.toLocaleString(undefined, {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function safeStr(v) {
	return String(v ?? "");
}

export default function Meetings() {
	const orgId = getOrgId();

	const [items, setItems] = useState([]);
	const [q, setQ] = useState("");
	const [loading, setLoading] = useState(false);
	const [err, setErr] = useState("");
	const [busyZk, setBusyZk] = useState(false);
	const [zkMsg, setZkMsg] = useState("");

	const [edit, setEdit] = useState(null);

	const [myRsvp, setMyRsvp] = useState(null);
	const [rsvpBusy, setRsvpBusy] = useState(false);
	const [rsvpCounts, setRsvpCounts] = useState({
		member: { yes: 0, maybe: 0, no: 0, total: 0 },
		public: { yes: 0, maybe: 0, no: 0, total: 0 },
		combined: { yes: 0, maybe: 0, no: 0, total: 0 },
	});

	// Controlled add form so it clears reliably
	const [form, setForm] = useState({
		title: "",
		starts_at: "",
		ends_at: "",
		location: "",
		agenda: "",
		is_public: false,
	});

	async function refresh() {
		if (!orgId) return;
		setLoading(true);
		setErr("");
		try {
			const data = await api(`/api/orgs/${encodeURIComponent(orgId)}/meetings`);
			const raw = Array.isArray(data.meetings) ? data.meetings : [];

			const orgKey = getCachedOrgKey(orgId);
			if (orgKey) {
				const out = [];
				for (const m of raw) {
					if (m?.encrypted_blob) {
						try {
							const dec = JSON.parse(await decryptWithOrgKey(orgKey, m.encrypted_blob));
							out.push({ ...m, ...dec });
							continue;
						} catch {
							out.push({ ...m, title: "(encrypted)", location: "", agenda: "" });
							continue;
						}
					}
					out.push(m);
				}
				setItems(out);
			} else {
				setItems(raw);
			}
		} catch (e) {
			console.error(e);
			setErr(e?.message || String(e));
		} finally {
			setLoading(false);
		}
	}

	useEffect(() => {
		refresh().catch(console.error);
	}, [orgId]);

	const filtered = useMemo(() => {
		const needle = q.toLowerCase();
		return items.filter((m) =>
			[safeStr(m.title), safeStr(m.location), safeStr(m.agenda)]
				.join(" ")
				.toLowerCase()
				.includes(needle)
		);
	}, [items, q]);

	async function onAdd(e) {
		e.preventDefault();
		if (!orgId) return;
		setErr("");

		const title = safeStr(form.title).trim();
		if (!title) return;

		const starts_at = fromInputDT(form.starts_at);
		const ends_at = fromInputDT(form.ends_at);
		const location = safeStr(form.location).trim();
		const agenda = safeStr(form.agenda).trim();
		const is_public = !!form.is_public;

		const orgKey = getCachedOrgKey(orgId);
		let payload = { title, starts_at, ends_at, location, agenda, is_public };
		if (orgKey && !is_public) {
			const enc = await encryptWithOrgKey(orgKey, JSON.stringify({ title, location, agenda }));
			payload = {
				title: "__encrypted__",
				location: "",
				agenda: "",
				starts_at,
				ends_at,
				is_public,
				encrypted_blob: enc,
			};
		}

		await api(`/api/orgs/${encodeURIComponent(orgId)}/meetings`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});

		setForm({ title: "", starts_at: "", ends_at: "", location: "", agenda: "", is_public: false });
		setTimeout(() => refresh().catch(console.error), 300);
	}

	async function encryptExisting() {
		if (!orgId) return;
		setZkMsg("");
		setErr("");
		const orgKey = getCachedOrgKey(orgId);
		if (!orgKey) {
			setErr("ZK is enabled, but this device does not have the org key loaded yet.");
			return;
		}
		setBusyZk(true);
		try {
			const data = await api(`/api/orgs/${encodeURIComponent(orgId)}/meetings`);
			const raw = Array.isArray(data.meetings) ? data.meetings : [];
			let changed = 0;
			for (const m of raw) {
				if (!m?.id) continue;
				if (m?.encrypted_blob) continue;
				if (!!m.is_public) continue;
				if (String(m.title || "") === "__encrypted__") continue;
				const next = {
					title: safeStr(m.title).trim(),
					location: safeStr(m.location).trim(),
					agenda: safeStr(m.agenda).trim(),
				};
				const enc = await encryptWithOrgKey(orgKey, JSON.stringify(next));
				await api(`/api/orgs/${encodeURIComponent(orgId)}/meetings`, {
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						id: m.id,
						title: "__encrypted__",
						location: "",
						agenda: "",
						starts_at: m.starts_at ?? null,
						ends_at: m.ends_at ?? null,
						is_public: 0,
						encrypted_blob: enc,
					}),
				});
				changed++;
			}
			setZkMsg(changed ? `Encrypted ${changed} existing meeting records on the server.` : "Nothing to encrypt. (Everything already looks encrypted or public.)");
			await refresh();
		} catch (e) {
			console.error(e);
			setErr(e?.message || String(e));
		} finally {
			setBusyZk(false);
		}
	}

	async function loadMeetingDetail(meetingId) {
		if (!orgId || !meetingId) return null;
		try {
			const data = await api(`/api/orgs/${encodeURIComponent(orgId)}/meetings/${encodeURIComponent(meetingId)}?_=${Date.now()}`);
			const meeting = data?.meeting || null;
			setRsvpCounts(meeting?.rsvp_counts || {
				member: { yes: 0, maybe: 0, no: 0, total: 0 },
				public: { yes: 0, maybe: 0, no: 0, total: 0 },
				combined: { yes: 0, maybe: 0, no: 0, total: 0 },
			});
			return meeting;
		} catch {
			setRsvpCounts({
				member: { yes: 0, maybe: 0, no: 0, total: 0 },
				public: { yes: 0, maybe: 0, no: 0, total: 0 },
				combined: { yes: 0, maybe: 0, no: 0, total: 0 },
			});
			return null;
		}
	}

	function openItem(m) {
		setEdit({
			id: m.id,
			title: m.title || "",
			starts_at: m.starts_at ? new Date(Number(m.starts_at)).toISOString().slice(0, 16) : "",
			ends_at: m.ends_at ? new Date(Number(m.ends_at)).toISOString().slice(0, 16) : "",
			location: m.location || "",
			agenda: m.agenda || "",
			is_public: !!m.is_public,
		});
		setMyRsvp(null);
		setRsvpCounts({
			member: { yes: 0, maybe: 0, no: 0, total: 0 },
			public: { yes: 0, maybe: 0, no: 0, total: 0 },
			combined: { yes: 0, maybe: 0, no: 0, total: 0 },
		});
		loadMyRsvp(m.id);
		loadMeetingDetail(m.id).then((meeting) => {
			if (!meeting) return;
			setEdit((prev) => {
				if (!prev || prev.id !== m.id) return prev;
				return {
					...prev,
					title: meeting.title || prev.title,
					starts_at: meeting.starts_at ? new Date(Number(meeting.starts_at)).toISOString().slice(0, 16) : prev.starts_at,
					ends_at: meeting.ends_at ? new Date(Number(meeting.ends_at)).toISOString().slice(0, 16) : prev.ends_at,
					location: meeting.location || prev.location,
					agenda: meeting.agenda || prev.agenda,
					is_public: !!meeting.is_public,
				};
			});
		}).catch(() => {});
	}

	function closeModal() {
		setEdit(null);
		setRsvpCounts({
			member: { yes: 0, maybe: 0, no: 0, total: 0 },
			public: { yes: 0, maybe: 0, no: 0, total: 0 },
			combined: { yes: 0, maybe: 0, no: 0, total: 0 },
		});
	}

	async function loadMyRsvp(meetingId) {
		if (!orgId || !meetingId) return;
		try {
			const r = await api(`/api/orgs/${encodeURIComponent(orgId)}/meetings/${encodeURIComponent(meetingId)}/rsvp`, {
				method: "GET",
			});
			setMyRsvp(r?.my_rsvp ?? r?.rsvp ?? null);
		} catch {
			setMyRsvp(null);
		}
	}

async function saveMyRsvp(status) {
	if (!orgId || !edit?.id) return;
	setRsvpBusy(true);
	setErr("");
	try {
		const r = await api(`/api/orgs/${encodeURIComponent(orgId)}/meetings/${encodeURIComponent(edit.id)}/rsvp`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ status }),
		});
		setMyRsvp(r?.my_rsvp ?? r?.rsvp ?? { status });
		// Re-read to ensure we reflect what actually persisted
		await Promise.all([loadMyRsvp(edit.id), loadMeetingDetail(edit.id)]);
	} catch (e) {
		setErr(e?.message || "Failed to RSVP");
	} finally {
		setRsvpBusy(false);
	}
}

async function saveEdit() {
		if (!orgId || !edit?.id) return;
		setErr("");
		try {
			const orgKey = getCachedOrgKey(orgId);
			const is_public = !!edit.is_public;
			const starts_at = fromInputDT(edit.starts_at);
			const ends_at = fromInputDT(edit.ends_at);

			let payload = {
				id: edit.id,
				title: safeStr(edit.title).trim(),
				starts_at,
				ends_at,
				location: safeStr(edit.location).trim(),
				agenda: safeStr(edit.agenda),
				is_public,
			};

			if (orgKey && !is_public) {
				const enc = await encryptWithOrgKey(orgKey, JSON.stringify({ title: payload.title, location: payload.location, agenda: payload.agenda }));
				payload = {
					id: edit.id,
					title: "__encrypted__",
					starts_at,
					ends_at,
					location: "",
					agenda: "",
					is_public,
					encrypted_blob: enc,
				};
			}

			await api(`/api/orgs/${encodeURIComponent(orgId)}/meetings`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});

			closeModal();
			setTimeout(() => refresh().catch(console.error), 250);
		} catch (e) {
			console.error(e);
			setErr(e?.message || String(e));
		}
	}

	async function deleteItem() {
		if (!orgId || !edit?.id) return;
		setErr("");
		try {
			await api(`/api/orgs/${encodeURIComponent(orgId)}/meetings?id=${encodeURIComponent(edit.id)}`, { method: "DELETE" });
			closeModal();
			setTimeout(() => refresh().catch(console.error), 250);
		} catch (e) {
			console.error(e);
			setErr(e?.message || String(e));
		}
	}

	return (
		<div>
			<div className="card" style={{ margin: 16, padding: 16 }}>
				<div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
					<h2 className="section-title" style={{ margin: 0, flex: 1, minWidth: 160 }}>
						Meetings
					</h2>
					<button className="btn" onClick={() => refresh().catch(console.error)} disabled={loading}>
						{loading ? "Loading" : "Refresh"}
					</button>
					<button className="btn" onClick={() => encryptExisting().catch(console.error)} disabled={busyZk || loading}>
						{busyZk ? "Encrypting" : "Encrypt Existing"}
					</button>
				</div>

				{zkMsg ? <div className="helper" style={{ marginTop: 10 }}>{zkMsg}</div> : null}

				<input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search meetings" style={{ marginTop: 10 }} />
				{err ? <div className="helper" style={{ color: "tomato", marginTop: 10 }}>{err}</div> : null}

				<div className="bf-table-desktop" style={{ marginTop: 12, overflowX: "auto" }}>
					<table className="table" style={{ width: "100%" }}>
						<thead>
							<tr>
								<th>Title</th>
								<th>Starts</th>
								<th>Ends</th>
								<th>Location</th>
								<th>Public</th>
								<th></th>
							</tr>
						</thead>
						<tbody>
							{filtered.map((m) => (
								<tr key={m.id}>
									<td style={{ fontWeight: 700 }}>{m.title || "(untitled)"}</td>
									<td>{formatDT(m.starts_at)}</td>
									<td>{formatDT(m.ends_at)}</td>
									<td>{m.location || ""}</td>
									<td>{m.is_public ? "Yes" : "No"}</td>
									<td style={{ textAlign: "right" }}><button className="btn" type="button" onClick={() => openItem(m)}>Details</button></td>
								</tr>
							))}
						</tbody>
					</table>
				</div>

				<div className="bf-cards-mobile" style={{ marginTop: 12 }}>
					{filtered.length ? (
						filtered.map((m) => (
							<div key={m.id} className="bf-rowcard">
								<div className="bf-rowcard-top">
									<div
										className="bf-rowcard-title"
										style={{
											whiteSpace: "normal",
											overflow: "visible",
											textOverflow: "unset",
											wordBreak: "break-word",
										}}
									>
										{m.title || "(untitled)"}
									</div>
									<button className="btn" type="button" onClick={() => openItem(m)}>Details</button>
								</div>

								<div className="bf-two">
									<div className="bf-field" style={{ marginTop: 0 }}>
										<div className="bf-field-label">Starts</div>
										<div style={{ overflowWrap: "anywhere" }}>{formatDT(m.starts_at) || "—"}</div>
									</div>
									<div className="bf-field" style={{ marginTop: 0 }}>
										<div className="bf-field-label">Ends</div>
										<div style={{ overflowWrap: "anywhere" }}>{formatDT(m.ends_at) || "—"}</div>
									</div>
								</div>

								<div className="bf-two">
									<div className="bf-field">
										<div className="bf-field-label">Location</div>
										<div style={{ overflowWrap: "anywhere" }}>{m.location || "—"}</div>
									</div>
									<div className="bf-field">
										<div className="bf-field-label">Public</div>
										<div>{m.is_public ? "Yes" : "No"}</div>
									</div>
								</div>

								{safeStr(m.agenda).trim() ? (
									<div className="bf-field">
										<div className="bf-field-label">Agenda</div>
										<div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{m.agenda}</div>
									</div>
								) : null}
							</div>
						))
					) : (
						<div className="helper">No meetings found.</div>
					)}
				</div>
			</div>


			{edit ? (
				<div
					className="bf-modal-backdrop"
					onMouseDown={(e) => {
						if (e.target === e.currentTarget) closeModal();
					}}
				>
					<div className="card bf-modal-shell" style={{ "--bf-modal-width": "800px" }}>
						<div className="bf-modal-header row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
							<h3 style={{ margin: 0 }}>Meeting Details</h3>
							<button className="btn" type="button" onClick={closeModal}>Close</button>
						</div>

						<div className="bf-modal-body">
						<div className="bf-modal-compact-grid">
							<input className="input" placeholder="Title" value={edit.title} onChange={(e) => setEdit((p) => ({ ...p, title: e.target.value }))} />
							<input className="input" type="datetime-local" value={edit.starts_at} onChange={(e) => setEdit((p) => ({ ...p, starts_at: e.target.value }))} />
							<input className="input" type="datetime-local" value={edit.ends_at} onChange={(e) => setEdit((p) => ({ ...p, ends_at: e.target.value }))} />
							<input className="input" placeholder="Location" value={edit.location} onChange={(e) => setEdit((p) => ({ ...p, location: e.target.value }))} />
						</div>

						<div style={{ marginTop: 12 }}>
							<div className="helper" style={{ marginBottom: 6, opacity: 0.9 }}>Your RSVP</div>
							<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
								<div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
									<button className="btn" type="button" disabled={rsvpBusy} onClick={() => saveMyRsvp("yes")}>Yes</button>
									<button className="btn" type="button" disabled={rsvpBusy} onClick={() => saveMyRsvp("maybe")}>Maybe</button>
									<button className="btn" type="button" disabled={rsvpBusy} onClick={() => saveMyRsvp("no")}>No</button>
								</div>
								<div className="helper" style={{ opacity: 0.9 }}>{myRsvp?.status || "none"}</div>
							</div>
						</div>

						<div style={{ marginTop: 12 }}>
							<div className="helper" style={{ marginBottom: 6, opacity: 0.9 }}>RSVP counts</div>
							<div className="bf-stat-grid">
								<div className="bf-stat-card">
									<div className="bf-stat-label">Total</div>
									<div className="bf-stat-value">{Number(rsvpCounts?.combined?.total || 0)}</div>
								</div>
								<div className="bf-stat-card">
									<div className="bf-stat-label">Yes</div>
									<div className="bf-stat-value">{Number(rsvpCounts?.combined?.yes || 0)}</div>
								</div>
								<div className="bf-stat-card">
									<div className="bf-stat-label">Maybe</div>
									<div className="bf-stat-value">{Number(rsvpCounts?.combined?.maybe || 0)}</div>
								</div>
								<div className="bf-stat-card">
									<div className="bf-stat-label">No</div>
									<div className="bf-stat-value">{Number(rsvpCounts?.combined?.no || 0)}</div>
								</div>
							</div>
							<div className="helper" style={{ marginTop: 8 }}>
								Members: {Number(rsvpCounts?.member?.total || 0)} · Public: {Number(rsvpCounts?.public?.total || 0)}
							</div>
						</div>

						<textarea className="input" rows={4} placeholder="Agenda / Notes" value={edit.agenda} onChange={(e) => setEdit((p) => ({ ...p, agenda: e.target.value }))} style={{ marginTop: 10 }} />

						<label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
							<input type="checkbox" checked={!!edit.is_public} onChange={(e) => setEdit((p) => ({ ...p, is_public: e.target.checked }))} />
							<span className="helper">Public</span>
						</label>
						</div>

						<div className="bf-modal-footer row" style={{ gap: 10, marginTop: 12, justifyContent: "space-between" }}>
							<button className="btn" type="button" onClick={deleteItem}>Delete</button>
							<button className="btn-red" type="button" onClick={saveEdit}>Save Changes</button>
						</div>

						<div className="helper bf-modal-note">
							If ZK is enabled and this meeting is not public, Title, Location, and Agenda are encrypted automatically on save.
							Start and end times stay unencrypted so you can sort and display schedules.
						</div>
					</div>
				</div>
			) : null}


			<div className="card" data-tour="meetings-add-form" style={{ margin: 16, padding: 16 }}>
				<h3 style={{ marginTop: 0 }}>Add Meeting</h3>
				<form onSubmit={onAdd} style={{ display: "grid", gap: 10 }}>
					<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
						<input className="input" placeholder="Title" value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} />
						<input className="input" type="datetime-local" value={form.starts_at} onChange={(e) => setForm((p) => ({ ...p, starts_at: e.target.value }))} />
						<input className="input" type="datetime-local" value={form.ends_at} onChange={(e) => setForm((p) => ({ ...p, ends_at: e.target.value }))} />
						<input className="input" placeholder="Location" value={form.location} onChange={(e) => setForm((p) => ({ ...p, location: e.target.value }))} />
					</div>
					<textarea className="input" rows={3} placeholder="Agenda" value={form.agenda} onChange={(e) => setForm((p) => ({ ...p, agenda: e.target.value }))} />
					<label style={{ display: "flex", alignItems: "center", gap: 8 }}>
						<input type="checkbox" checked={form.is_public} onChange={(e) => setForm((p) => ({ ...p, is_public: e.target.checked }))} />
						<span className="helper">Public</span>
					</label>
					<button className="btn-red" type="submit">Create</button>
				</form>
			</div>
		</div>
	);
}
