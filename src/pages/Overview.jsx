import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Responsive } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { api } from "../utils/api.js";
import { decryptWithOrgKey, getCachedOrgKey } from "../lib/zk.js";
import OrgKeyBackupNudge from "../components/OrgKeyBackupNudge.jsx";
import "./Overview.css";

function readOrgInfo(orgId) {
  try {
    const s = JSON.parse(localStorage.getItem(`bf_org_settings_${orgId}`) || "{}");
    const orgs = JSON.parse(localStorage.getItem("bf_orgs") || "[]");
    const o = orgs.find((x) => x?.id === orgId) || {};
    return { name: (s.name || o.name || orgId || "Dashboard").trim() };
  } catch {
    return { name: orgId || "Dashboard" };
  }
}

function safeStr(v) {
  return String(v ?? "");
}

function fmtDT(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return "";
  try {
    return new Date(n).toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function isEncryptedNameLike(v) {
  const s = String(v || "").trim().toLowerCase();
  return s === "__encrypted__" || s === "_encrypted_" || s === "(encrypted)" || s === "encrypted";
}

async function tryDecryptList(orgId, rows, blobField = "encrypted_blob") {
  const arr = Array.isArray(rows) ? rows : [];
  const orgKey = getCachedOrgKey(orgId);
  if (!orgKey) return arr;

  const out = [];
  for (const r of arr) {
    const blob =
      (r && r[blobField]) ||
      (r && r.encrypted_blob) ||
      (r && r.encryptedBlob) ||
      (r && r.encrypted_description) ||
      (r && r.encryptedDescription);

    if (r && blob) {
      try {
        const decStr = await decryptWithOrgKey(orgKey, blob);
        const dec = JSON.parse(decStr);
        out.push({
          ...r,
          ...dec,
          category: dec?.category ?? dec?.cat ?? r?.category ?? r?.cat ?? r?.Category ?? r?.CATEGORY,
        });
        continue;
      } catch {}
    }
    out.push(r);
  }
  return out;
}

function readRefreshBaseline(orgId) {
  try {
    return JSON.parse(sessionStorage.getItem(`bf_dash_baseline_${orgId}`) || "{}") || {};
  } catch {
    return {};
  }
}

function writeRefreshBaseline(orgId, baseline) {
  try {
    sessionStorage.setItem(`bf_dash_baseline_${orgId}`, JSON.stringify(baseline || {}));
  } catch {}
}

function writePrevCounts(orgId, counts) {
  try {
    localStorage.setItem(`bf_dash_counts_${orgId}`, JSON.stringify(counts || {}));
  } catch {}
}

function readDashHistory(orgId) {
  try {
    const raw = JSON.parse(localStorage.getItem(`bf_dash_history_${orgId}`) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function appendDashHistory(orgId, sample) {
  try {
    const prev = readDashHistory(orgId);
    const next = [...prev, sample].slice(-20);
    localStorage.setItem(`bf_dash_history_${orgId}`, JSON.stringify(next));
  } catch {}
}

function readInvPar(orgId) {
  try {
    return JSON.parse(localStorage.getItem(`bf_inv_par_${orgId}`) || "{}") || {};
  } catch {
    return {};
  }
}

function ModuleLogo({ src, label }) {
  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      title={label}
      style={{ width: 52, height: 52, objectFit: "contain", flex: "0 0 52px" }}
    />
  );
}

function deltaBadge(delta) {
  if (!Number.isFinite(delta) || delta === 0) return null;
  const up = delta > 0;
  const txt = up ? `▲ ${delta}` : `▼ ${Math.abs(delta)}`;
  const bg = up ? "rgba(0, 200, 120, 0.18)" : "rgba(255, 80, 80, 0.18)";
  const bd = up ? "rgba(0, 200, 120, 0.35)" : "rgba(255, 80, 80, 0.35)";
  const fg = up ? "#b8ffe4" : "#ffd0d0";
  return { txt, style: { padding: "3px 8px", borderRadius: 999, fontSize: 12, fontWeight: 800, background: bg, border: `1px solid ${bd}`, color: fg } };
}

function pill(text, tone) {
  const tones = {
    accepted: { bg: "rgba(0, 200, 120, 0.18)", bd: "rgba(0, 200, 120, 0.35)", fg: "#b8ffe4" },
    offered: { bg: "rgba(255, 200, 0, 0.14)", bd: "rgba(255, 200, 0, 0.35)", fg: "#ffe9a8" },
    urgent: { bg: "rgba(255, 80, 80, 0.18)", bd: "rgba(255, 80, 80, 0.38)", fg: "#ffd0d0" },
    high: { bg: "rgba(255, 140, 0, 0.16)", bd: "rgba(255, 140, 0, 0.34)", fg: "#ffd6a8" },
    medium: { bg: "rgba(120, 180, 255, 0.14)", bd: "rgba(120, 180, 255, 0.32)", fg: "#cfe3ff" },
    low: { bg: "rgba(255, 255, 255, 0.08)", bd: "rgba(255, 255, 255, 0.18)", fg: "#e9e9e9" },
  };
  const t = tones[tone] || tones.low;
  return (
    <span className="bf-status-pill" style={{ display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: 999, fontSize: 12, fontWeight: 800, background: t.bg, border: `1px solid ${t.bd}`, color: t.fg, letterSpacing: ".2px" }}>
      {text}
    </span>
  );
}

function Sparkline({ values, width = 120, height = 32 }) {
  const v = Array.isArray(values) ? values.map((x) => Number(x || 0)) : [];
  if (!v.length) return null;

  const min = Math.min(...v);
  const max = Math.max(...v);
  const range = max - min || 1;
  const pad = 2;
  const w = Math.max(10, width);
  const h = Math.max(10, height);
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;

  const pts = v.map((val, i) => {
    const x = pad + (i / Math.max(1, v.length - 1)) * innerW;
    const y = pad + (1 - (val - min) / range) * innerH;
    return [x, y];
  });

  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(" ");
  const areaD = `${d} L${(pad + innerW).toFixed(2)},${(pad + innerH).toFixed(2)} L${pad.toFixed(2)},${(pad + innerH).toFixed(2)} Z`;
  const trendUp = v[v.length - 1] >= v[0];

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      <path d={areaD} fill={"rgba(255,255,255,0.08)"} />
      <path d={d} fill="none" stroke={trendUp ? "rgba(120,255,200,0.9)" : "rgba(255,140,140,0.9)"} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function SkeletonBox({ w = "100%", h = 12, r = 10, style }) {
  return (
    <div
      className="bf-skeleton-box"
      style={{
        width: w,
        height: h,
        borderRadius: r,
        background: "linear-gradient(90deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.12) 45%, rgba(255,255,255,0.06) 90%)",
        backgroundSize: "240% 100%",
        animation: "bfShimmer 1.2s ease-in-out infinite",
        ...style,
      }}
    />
  );
}

function MetricCardSkeleton() {
  return (
    <div className="card bfDashCard" style={{ padding: 14, position: "relative", minHeight: 118 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <SkeletonBox w={52} h={52} r={12} />
        <SkeletonBox w={78} h={14} r={8} />
      </div>
      <div style={{ marginTop: 12 }}>
        <SkeletonBox w={56} h={34} r={10} />
      </div>
      <div style={{ marginTop: 10 }}>
        <SkeletonBox w={56} h={12} r={8} />
      </div>
    </div>
  );
}

function SectionCardSkeleton({ rows = 3 }) {
  return (
    <div className="card bfDashPanel" style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <SkeletonBox w={160} h={18} r={10} />
        <div style={{ marginLeft: "auto" }}>
          <SkeletonBox w={76} h={34} r={12} />
        </div>
      </div>
      <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="card" style={{ padding: 12 }}>
            <SkeletonBox w={"70%"} h={14} r={8} />
            <div style={{ marginTop: 8 }}>
              <SkeletonBox w={"55%"} h={12} r={8} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function layoutKey(orgId) {
  return `bf_dash_layouts_v2_${orgId}`;
}

function defaultLayouts() {
  return {
    lg: [
      { i: "inbox", x: 0, y: 0, w: 5, h: 14, minW: 3, minH: 10 },
      { i: "meetings", x: 5, y: 0, w: 5, h: 9, minW: 3, minH: 7 },
      { i: "inventory", x: 10, y: 0, w: 4, h: 10, minW: 3, minH: 8 },
      { i: "needs", x: 5, y: 9, w: 5, h: 10, minW: 3, minH: 8 },
      { i: "pledges", x: 10, y: 10, w: 4, h: 9, minW: 3, minH: 7 },
    ],
    md: [
      { i: "inbox", x: 0, y: 0, w: 6, h: 13, minW: 4, minH: 10 },
      { i: "meetings", x: 6, y: 0, w: 6, h: 8, minW: 4, minH: 7 },
      { i: "inventory", x: 6, y: 8, w: 6, h: 9, minW: 4, minH: 8 },
      { i: "needs", x: 0, y: 13, w: 6, h: 10, minW: 4, minH: 8 },
      { i: "pledges", x: 6, y: 17, w: 6, h: 8, minW: 4, minH: 7 },
    ],
    sm: [
      { i: "inbox", x: 0, y: 0, w: 1, h: 14, minH: 10, static: true },
      { i: "meetings", x: 0, y: 14, w: 1, h: 9, minH: 7, static: true },
      { i: "inventory", x: 0, y: 23, w: 1, h: 10, minH: 8, static: true },
      { i: "needs", x: 0, y: 33, w: 1, h: 10, minH: 8, static: true },
      { i: "pledges", x: 0, y: 43, w: 1, h: 9, minH: 7, static: true },
    ],
  };
}

function readLayouts(orgId) {
  try {
    const raw = JSON.parse(localStorage.getItem(layoutKey(orgId)) || "null");
    if (!raw || typeof raw !== "object") return defaultLayouts();
    const defs = defaultLayouts();
    return {
      lg: Array.isArray(raw.lg) ? raw.lg : defs.lg,
      md: Array.isArray(raw.md) ? raw.md : defs.md,
      sm: Array.isArray(raw.sm) ? raw.sm : defs.sm,
    };
  } catch {
    return defaultLayouts();
  }
}

function writeLayouts(orgId, layouts) {
  try {
    localStorage.setItem(layoutKey(orgId), JSON.stringify(layouts || defaultLayouts()));
  } catch {}
}

export default function Overview() {
  const nav = useNavigate();
  const { orgId } = useParams();
  const gridWrapRef = useRef(null);

  const [orgInfo, setOrgInfo] = useState(() => readOrgInfo(orgId));
  const [loading, setLoading] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [err, setErr] = useState("");
  const [counts, setCounts] = useState({});
  const [people, setPeople] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [needs, setNeeds] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [subs, setSubs] = useState([]);
  const [pledges, setPledges] = useState([]);
  const [publicInbox, setPublicInbox] = useState([]);
  const [rsvpMsg, setRsvpMsg] = useState("");
  const [isNarrow, setIsNarrow] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia && window.matchMedia("(max-width: 820px)").matches;
  });
  const [tickerDeltas, setTickerDeltas] = useState(() => ({}));
  const [dashLayouts, setDashLayouts] = useState(() => readLayouts(orgId));
  const [gridWidth, setGridWidth] = useState(0);

  useEffect(() => {
    setOrgInfo(readOrgInfo(orgId));
    const onChange = (e) => {
      const changedId = e?.detail?.orgId;
      if (!changedId || changedId === orgId) setOrgInfo(readOrgInfo(orgId));
    };
    window.addEventListener("bf:org_settings_changed", onChange);
    return () => window.removeEventListener("bf:org_settings_changed", onChange);
  }, [orgId]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(max-width: 820px)");
    const onChange = () => setIsNarrow(!!mq.matches);
    onChange();
    try {
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    } catch {
      mq.addListener(onChange);
      return () => mq.removeListener(onChange);
    }
  }, []);

  useEffect(() => {
    if (!gridWrapRef.current || typeof ResizeObserver === "undefined") return;
    const el = gridWrapRef.current;
    const update = () => {
      const next = Math.max(0, Math.floor(el.getBoundingClientRect().width));
      setGridWidth(next);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  useEffect(() => {
    setTickerDeltas({});
    setDashLayouts(readLayouts(orgId));
  }, [orgId]);

  async function refresh() {
    if (!orgId) return;
    setLoading(true);
    setErr("");
    setRsvpMsg("");
    try {
      const d = await api(`/api/orgs/${encodeURIComponent(orgId)}/dashboard`);
      const rawCounts = d?.counts || {};
      setCounts(rawCounts);

      const pplRaw = Array.isArray(d?.people) ? d.people : (await api(`/api/orgs/${encodeURIComponent(orgId)}/people`))?.people;
      const invRaw = Array.isArray(d?.inventory) ? d.inventory : (await api(`/api/orgs/${encodeURIComponent(orgId)}/inventory`))?.items;
      let invRawFinal = invRaw;

      const invLooksScrubbed =
        Array.isArray(invRaw) &&
        invRaw.length > 0 &&
        invRaw.some((it) => {
          const cat = (it && (it.category || it.cat)) || "";
          const blob = it && (it.encrypted_blob || it.encryptedBlob);
          const nm = String(it && (it.name || it.title || "")).toLowerCase();
          return !blob && (!cat || cat === "" || cat === "__encrypted__" || cat === "_encrypted_") && (nm.includes("encrypted") || nm === "");
        });

      if (invLooksScrubbed) {
        try {
          const invFull = await api(`/api/orgs/${encodeURIComponent(orgId)}/inventory`);
          invRawFinal = Array.isArray(invFull?.items) ? invFull.items : invRaw;
        } catch {
          invRawFinal = invRaw;
        }
      }

      const needsRaw = Array.isArray(d?.needs) ? d.needs : (await api(`/api/orgs/${encodeURIComponent(orgId)}/needs`))?.needs;
      let needsRawFinal = needsRaw;

      const needsLooksScrubbed =
        Array.isArray(needsRaw) &&
        needsRaw.length > 0 &&
        needsRaw.some((n) => {
          const hasPriority = n && Object.prototype.hasOwnProperty.call(n, "priority");
          const blob = n && (n.encrypted_blob || n.encryptedBlob);
          const title = String(n && (n.title || "")).toLowerCase();
          return !hasPriority || (!blob && (title.includes("encrypted") || title === "__encrypted__" || title === "_encrypted_"));
        });

      if (needsLooksScrubbed) {
        try {
          const needsFull = await api(`/api/orgs/${encodeURIComponent(orgId)}/needs`);
          needsRawFinal = Array.isArray(needsFull?.needs) ? needsFull.needs : needsRaw;
        } catch {
          needsRawFinal = needsRaw;
        }
      }

      const meetsRaw = Array.isArray(d?.meetings) ? d.meetings : (await api(`/api/orgs/${encodeURIComponent(orgId)}/meetings`))?.meetings;
      const subsResp = Array.isArray(d?.subscribers)?{subscribers:d.subscribers}:await api(`/api/orgs/${encodeURIComponent(orgId)}/newsletter/subscribers`);
      const pledgesResp = Array.isArray(d?.pledges)?{pledges:d.pledges}:await api(`/api/orgs/${encodeURIComponent(orgId)}/pledges`);
      const publicInboxResp = Array.isArray(d?.publicInbox)?{items:d.publicInbox}:await api(`/api/orgs/${encodeURIComponent(orgId)}/public/inbox`).catch(() => ({ items: [] }));

      const pplDec = await tryDecryptList(orgId, pplRaw, "encrypted_blob");
      const invDec = await tryDecryptList(orgId, invRawFinal, "encrypted_blob");
      const needsDec = await tryDecryptList(orgId, needsRawFinal, "encrypted_blob");
      const meetsDec = await tryDecryptList(orgId, meetsRaw, "encrypted_blob");
      const subsDec = await tryDecryptList(orgId, subsResp?.subscribers || [], "encrypted_blob");
      const pledgesDec = await tryDecryptList(orgId, pledgesResp?.pledges || [], "encrypted_blob");

      setPeople(Array.isArray(pplDec) ? pplDec : []);
      setInventory(Array.isArray(invDec) ? invDec : []);
      setNeeds(Array.isArray(needsDec) ? needsDec : []);
      setMeetings(Array.isArray(meetsDec) ? meetsDec : []);
      setSubs(Array.isArray(subsDec) ? subsDec : []);
      setPledges(Array.isArray(pledgesDec) ? pledgesDec : []);
      setPublicInbox(Array.isArray(publicInboxResp?.items) ? publicInboxResp.items : Array.isArray(publicInboxResp?.submissions) ? publicInboxResp.submissions : []);

      try {
        const cn = {
          people: Number(rawCounts.people || 0),
          inventory: Number(rawCounts.inventory || 0),
          needsOpen: Number(rawCounts.needsOpen || rawCounts.needs || 0),
          meetingsUpcoming: Number(rawCounts.meetingsUpcoming || 0),
          pledgesActive: Number(rawCounts.pledgesActive || rawCounts.pledges || 0),
          publicInbox: Number(rawCounts.publicInbox || rawCounts.public_inbox || rawCounts.publicInboxOpen || 0),
          subsTotal: Number(rawCounts.subscribers || rawCounts.subs || rawCounts.subsTotal || 0),
        };
        const base = readRefreshBaseline(orgId);
        const hasBase = base && Object.keys(base).length > 0;
        const nextDeltas = {
          people: hasBase ? cn.people - Number(base.people || 0) : 0,
          inventory: hasBase ? cn.inventory - Number(base.inventory || 0) : 0,
          needsOpen: hasBase ? cn.needsOpen - Number(base.needsOpen || 0) : 0,
          meetingsUpcoming: hasBase ? cn.meetingsUpcoming - Number(base.meetingsUpcoming || 0) : 0,
          pledgesActive: hasBase ? cn.pledgesActive - Number(base.pledgesActive || 0) : 0,
          publicInbox: hasBase ? cn.publicInbox - Number(base.publicInbox || 0) : 0,
          subsTotal: hasBase ? cn.subsTotal - Number(base.subsTotal || 0) : 0,
        };
        setTickerDeltas(nextDeltas);
        writeRefreshBaseline(orgId, cn);
        appendDashHistory(orgId, { t: Date.now(), ...cn });
      } catch {}

      writePrevCounts(orgId, rawCounts);
      setHasLoadedOnce(true);
    } catch (e) {
      console.error(e);
      setErr(e?.message || "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh().catch(console.error);
  }, [orgId]);

  if (!orgId) {
    return <div style={{ padding: 16 }}>No org selected.</div>;
  }

  const go = (tab) => nav(`/org/${encodeURIComponent(orgId)}/${tab}`);

  const countsNormalized = useMemo(() => {
    const c = counts || {};
    return {
      people: Number(c.people || people.length || 0),
      inventory: Number(c.inventory || inventory.length || 0),
      needsOpen: Number(c.needsOpen || c.needs || needs.filter((n) => String(n?.status || "").toLowerCase() === "open").length || 0),
      meetingsUpcoming: Number(c.meetingsUpcoming || meetings.filter((m) => Number(m?.starts_at) > 0).length || 0),
      pledgesActive: Number(c.pledgesActive || c.pledges || pledges.length || 0),
      publicInbox: Number(c.publicInbox || c.public_inbox || c.publicInboxOpen || publicInbox.length || 0),
      subsTotal: Number(c.subscribers || c.subs || c.subsTotal || subs.length || 0),
    };
  }, [counts, people, inventory, needs, meetings, pledges, publicInbox, subs]);

  const deltas = useMemo(() => {
    const d = tickerDeltas || {};
    return {
      people: Number(d.people || 0),
      inventory: Number(d.inventory || 0),
      needsOpen: Number(d.needsOpen || 0),
      meetingsUpcoming: Number(d.meetingsUpcoming || 0),
      pledgesActive: Number(d.pledgesActive || 0),
      publicInbox: Number(d.publicInbox || 0),
      subsTotal: Number(d.subsTotal || 0),
    };
  }, [tickerDeltas]);

  const historySeries = useMemo(() => {
    const rows = readDashHistory(orgId);
    const mk = (key, fallback) => {
      const vals = rows.map((r) => Number(r?.[key] || 0)).filter((x) => Number.isFinite(x));
      if (vals.length >= 2) return vals;
      if (vals.length === 1) return [vals[0], vals[0]];
      return [Math.max(0, Number(fallback || 0)), Math.max(0, Number(fallback || 0))];
    };
    return {
      people: mk("people", countsNormalized.people),
      inventory: mk("inventory", countsNormalized.inventory),
      needsOpen: mk("needsOpen", countsNormalized.needsOpen),
      meetingsUpcoming: mk("meetingsUpcoming", countsNormalized.meetingsUpcoming),
      pledgesActive: mk("pledgesActive", countsNormalized.pledgesActive),
      publicInbox: mk("publicInbox", countsNormalized.publicInbox),
      subsTotal: mk("subsTotal", countsNormalized.subsTotal),
    };
  }, [orgId, countsNormalized]);

  const meetingsSorted = useMemo(() => {
    const arr = Array.isArray(meetings) ? meetings : [];
    return arr.filter((m) => Number(m?.starts_at) > 0).sort((a, b) => Number(a.starts_at) - Number(b.starts_at)).slice(0, 3);
  }, [meetings]);

  const needsOpen = useMemo(() => {
    const arr = Array.isArray(needs) ? needs : [];
    return arr.filter((n) => String(n?.status || "").toLowerCase() === "open").sort((a, b) => Number(b?.priority || 0) - Number(a?.priority || 0)).slice(0, 6);
  }, [needs]);

  const pledgesSorted = useMemo(() => {
    const arr = Array.isArray(pledges) ? pledges : [];
    return arr.slice().sort((a, b) => Number(b?.created_at || 0) - Number(a?.created_at || 0)).slice(0, 6);
  }, [pledges]);

  const publicInboxSorted = useMemo(() => {
    const arr = Array.isArray(publicInbox) ? publicInbox : [];
    return arr.slice().sort((a, b) => Number(b?.created_at || b?.submitted_at || 0) - Number(a?.created_at || a?.submitted_at || 0)).slice(0, 6);
  }, [publicInbox]);

  const invPar = useMemo(() => readInvPar(orgId), [orgId]);

  const invCatStats = useMemo(() => {
    const arr = Array.isArray(inventory) ? inventory : [];
    const parMap = invPar || {};
    const map = new Map();

    for (const it of arr) {
      const qtyV = Number(it?.qty);
      const qty = Number.isFinite(qtyV) ? qtyV : 0;
      const catRaw = it?.category ?? it?.cat ?? it?.Category ?? it?.CATEGORY ?? "";
      const cat = safeStr(catRaw).trim().toLowerCase() || "uncategorized";
      const id = it?.id != null ? String(it.id) : "";
      const parV = Number(parMap?.[id]);
      const par = Number.isFinite(parV) && parV > 0 ? parV : 0;
      const cur = map.get(cat) || { category: cat, qty: 0, par: 0, items: 0 };
      cur.qty += qty;
      cur.par += par;
      cur.items += 1;
      map.set(cat, cur);
    }

    const out = Array.from(map.values()).map((x) => {
      const pct = x.par > 0 ? x.qty / x.par : null;
      return { ...x, pct, pctClamped: x.par > 0 ? Math.max(0, Math.min(1, pct)) : 0 };
    });

    out.sort((a, b) => {
      const ap = a.pct == null ? 999 : a.pct;
      const bp = b.pct == null ? 999 : b.pct;
      if (ap !== bp) return ap - bp;
      return (b.qty || 0) - (a.qty || 0);
    });

    return out.slice(0, 6);
  }, [inventory, invPar]);

  const invLowItems = useMemo(() => {
    const arr = Array.isArray(inventory) ? inventory : [];
    const parMap = invPar || {};
    const lows = [];
    for (const it of arr) {
      const id = it?.id != null ? String(it.id) : "";
      const raw = parMap?.[id];
      if (raw === "" || raw == null) continue;
      const parV = Number(raw);
      const par = Number.isFinite(parV) && parV > 0 ? parV : 0;
      if (!par) continue;
      const qtyV = Number(it?.qty);
      const qty = Number.isFinite(qtyV) ? qtyV : 0;
      const pct = qty / par;
      if (pct < 1) lows.push({ id, name: it?.name, category: it?.category, qty, par, pct });
    }
    lows.sort((a, b) => a.pct - b.pct);
    return lows.slice(0, 4);
  }, [inventory, invPar]);

  async function rsvp(meeting) {
    if (!orgId || !meeting?.id) return;
    setRsvpMsg("");
    try {
      await api(`/api/orgs/${encodeURIComponent(orgId)}/meetings/${encodeURIComponent(meeting.id)}/rsvp`, { method: "POST" });
      setMeetings((prev) => prev.map((m) => (m.id === meeting.id ? { ...m, my_rsvp: "going" } : m)));
      setRsvpMsg("RSVP saved.");
    } catch (e) {
      setRsvpMsg(e?.message || "Failed to RSVP");
    }
  }

  function handleLayoutChange(_currentLayout, allLayouts) {
    if (!orgId || isNarrow) return;
    setDashLayouts(allLayouts);
    writeLayouts(orgId, allLayouts);
  }

  const cardBtnStyle = { width: "100%", textAlign: "left", border: "none", background: "transparent", padding: 0, cursor: "pointer" };

  const panelWrap = (title, button, content, className = "") => (
    <div className={`card bfDashPanel ${className}`.trim()} style={{ padding: 16 }}>
      <div className="bfDashGrab" style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <h2 style={{ margin: 0, flex: 1 }}>{title}</h2>
        {button}
      </div>
      {content}
    </div>
  );

  const topCards = useMemo(() => {
    const mk = (key, title, logo, value, sub, to) => {
      const db = deltaBadge(deltas[key]);
      return {
        key,
        title,
        logo,
        value,
        sub,
        to,
        badge: db,
        extra: (
          <div className="bf-dashboard-sparkline" style={{ marginTop: 8, borderRadius: 8, padding: "4px 6px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden", width: "100%", boxSizing: "border-box" }} title={`${title.toLowerCase()} trend`}>
            <div style={{ width: "100%", height: 18, overflow: "hidden" }}>
              <Sparkline values={historySeries[key]} width={96} height={18} />
            </div>
          </div>
        ),
      };
    };
    return [
      mk("people", "People", "/logos/people.svg", countsNormalized.people, "members", "people"),
      mk("inventory", "Inventory", "/logos/inventory.png", countsNormalized.inventory, "items", "inventory"),
      mk("needsOpen", "Needs", "/logos/needs.png", countsNormalized.needsOpen, "open", "needs"),
      mk("meetingsUpcoming", "Meetings", "/logos/meetings.png", countsNormalized.meetingsUpcoming, "upcoming", "meetings"),
      mk("pledgesActive", "Pledges", "/logos/pledges.png", countsNormalized.pledgesActive, "active", "settings?tab=pledges"),
      mk("subsTotal", "New Subs", "/logos/newsletter.svg", countsNormalized.subsTotal, "total", "settings?tab=newsletter"),
      mk("publicInbox", "Inbox", "/logos/intake.png", countsNormalized.publicInbox, "open items", "settings?tab=public-inbox"),
    ];
  }, [countsNormalized, deltas, historySeries]);

  const inboxPanel = panelWrap(
    "Inbox",
    <button className="btn" type="button" onClick={() => go("settings?tab=public-inbox")}>Manage</button>,
    publicInboxSorted.length ? (
      <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
        {publicInboxSorted.map((item) => {
          const kind = String(item?.kind || item?.type || "").toLowerCase();
          const tone = String(item?.status || "new").toLowerCase() === "closed" ? "low" : kind === "get_help" ? "urgent" : kind === "volunteer" ? "medium" : "offered";
          const title = kind === "offer_resources" ? "Offer Resources" : kind === "volunteer" ? "Volunteer" : "Get Help";
          const who = safeStr(item?.name || "anonymous");
          const contact = safeStr(item?.contact || item?.email || item?.phone || "");
          const details = safeStr(item?.details || item?.message || item?.notes || "").trim();
          const created = item?.created_at || item?.submitted_at;
          return (
            <div key={item.id || `${title}-${who}-${created}`} className="card" style={{ padding: 12 }}>
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  {pill(title, tone)}
                  <div style={{ fontWeight: 900, flex: 1, minWidth: 0 }}>{who}</div>
                </div>
                {created ? <div className="helper">{fmtDT(created)}</div> : null}
                {contact ? <div style={{ wordBreak: "break-word" }}>{contact}</div> : null}
                {details ? <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{details}</div> : null}
              </div>
            </div>
          );
        })}
      </div>
    ) : (
      <div className="helper" style={{ marginTop: 12 }}>No public inbox items yet.</div>
    )
  );

  const meetingsPanel = panelWrap(
    "Next Meetings",
    <button className="btn" type="button" onClick={() => go("meetings")}>View all</button>,
    meetingsSorted.length ? (
      <div className="bfDashMobileList" style={{ marginTop: 12, display: "grid", gap: 10 }}>
        {meetingsSorted.map((m) => (
          <div key={m.id} className="card bfDashMobileRowCard" style={{ padding: 12 }}>
            <div className="bfDashMobileRowHead" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ fontWeight: 900, flex: 1, minWidth: 0, wordBreak: "break-word" }}>
                {isEncryptedNameLike(m?.title) ? "(encrypted)" : safeStr(m?.title || "meeting")}
              </div>
              <button className="btn-red bfDashMobileAction" type="button" onClick={() => rsvp(m)}>RSVP</button>
            </div>
            <div className="helper" style={{ marginTop: 6, wordBreak: "break-word" }}>
              {fmtDT(m?.starts_at)}
              {m?.location ? ` · ${safeStr(m.location)}` : ""}
            </div>
          </div>
        ))}
      </div>
    ) : (
      <div className="helper" style={{ marginTop: 12 }}>No upcoming meetings.</div>
    ),
    "bfDashMeetingsPanel"
  );

  const inventoryPanel = panelWrap(
    "Inventory at a Glance",
    <button className="btn" type="button" onClick={() => go("inventory")}>Manage</button>,
    invCatStats.length ? (
      <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
        {invCatStats.map((x) => {
          const pct = x.par > 0 ? x.pctClamped : 0;
          const label = x.category;
          return (
            <div key={label} style={{ display: "grid", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ fontWeight: 800, flex: 1, minWidth: 0 }}>{label}</div>
                <div className="helper" style={{ whiteSpace: "nowrap" }}>{Math.round(x.qty)}{x.par ? ` / ${Math.round(x.par)}` : ""}</div>
              </div>
              <div style={{ height: 10, borderRadius: 999, background: "rgba(255,255,255,0.10)", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${pct * 100}%`, background: pct <= 0.25 ? "#ff4d4d" : pct <= 0.5 ? "#ff9a3c" : "#39d98a" }} />
              </div>
            </div>
          );
        })}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6, gap: 10, flexWrap: "wrap" }}>
          <div className="helper" style={{ width: "100%" }}>
            {invLowItems.length ? (
              <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: isNarrow ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                {invLowItems.map((item) => (
                  <div key={item.id}>
                    <div style={{ fontWeight: 600, wordBreak: "break-word" }}>{item.name} {item.qty} / {item.par}</div>
                    <div style={{ fontSize: 12, opacity: 0.7, wordBreak: "break-word" }}>{item.category}</div>
                    <div style={{ height: 6, background: "#2a2a2a", borderRadius: 4, overflow: "hidden", marginTop: 4 }}>
                      <div style={{ width: `${Math.min(100, (item.qty / item.par) * 100)}%`, background: item.qty <= item.par * 0.25 ? "#e11d48" : item.qty <= item.par * 0.5 ? "#f97316" : "#22c55e", height: "100%" }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <span>No low items below par.</span>
            )}
          </div>
        </div>
      </div>
    ) : (
      <div className="helper" style={{ marginTop: 12 }}>No inventory yet.</div>
    )
  );

  const needsPanel = panelWrap(
    "Open Needs",
    <button className="btn" type="button" onClick={() => go("needs")}>View all</button>,
    needsOpen.length ? (
      <div className="bfDashMobileList" style={{ marginTop: 12, display: "grid", gap: 10 }}>
        {needsOpen.map((n) => {
          const pr = Number(n?.priority || 0);
          const urgency = String(n?.urgency || "").toLowerCase();
          const tone = urgency === "urgent" ? "urgent" : pr >= 8 ? "high" : pr >= 4 ? "medium" : "low";
          const title = isEncryptedNameLike(n?.title) ? "(encrypted)" : safeStr(n?.title || "need");
          return (
            <button key={n.id} type="button" className="card bfDashMobileRowCard" style={{ padding: 12, textAlign: "left", border: "none", cursor: "pointer" }} onClick={() => go("needs")}>
              <div style={{ display: "grid", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  {pill(tone.toUpperCase(), tone)}
                  <div style={{ fontWeight: 900, flex: 1, minWidth: 0, wordBreak: "break-word" }}>{title}</div>
                </div>
                <div className="helper" style={{ wordBreak: "break-word" }}>{urgency ? `${urgency}` : "open"} · priority {pr}</div>
              </div>
            </button>
          );
        })}
      </div>
    ) : (
      <div className="helper" style={{ marginTop: 12 }}>No open needs.</div>
    ),
    "bfDashNeedsPanel"
  );

  const pledgesPanel = panelWrap(
    "Recent Pledges",
    <button className="btn" type="button" onClick={() => go("settings?tab=pledges")}>View all</button>,
    pledgesSorted.length ? (
      <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
        {pledgesSorted.map((p) => {
          const status = String(p?.status || "").toLowerCase();
          const tone = status === "accepted" ? "accepted" : status === "offered" ? "offered" : "low";
          const who = isEncryptedNameLike(p?.pledger_name) ? "someone" : safeStr(p?.pledger_name || "someone");
          const type = safeStr(p?.type || "").trim();
          const amt = p?.amount != null && p?.amount !== "" ? `${p.amount}` : "";
          const unit = safeStr(p?.unit || "").trim();
          const when = fmtDT(p?.created_at);
          return (
            <div key={p.id} style={{ display: "grid", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                {pill(status || "pledge", tone)}
                <div style={{ fontWeight: 900, flex: 1, minWidth: 0, wordBreak: "break-word" }}>{who}{type ? ` · ${type}` : ""}</div>
              </div>
              <div className="helper" style={{ wordBreak: "break-word" }}>{amt ? `${amt}${unit ? ` ${unit}` : ""} · ` : ""}{when}</div>
            </div>
          );
        })}
      </div>
    ) : (
      <div className="helper" style={{ marginTop: 12 }}>No pledges yet.</div>
    )
  );

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          {err ? <div className="helper" style={{ color: "tomato" }}>{err}</div> : null}
          {rsvpMsg ? <div className="helper" style={{ marginTop: err ? 6 : 0 }}>{rsvpMsg}</div> : null}
        </div>
      </div>

      <OrgKeyBackupNudge orgId={orgId} />

      <div className="bfTopMetricsRow">
        {!hasLoadedOnce && loading ? (
          <>
            {Array.from({ length: 7 }).map((_, i) => <div key={i}><MetricCardSkeleton /></div>)}
          </>
        ) : (
          topCards.map((c) => (
            <button key={c.key} type="button" style={cardBtnStyle} onClick={() => go(c.to)}>
              <div className="card bfDashCard" style={{ padding: 14, position: "relative", minHeight: 118, overflow: "hidden" }}>
                {c.badge ? <div style={{ position: "absolute", top: 12, right: 12 }}><span className="bf-delta-pill" style={c.badge.style}>{c.badge.txt}</span></div> : null}
                <div style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 54 }}>
                  <ModuleLogo src={c.logo} label={c.title} />
                  <div style={{ fontWeight: 900, fontSize: 15 }}>{c.title}</div>
                </div>
                <div style={{ marginTop: 10, fontSize: 34, fontWeight: 900, lineHeight: 1 }}>{c.value}</div>
                <div className="helper" style={{ marginTop: 6 }}>{c.sub}</div>
                {c.extra}
              </div>
            </button>
          ))
        )}
      </div>

      {loading && !hasLoadedOnce ? (
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12, alignItems: "start" }}>
          <SectionCardSkeleton rows={2} />
          <SectionCardSkeleton rows={3} />
          <SectionCardSkeleton rows={3} />
          <SectionCardSkeleton rows={3} />
          <SectionCardSkeleton rows={3} />
        </div>
      ) : isNarrow ? (
        <div className="bfDashMobileStack">
          {inboxPanel}
          {meetingsPanel}
          {inventoryPanel}
          {needsPanel}
          {pledgesPanel}
        </div>
      ) : (
        <div ref={gridWrapRef} className="bfDashGridWrap">
          {gridWidth > 0 ? (
            <Responsive
              className="layout"
              width={gridWidth}
              layouts={dashLayouts}
              breakpoints={{ lg: 1200, md: 996, sm: 0 }}
              cols={{ lg: 14, md: 12, sm: 1 }}
              rowHeight={34}
              margin={[12, 12]}
              containerPadding={[0, 0]}
              isDraggable={!isNarrow}
              isResizable={!isNarrow}
              draggableHandle=".bfDashGrab"
              onLayoutChange={handleLayoutChange}
              compactType="vertical"
              preventCollision={false}
              measureBeforeMount={false}
              useCSSTransforms={true}
            >
              <div key="inbox">{inboxPanel}</div>
              <div key="meetings">{meetingsPanel}</div>
              <div key="inventory">{inventoryPanel}</div>
              <div key="needs">{needsPanel}</div>
              <div key="pledges">{pledgesPanel}</div>
            </Responsive>
          ) : null}
        </div>
      )}
    </div>
  );
}
