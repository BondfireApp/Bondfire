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

function safeStr(v) {
  return String(v ?? "");
}

function readParMap(orgId) {
  try {
    return JSON.parse(localStorage.getItem(`bf_inv_par_${orgId}`) || "{}") || {};
  } catch {
    return {};
  }
}

function writeParMap(orgId, obj) {
  try {
    localStorage.setItem(`bf_inv_par_${orgId}`, JSON.stringify(obj || {}));
  } catch {}
}

function buildParMapFromItems(rows) {
  const next = {};
  for (const it of Array.isArray(rows) ? rows : []) {
    if (it?.id == null) continue;
    const raw = it?.par;
    const n = raw === "" || raw == null ? NaN : Number(raw);
    next[String(it.id)] = Number.isFinite(n) && n > 0 ? n : "";
  }
  return next;
}

export default function Inventory() {
  const orgId = getOrgId();
  const isNarrow = useMemo(() => {
    try {
      return !!(window && window.matchMedia && window.matchMedia("(max-width: 720px)").matches);
    } catch {
      return false;
    }
  }, []);

  const [parMap, setParMap] = useState(() => (orgId ? readParMap(orgId) : {}));
  useEffect(() => {
    setParMap(orgId ? readParMap(orgId) : {});
  }, [orgId]);

  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [sortMode, setSortMode] = useState("low");
  const [catFilter, setCatFilter] = useState("all");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [zkMsg, setZkMsg] = useState("");

  const [selected, setSelected] = useState(null);
  const [edit, setEdit] = useState(null);

  const [form, setForm] = useState({ name: "", qty: 0, par: "", unit: "", category: "", location: "", notes: "", is_public: false });

  async function saveParToBackend(id, rawValue) {
    if (!orgId || !id) return;
    const par = rawValue === "" || rawValue == null ? null : Number(rawValue);
    const item = items.find((it) => String(it?.id) === String(id));
    if (!item) return;

    await api(`/api/orgs/${encodeURIComponent(orgId)}/inventory`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id,
        name: item.name,
        qty: item.qty,
        unit: item.unit,
        category: item.category,
        location: item.location,
        notes: item.notes,
        is_public: !!item.is_public,
        encrypted_notes: item.encrypted_notes ?? null,
        encrypted_blob: item.encrypted_blob ?? null,
        par: Number.isFinite(par) && par > 0 ? par : null,
      }),
    });
  }

  async function refresh() {
    if (!orgId) return;
    setLoading(true);
    setErr("");
    try {
      const data = await api(`/api/orgs/${encodeURIComponent(orgId)}/inventory`);
      const raw = Array.isArray(data.items) ? data.items : Array.isArray(data.inventory) ? data.inventory : [];

      const orgKey = getCachedOrgKey(orgId);
      const out = [];
      if (orgKey) {
        for (const it of raw) {
          if (it?.encrypted_blob) {
            try {
              const dec = JSON.parse(await decryptWithOrgKey(orgKey, it.encrypted_blob));
              out.push({
                ...it,
                ...dec,
                category: dec?.category ?? dec?.cat ?? it?.category ?? it?.cat ?? "",
              });
              continue;
            } catch {
              out.push({ ...it, name: "(encrypted)", category: it.category || "", location: "", notes: "" });
              continue;
            }
          }
          out.push(it);
        }
      } else {
        out.push(...raw);
      }

      setItems(out);
      const serverParMap = buildParMapFromItems(out);
      setParMap(serverParMap);
      writeParMap(orgId, serverParMap);
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
    let arr = items;
    if (catFilter && catFilter !== "all") {
      arr = arr.filter((it) => safeStr(it.category).toLowerCase() === catFilter);
    }
    return arr.filter((it) =>
      [safeStr(it.name), safeStr(it.category), safeStr(it.location), safeStr(it.notes)]
        .join(" ")
        .toLowerCase()
        .includes(needle)
    );
  }, [items, q, catFilter]);

  const categoryOptions = useMemo(() => {
    const set = new Set();
    for (const it of items || []) {
      const c = safeStr(it.category).trim().toLowerCase();
      if (c) set.add(c);
    }
    return Array.from(set.values()).sort();
  }, [items]);

  const sorted = useMemo(() => {
    const arr = Array.isArray(filtered) ? [...filtered] : [];
    const pm = parMap || {};
    const meta = (it) => {
      const id = it?.id != null ? String(it.id) : "";
      const parRaw = pm?.[id];
      const parV = parRaw === "" || parRaw == null ? NaN : Number(parRaw);
      const par = Number.isFinite(parV) && parV > 0 ? parV : null;
      const qtyV = Number(it?.qty);
      const qty = Number.isFinite(qtyV) ? qtyV : 0;
      const pct = par ? qty / par : null;
      return { id, qty, par, pct, cat: safeStr(it?.category).toLowerCase(), name: safeStr(it?.name).toLowerCase() };
    };
    arr.sort((a, b) => {
      const A = meta(a);
      const B = meta(b);
      if (sortMode === "name") return A.name.localeCompare(B.name);
      if (sortMode === "category") return A.cat.localeCompare(B.cat) || A.name.localeCompare(B.name);
      if (sortMode === "qty") return (A.qty - B.qty) || A.name.localeCompare(B.name);
      if (sortMode === "par") return ((A.par || 999999) - (B.par || 999999)) || A.name.localeCompare(B.name);
      const ap = A.pct == null ? 999 : A.pct;
      const bp = B.pct == null ? 999 : B.pct;
      if (ap !== bp) return ap - bp;
      return A.name.localeCompare(B.name);
    });
    return arr;
  }, [filtered, parMap, sortMode]);

  async function onAdd(e) {
    e.preventDefault();
    if (!orgId) return;
    setErr("");
    const name = safeStr(form.name).trim();
    if (!name) return;
    const qty = Number(form.qty) || 0;
    const unit = safeStr(form.unit).trim();
    const category = safeStr(form.category).trim();
    const parNum = form.par === "" ? null : Number(form.par);
    const location = safeStr(form.location).trim();
    const notes = safeStr(form.notes).trim();
    const is_public = !!form.is_public;

    const orgKey = getCachedOrgKey(orgId);
    let payload = { name, qty, unit, category, location, notes, is_public };
    if (orgKey && !is_public) {
      const enc = await encryptWithOrgKey(orgKey, JSON.stringify({ name, category, location, notes }));
      payload = { name: "__encrypted__", qty, unit, category, location: "", notes: "", is_public, encrypted_blob: enc };
    }

    const res = await api(`/api/orgs/${encodeURIComponent(orgId)}/inventory`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payload,
        par: Number.isFinite(parNum) && parNum > 0 ? parNum : null,
      }),
    });

    const createdItem = res?.item
      ? {
          ...res.item,
          name,
          qty,
          unit,
          category,
          location,
          notes,
          is_public,
        }
      : null;

    if (createdItem?.id) {
      setItems((prev) => [createdItem, ...(Array.isArray(prev) ? prev : [])]);
      setParMap((prev) => {
        const next = { ...(prev || {}), [String(createdItem.id)]: Number.isFinite(parNum) && parNum > 0 ? parNum : "" };
        writeParMap(orgId, next);
        return next;
      });
    } else {
      await refresh();
    }

    setForm({ name: "", qty: 0, par: "", unit: "", category: "", location: "", notes: "", is_public: false });
  }

  function openItem(it) {
    setSelected(it);
    setEdit({
      id: it.id,
      name: it.name || "",
      qty: it.qty ?? 0,
      par: parMap?.[String(it.id)] ?? it?.par ?? "",
      unit: it.unit || "",
      category: it.category || "",
      location: it.location || "",
      notes: it.notes || "",
      is_public: !!it.is_public,
    });
  }

  function closeModal() {
    setSelected(null);
    setEdit(null);
  }

  async function saveEdit() {
    if (!orgId || !edit?.id) return;
    setErr("");
    try {
      const orgKey = getCachedOrgKey(orgId);
      const is_public = !!edit.is_public;
      const qty = Number.isFinite(Number(edit.qty)) ? Number(edit.qty) : 0;

      let payload = {
        id: edit.id,
        name: safeStr(edit.name).trim(),
        qty,
        unit: safeStr(edit.unit).trim(),
        category: safeStr(edit.category).trim(),
        location: safeStr(edit.location).trim(),
        notes: safeStr(edit.notes),
        is_public,
      };

      if (orgKey && !is_public) {
        const enc = await encryptWithOrgKey(
          orgKey,
          JSON.stringify({
            name: payload.name,
            category: payload.category,
            location: payload.location,
            notes: payload.notes,
          })
        );
        payload = {
          id: edit.id,
          name: "__encrypted__",
          qty,
          unit: payload.unit,
          category: payload.category,
          location: "",
          notes: "",
          is_public,
          encrypted_blob: enc,
        };
      }

      const saved = await api(`/api/orgs/${encodeURIComponent(orgId)}/inventory`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          par: edit.par === "" || edit.par == null ? null : Number(edit.par),
        }),
      });

      const savedItem = saved?.item
        ? {
            ...saved.item,
            name: safeStr(edit.name).trim(),
            qty,
            unit: safeStr(edit.unit).trim(),
            category: safeStr(edit.category).trim(),
            location: safeStr(edit.location).trim(),
            notes: safeStr(edit.notes),
            is_public,
          }
        : null;

      if (savedItem?.id) {
        setItems((prev) => (Array.isArray(prev) ? prev.map((it) => (it.id === savedItem.id ? savedItem : it)) : prev));
        setParMap((prev) => {
          const next = {
            ...(prev || {}),
            [String(savedItem.id)]: edit.par === "" || edit.par == null ? "" : (Number.isFinite(Number(edit.par)) ? Number(edit.par) : ""),
          };
          writeParMap(orgId, next);
          return next;
        });
      } else {
        await refresh();
      }

      closeModal();
    } catch (e) {
      console.error(e);
      setErr(e?.message || String(e));
    }
  }

  async function deleteItem() {
    if (!orgId || !edit?.id) return;
    setErr("");
    try {
      await api(`/api/orgs/${encodeURIComponent(orgId)}/inventory?id=${encodeURIComponent(edit.id)}`, {
        method: "DELETE",
      });
      setItems((prev) => (Array.isArray(prev) ? prev.filter((it) => it.id !== edit.id) : prev));
      setParMap((prev) => {
        const next = { ...(prev || {}) };
        delete next[String(edit.id)];
        writeParMap(orgId, next);
        return next;
      });
      closeModal();
    } catch (e) {
      console.error(e);
      setErr(e?.message || String(e));
    }
  }

  return (
    <div>
      <div className="card" style={{ margin: 16, padding: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h2 className="section-title" style={{ margin: 0, flex: 1, minWidth: 140 }}>Inventory</h2>
          <button className="btn" onClick={() => refresh().catch(console.error)} disabled={loading}>{loading ? "Loading" : "Refresh"}</button>
        </div>

        {zkMsg ? <div className="helper" style={{ marginTop: 8, fontSize: 12, lineHeight: 1.35 }}>{zkMsg}</div> : null}
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search inventory" style={{ marginTop: 12 }} />
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
          <div className="helper">Sort</div>
          <select className="input" value={sortMode} onChange={(e) => setSortMode(e.target.value)} style={{ width: 180 }}>
            <option value="low">Lowest stock first</option>
            <option value="name">Name</option>
            <option value="category">Category</option>
            <option value="qty">Qty</option>
            <option value="par">Par</option>
          </select>
          <div className="helper">Category</div>
          <select className="input" value={catFilter} onChange={(e) => setCatFilter(e.target.value)} style={{ width: 200 }}>
            <option value="all">All</option>
            {categoryOptions.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        {err ? <div className="helper" style={{ color: "tomato", marginTop: 10 }}>{err}</div> : null}

        {isNarrow ? (
          loading ? (
            <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={`skel-invrow-${i}`} className="card" style={{ padding: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <div className="bfSkel" style={{ height: 14, width: "60%", borderRadius: 8 }} />
                      <div className="bfSkel" style={{ height: 12, width: "40%", borderRadius: 8, marginTop: 8 }} />
                    </div>
                    <div className="bfSkel" style={{ height: 34, width: 84, borderRadius: 10 }} />
                  </div>
                  <div className="bfSkel" style={{ height: 10, width: "100%", borderRadius: 999, marginTop: 12 }} />
                </div>
              ))}
            </div>
          ) : (
            <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
              {sorted.map((it) => {
                const idStr = String(it.id);
                const raw = parMap?.[idStr];
                const parV = raw === "" || raw == null ? NaN : Number(raw);
                const par = Number.isFinite(parV) && parV > 0 ? parV : 0;
                const qtyV = Number(it?.qty);
                const qty = Number.isFinite(qtyV) ? qtyV : 0;
                const pct = par > 0 ? qty / par : null;
                const tone = pct == null ? "neutral" : pct <= 0.25 ? "danger" : pct <= 0.5 ? "warn" : "success";
                const barColor = tone === "danger" ? "#ff4d4d" : tone === "warn" ? "#ff9a3c" : tone === "success" ? "#39d98a" : "rgba(255,255,255,0.18)";
                return (
                  <div key={it.id} className="card" style={{ padding: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 900, fontSize: 16, lineHeight: 1.15, wordBreak: "break-word" }}>{it.name || "(unnamed)"}</div>
                        <div className="helper" style={{ marginTop: 4, wordBreak: "break-word" }}>{it.category || "uncategorized"}</div>
                      </div>
                      <button className="btn" type="button" onClick={() => openItem(it)} style={{ whiteSpace: "nowrap" }}>
                        Details
                      </button>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
                      <div>
                        <div className="helper">Qty</div>
                        <div style={{ fontWeight: 900 }}>{qty}</div>
                      </div>
                      <div>
                        <div className="helper">Par</div>
                        <input
                          className="input"
                          type="number"
                          value={parMap?.[idStr] ?? ""}
                          onFocus={(e) => {
                            const v = String(e.target.value || "");
                            if (v === "0") {
                              setParMap((prev) => ({ ...prev, [idStr]: "" }));
                            } else {
                              try { e.target.select(); } catch {}
                            }
                          }}
                          onChange={(e) => {
                            const v = e.target.value;
                            setParMap((prev) => {
                              const next = { ...(prev || {}) };
                              next[idStr] = v === "" ? "" : Number(v);
                              writeParMap(orgId, next);
                              return next;
                            });
                          }}
                          onBlur={(e) => {
                            const v = e.target.value;
                            saveParToBackend(idStr, v).catch((er) => {
                              console.error(er);
                              setErr(er?.message || String(er));
                              refresh().catch(console.error);
                            });
                          }}
                          style={{ width: "100%" }}
                        />
                      </div>
                    </div>

                    <div style={{ marginTop: 10 }}>
                      <div className="helper" style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                        <span>Stock</span>
                        <span style={{ whiteSpace: "nowrap" }}>{par ? `${Math.round(qty)} / ${Math.round(par)}` : "no par"}</span>
                      </div>
                      <div style={{ height: 10, borderRadius: 999, background: "rgba(255,255,255,0.10)", overflow: "hidden", marginTop: 6 }}>
                        <div style={{ height: "100%", width: `${par ? Math.min(100, (qty / par) * 100) : 0}%`, background: barColor }} />
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 10 }}>
                      <div className="helper">Unit: <span style={{ color: "white" }}>{it.unit || ""}</span></div>
                      <div className="helper">Public: <span style={{ color: "white" }}>{it.is_public ? "Yes" : "No"}</span></div>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        ) : (
          <div style={{ marginTop: 12 }}>
            <table className="table" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Qty</th>
                <th>Par</th>
                <th>Stock</th>
                <th>Unit</th>
                <th>Public</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((it) => (
                <tr key={it.id}>
                  <td style={{ fontWeight: 700 }}>{it.name || "(unnamed)"}</td>
                  <td>{it.qty ?? 0}</td>
                  <td>
                    <input
                      className="input"
                      type="number"
                      value={parMap?.[String(it.id)] ?? ""}
                      onFocus={(e) => {
                        const v = String(e.target.value || "");
                        if (v === "0") {
                          setParMap((prev) => ({ ...prev, [String(it.id)]: "" }));
                        } else {
                          try { e.target.select(); } catch {}
                        }
                      }}
                      onChange={(e) => {
                        const v = e.target.value;
                        setParMap((prev) => {
                          const next = { ...(prev || {}) };
                          next[String(it.id)] = v === "" ? "" : Number(v);
                          writeParMap(orgId, next);
                          return next;
                        });
                      }}
                      onBlur={(e) => {
                        const v = e.target.value;
                        saveParToBackend(String(it.id), v).catch((er) => {
                          console.error(er);
                          setErr(er?.message || String(er));
                          refresh().catch(console.error);
                        });
                      }}
                      style={{ width: 90 }}
                    />
                  </td>
                  <td>
                    {(() => {
                      const id = String(it.id);
                      const raw = parMap?.[id];
                      const parV = raw === "" || raw == null ? NaN : Number(raw);
                      const par = Number.isFinite(parV) && parV > 0 ? parV : null;
                      const qtyV = Number(it?.qty);
                      const qty = Number.isFinite(qtyV) ? qtyV : 0;
                      if (!par) return <span className="helper">no par</span>;
                      const pct = Math.max(0, Math.min(1, qty / par));
                      return (
                        <div style={{ display: "grid", gap: 4, minWidth: 160 }}>
                          <div style={{ height: 10, borderRadius: 999, background: "rgba(255,255,255,0.10)", overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${pct * 100}%`, background: pct <= 0.25 ? "#ff4d4d" : pct <= 0.5 ? "#ff9a3c" : "#39d98a" }} />
                          </div>
                          <div className="helper">{Math.round(qty)} / {Math.round(par)}</div>
                        </div>
                      );
                    })()}
                  </td>
                  <td>{it.unit || ""}</td>
                  <td>{it.is_public ? "Yes" : "No"}</td>
                  <td style={{ textAlign: "right" }}><button className="btn" type="button" onClick={() => openItem(it)}>Details</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {edit ? (
        <div
          className="bf-modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div className="card bf-modal-shell" style={{ "--bf-modal-width": "760px" }}>
            <div className="bf-modal-header row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ margin: 0 }}>Inventory Details</h3>
              <button className="btn" type="button" onClick={closeModal}>
                Close
              </button>
            </div>

            <div className="bf-modal-body">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
              <input className="input" placeholder="Name" value={edit.name} onChange={(e) => setEdit((p) => ({ ...p, name: e.target.value }))} />
              <input className="input" type="number" placeholder="Qty" value={edit.qty} onChange={(e) => setEdit((p) => ({ ...p, qty: e.target.value }))} />
              <input className="input" type="number" placeholder="Par" value={edit.par ?? ""} onChange={(e) => setEdit((p) => ({ ...p, par: e.target.value }))} />
              <input className="input" placeholder="Unit" value={edit.unit} onChange={(e) => setEdit((p) => ({ ...p, unit: e.target.value }))} />
              <input className="input" placeholder="Category" value={edit.category} onChange={(e) => setEdit((p) => ({ ...p, category: e.target.value }))} />
              <input className="input" placeholder="Location" value={edit.location} onChange={(e) => setEdit((p) => ({ ...p, location: e.target.value }))} />
            </div>

            <textarea className="input" rows={4} placeholder="Notes" value={edit.notes} onChange={(e) => setEdit((p) => ({ ...p, notes: e.target.value }))} style={{ marginTop: 10 }} />

            <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
              <input type="checkbox" checked={!!edit.is_public} onChange={(e) => setEdit((p) => ({ ...p, is_public: e.target.checked }))} />
              <span className="helper">Public</span>
            </label>
            </div>

            <div className="bf-modal-footer row" style={{ gap: 10, marginTop: 12, justifyContent: "space-between" }}>
              <button className="btn" type="button" onClick={deleteItem}>
                Delete
              </button>
              <button className="btn-red" type="button" onClick={saveEdit}>
                Save Changes
              </button>
            </div>

            <div className="helper" style={{ marginTop: 8, fontSize: 12, lineHeight: 1.35 }}>
              If ZK is enabled and this item is not public, Name, Category, Location, and Notes are encrypted automatically on save.
            </div>
          </div>
        </div>
      ) : null}

      <div className="card" style={{ margin: 16, padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>Add Inventory</h3>
        <form onSubmit={onAdd} style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
            <input className="input" placeholder="Name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
            <input className="input" type="number" placeholder="Qty" value={form.qty} onChange={(e) => setForm((p) => ({ ...p, qty: e.target.value }))} />
            <input className="input" type="number" placeholder="Par" value={form.par} onChange={(e) => setForm((p) => ({ ...p, par: e.target.value }))} />
            <input className="input" placeholder="Unit" value={form.unit} onChange={(e) => setForm((p) => ({ ...p, unit: e.target.value }))} />
            <input className="input" placeholder="Category" value={form.category} onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))} />
            <input className="input" placeholder="Location" value={form.location} onChange={(e) => setForm((p) => ({ ...p, location: e.target.value }))} />
          </div>
          <textarea className="input" rows={3} placeholder="Notes" value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} />
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
