// src/pages/BondfireChat.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  createClient,
  IndexedDBStore,
  IndexedDBCryptoStore,
} from "matrix-js-sdk";

import {
  CryptoEvent,
  VerifierEvent,
  canAcceptVerificationRequest,
} from "matrix-js-sdk/lib/crypto-api";

const GLOBAL_MATRIX_KEY = "__bf_matrix_client__";
const MATRIX_SESSION_KEY = "bf_matrix_session";

function globalMatrixKey() {
  return GLOBAL_MATRIX_KEY;
}

function getGlobalMatrix() {
  try {
    return window[globalMatrixKey()] || null;
  } catch {
    return null;
  }
}

function setGlobalMatrix(v) {
  try {
    window[globalMatrixKey()] = v;
  } catch {}
}

function clearGlobalMatrix() {
  try {
    delete window[globalMatrixKey()];
  } catch {
    try {
      window[globalMatrixKey()] = null;
    } catch {}
  }
}

function readJSON(key, fallback = null) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function removeKey(key) {
  try {
    localStorage.removeItem(key);
  } catch {}
}

function parseOrgIdFromHash() {
  const m = (window.location.hash || "").match(/#\/org\/([^/]+)/i);
  return m ? decodeURIComponent(m[1]) : null;
}

function sanitizeForIdb(s) {
  return String(s || "").replace(/[^a-zA-Z0-9._=-]/g, "_");
}

function verifiedKeyFor(userId, deviceId) {
  const u = sanitizeForIdb(userId);
  const d = sanitizeForIdb(deviceId);
  return `bf_mx_verified_${u}_${d}`;
}


function getStoredOrgMeta(orgId) {
  try {
    const orgs = JSON.parse(localStorage.getItem("bf_orgs") || "[]");
    const settings = JSON.parse(localStorage.getItem(`bf_org_settings_${orgId}`) || "{}");
    const org = Array.isArray(orgs) ? orgs.find((x) => x?.id === orgId) || {} : {};
    return {
      id: String(orgId || "").trim(),
      name: String(settings?.name || org?.name || "").trim(),
      slug: String(settings?.slug || org?.slug || "").trim(),
    };
  } catch {
    return { id: String(orgId || "").trim(), name: "", slug: "" };
  }
}

function roomMatchesOrg(room, orgMeta) {
  if (!room) return false;

  const haystack = [
    room?.name,
    room?.id,
    room?.canonicalAlias,
    ...(Array.isArray(room?.altAliases) ? room.altAliases : []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const rawTokens = [orgMeta?.id, orgMeta?.slug, orgMeta?.name]
    .filter(Boolean)
    .flatMap((value) =>
      String(value)
        .toLowerCase()
        .split(/[^a-z0-9]+/i)
        .filter(Boolean)
    );

  const tokens = [...new Set(rawTokens.filter((t) => t.length >= 3))];
  if (!tokens.length) return true;

  return tokens.some((token) => haystack.includes(token));
}

function readSavedSession(orgId) {
  const globalSaved = readJSON(MATRIX_SESSION_KEY, null);
  if (globalSaved) return globalSaved;

  const orgSaved = readJSON(`bf_matrix_${orgId}`, null);
  if (orgSaved) {
    writeJSON(MATRIX_SESSION_KEY, orgSaved);
    return orgSaved;
  }

  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith("bf_matrix_")) continue;
      const legacy = readJSON(key, null);
      if (legacy?.userId && legacy?.accessToken) {
        writeJSON(MATRIX_SESSION_KEY, legacy);
        return legacy;
      }
    }
  } catch {}

  return null;
}

function legibleNow() {
  return new Date().toLocaleTimeString();
}
const ts = legibleNow;

function safeIdForEvent(ev) {
  return ev?.getId?.() || `${ev?.getSender?.() || "?"}:${ev?.getTs?.() || Date.now()}`;
}

function eventToMsg(ev, room = null) {
  const content = ev?.getContent?.() || {};
  const body = content?.body;
  const msgtype = content?.msgtype;
  const wireType = ev?.getWireType?.() || ev?.event?.type || "";

  const undecryptable =
    !!ev?.isDecryptionFailure?.() ||
    msgtype === "m.bad.encrypted" ||
    (typeof body === "string" && /unable to decrypt|decryptionerror/i.test(body));

  const encrypted =
    !!ev?.isEncrypted?.() ||
    wireType === "m.room.encrypted" ||
    !!room?.isEncrypted?.();

  return {
    id: safeIdForEvent(ev),
    body: typeof body === "string" ? body : "",
    sender: ev?.getSender?.() || "",
    ts: ev?.getTs?.() || Date.now(),
    encrypted,
    undecryptable,
    msgtype: msgtype || "",
  };
}

function normalizeMxid(u) {
  const s = String(u || "").trim();
  if (!s) return "";
  const parts = s.split(":");
  if (parts.length <= 2) return s;
  return `${parts[0]}:${parts[1]}`;
}

async function deleteIDB(name) {
  try {
    if (!name || !window.indexedDB) return;
    await new Promise((resolve) => {
      const req = window.indexedDB.deleteDatabase(name);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
      req.onblocked = () => resolve(false);
    });
  } catch {}
}

async function nukeMatrixIdbForUser(userId) {
  const uidSafe = sanitizeForIdb(userId);
  if (!uidSafe) return;

  const names = new Set([
    `bf_mx_store_${uidSafe}`,
    `bf_mx_crypto_${uidSafe}`,
  ]);

  try {
    if (window.indexedDB?.databases) {
      const dbs = await window.indexedDB.databases();
      for (const db of dbs || []) {
        const name = db?.name || "";
        if (!name) continue;
        const legacyMatch =
          (name.startsWith("bf_mx_store_") || name.startsWith("bf_mx_crypto_")) &&
          name.includes(uidSafe);
        if (legacyMatch) names.add(name);
      }
    }
  } catch {}

  for (const n of names) {
    await deleteIDB(n);
  }
}

async function detectCryptoReady(client) {
  try {
    const crypto = client?.getCrypto?.();
    if (!crypto) return false;

    if (typeof crypto.isCryptoEnabled === "function") {
      return !!crypto.isCryptoEnabled();
    }

    if (typeof crypto.getOwnDeviceKeys === "function") {
      const keys = await crypto.getOwnDeviceKeys();
      return !!keys;
    }

    return true;
  } catch {
    return false;
  }
}

async function getDeviceVerifiedTruth(client) {
  try {
    const crypto = client?.getCrypto?.();
    const uid = client?.getUserId?.();
    const did = client?.getDeviceId?.();
    if (!crypto || !uid || !did) return null;

    if (typeof crypto.getDeviceVerificationStatus === "function") {
      const res = await crypto.getDeviceVerificationStatus(uid, did);
      if (res === true) return true;
      if (res === false) return false;
      if (res && typeof res === "object") {
        if (res.isVerified === true) return true;
        if (res.verified === true) return true;
        if (res.isCrossSigningVerified === true) return true;
        if (res.isVerified === false) return false;
        if (res.verified === false) return false;
      }
    }

    if (typeof crypto.getDeviceVerification === "function") {
      const res = await crypto.getDeviceVerification(uid, did);
      if (res === true) return true;
      if (res === false) return false;
      if (res && typeof res === "object") {
        if (res.verified === true) return true;
        if (res.isVerified === true) return true;
        if (res.verified === false) return false;
        if (res.isVerified === false) return false;
      }
    }

    return null;
  } catch {
    return null;
  }
}

export default function BondfireChat() {
  const params = useParams();
  const orgId = params.orgId || parseOrgIdFromHash();

  const savedRaw = readSavedSession(orgId);
  const saved = savedRaw
    ? { ...savedRaw, userId: normalizeMxid(savedRaw.userId) }
    : null;

  if (savedRaw?.userId && saved?.userId && savedRaw.userId !== saved.userId) {
    writeJSON(MATRIX_SESSION_KEY, saved);
  }

  const HS_DEFAULT = "https://matrix-client.matrix.org";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const [userId, setUserId] = useState(saved?.userId || "");
  const [accessToken, setAccessToken] = useState(saved?.accessToken || "");
  const [deviceId, setDeviceId] = useState(saved?.deviceId || "");
  const [status, setStatus] = useState("");
  const [ready, setReady] = useState(false);
  const [cryptoReady, setCryptoReady] = useState(false);
  const [deviceVerified, setDeviceVerified] = useState(() => {
    const k = verifiedKeyFor(saved?.userId || "", saved?.deviceId || "");
    return k ? !!readJSON(k, false) : false;
  });

  const [verificationReq, setVerificationReq] = useState(null);
  const [sasData, setSasData] = useState(null);
  const [verifyMsg, setVerifyMsg] = useState("");

  const [rooms, setRooms] = useState([]);
  const [activeRoomId, setActiveRoomId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [msg, setMsg] = useState("");

  const [memberCache, setMemberCache] = useState({});
  const [hideUndecryptable, setHideUndecryptable] = useState(
    readJSON(`bf_chat_hide_undecryptable_${orgId}`, true)
  );
  const [newestFirst, setNewestFirst] = useState(
    readJSON(`bf_chat_newest_first_${orgId}`, false)
  );

  const clientRef = useRef(null);
  const verifierRef = useRef(null);
  const activeRoomIdRef = useRef(null);
  const stoppedRef = useRef(false);

  const log = (...a) => setStatus(`[${ts()}] ${a.join(" ")}`);

  useEffect(() => {
    writeJSON(`bf_chat_hide_undecryptable_${orgId}`, hideUndecryptable);
  }, [orgId, hideUndecryptable]);

  useEffect(() => {
    writeJSON(`bf_chat_newest_first_${orgId}`, newestFirst);
  }, [orgId, newestFirst]);

  useEffect(() => {
    activeRoomIdRef.current = activeRoomId;
  }, [activeRoomId]);

  useEffect(() => {
    if (!rooms.length) {
      if (activeRoomId) {
        setActiveRoomId(null);
        setMessages([]);
      }
      return;
    }

    const stillVisible = rooms.some((r) => r.id === activeRoomId);
    if (!stillVisible) {
      selectRoom(rooms[0].id);
    }
  }, [rooms]);

  const cleanupVerification = (finalMsg = "") => {
    setSasData(null);
    setVerificationReq(null);
    verifierRef.current = null;
    if (finalMsg) {
      setVerifyMsg(finalMsg);
      setTimeout(() => setVerifyMsg(""), 1400);
    } else {
      setVerifyMsg("");
    }
  };

  const markThisDeviceVerified = React.useCallback(() => {
    try {
      const uidKey = clientRef.current?.getUserId?.() || saved?.userId || userId || "";
      const didKey = clientRef.current?.getDeviceId?.() || saved?.deviceId || deviceId || "";
      const k = verifiedKeyFor(uidKey, didKey);
      setDeviceVerified(true);
      if (k) writeJSON(k, true);
    } catch {
      setDeviceVerified(true);
    }
  }, [saved?.userId, saved?.deviceId, userId, deviceId]);

  const refreshRooms = React.useCallback(() => {
    const client = clientRef.current;
    if (!client) return;
    try {
      const visible = client.getVisibleRooms?.() || [];
      let rs = visible
        .filter((r) => ["join", "invite"].includes(r.getMyMembership()))
        .sort(
          (a, b) =>
            (b.getLastActiveTimestamp?.() || 0) - (a.getLastActiveTimestamp?.() || 0)
        );

      if (!rs.length && typeof client.getRooms === "function") {
        rs = (client.getRooms() || [])
          .filter((r) => ["join", "invite"].includes(r.getMyMembership?.()))
          .sort(
            (a, b) =>
              (b.getLastActiveTimestamp?.() || 0) - (a.getLastActiveTimestamp?.() || 0)
          );
      }

      const orgMeta = getStoredOrgMeta(orgId);
      const mapped = rs.map((r) => ({
        id: r.roomId,
        name: r.name || r.getCanonicalAlias?.() || r.roomId,
        canonicalAlias: r.getCanonicalAlias?.() || "",
        altAliases: typeof r.getAltAliases === "function" ? r.getAltAliases() || [] : [],
        encrypted: !!r.isEncrypted?.(),
      }));

      const filtered = mapped.filter((r) => roomMatchesOrg(r, orgMeta));

      setRooms(filtered.length ? filtered : mapped);
    } catch {}
  }, [orgId]);

  const refreshVerificationTruth = React.useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;

    try {
      const crypto = client.getCrypto?.();
      if (!crypto) {
        setCryptoReady(false);
        return;
      }
    } catch {
      setCryptoReady(false);
      return;
    }

    const cryptoOk = await detectCryptoReady(client);
    setCryptoReady(cryptoOk);

    const truth = await getDeviceVerifiedTruth(client);
    if (truth === true) {
      setDeviceVerified(true);
      try {
        const k = verifiedKeyFor(client.getUserId?.(), client.getDeviceId?.());
        if (k) writeJSON(k, true);
      } catch {}
    } else if (truth === false) {
      setDeviceVerified(false);
    }
  }, []);

  function cacheMember(roomId, mxid, info) {
    setMemberCache((prev) => {
      const r = prev[roomId] || {};
      const existing = r[mxid] || {};
      const next = { ...existing, ...info };
      if (existing.name === next.name && existing.avatarUrl === next.avatarUrl) {
        return prev;
      }
      return { ...prev, [roomId]: { ...r, [mxid]: next } };
    });
  }

  function getMemberInfo(roomId, mxid) {
    const cached = memberCache?.[roomId]?.[mxid];
    if (cached) return cached;

    const client = clientRef.current;
    if (!client) return { name: mxid, avatarUrl: "" };

    try {
      const room = client.getRoom(roomId);
      const m = room?.getMember?.(mxid);
      const name = m?.name || mxid;

      let avatarUrl = "";
      const mxc = m?.getMxcAvatarUrl?.() || m?.events?.member?.getContent?.()?.avatar_url;
      if (mxc && typeof client.mxcUrlToHttp === "function") {
        avatarUrl = client.mxcUrlToHttp(mxc, 48, 48, "crop") || "";
      }

      const info = { name, avatarUrl };
      cacheMember(roomId, mxid, info);
      return info;
    } catch {
      return { name: mxid, avatarUrl: "" };
    }
  }

  const persistSessionFromClient = React.useCallback((client) => {
    try {
      if (!client) return;
      const next = {
        hsUrl: saved?.hsUrl || HS_DEFAULT,
        userId: normalizeMxid(client.getUserId?.() || saved?.userId || userId || ""),
        accessToken: saved?.accessToken || accessToken || "",
        deviceId: client.getDeviceId?.() || saved?.deviceId || deviceId || "",
      };
      if (!next.userId || !next.accessToken) return;
      writeJSON(MATRIX_SESSION_KEY, next);
      setGlobalMatrix({
        ...(getGlobalMatrix() || {}),
        client,
        baseUrl: next.hsUrl,
        userId: next.userId,
        accessToken: next.accessToken,
        deviceId: next.deviceId,
      });
      if (next.deviceId) setDeviceId(next.deviceId);
    } catch {}
  }, [saved?.hsUrl, saved?.userId, saved?.accessToken, saved?.deviceId, userId, accessToken, deviceId]);

  useEffect(() => {
    if (!saved?.hsUrl || !saved?.userId || !saved?.accessToken) return;
    if (clientRef.current) return;

    stoppedRef.current = false;

    const baseUrl = saved.hsUrl;
    const uid = saved.userId;
    const token = saved.accessToken;
    const did = saved.deviceId || "";
    const uidSafe = sanitizeForIdb(uid);

    setUserId(uid);
    setAccessToken(token);
    setDeviceId(did);

    let client = null;
    let store = null;
    let cryptoStore = null;

    const g = getGlobalMatrix();
    const sameDevice = !did || (g?.deviceId || "") === did;
    const canReuse = !!(
      g &&
      g.client &&
      g.baseUrl === baseUrl &&
      g.userId === uid &&
      g.accessToken === token &&
      sameDevice
    );

    if (canReuse) {
      client = g.client;
      if (!did && g?.deviceId) setDeviceId(g.deviceId);
      persistSessionFromClient(client);
      log("Connected (resumed)");
    } else {
      store = new IndexedDBStore({
        indexedDB: window.indexedDB,
        localStorage: window.localStorage,
        dbName: `bf_mx_store_${uidSafe}`,
      });

      cryptoStore = new IndexedDBCryptoStore(
        window.indexedDB,
        `bf_mx_crypto_${uidSafe}`
      );

      client = createClient({
        baseUrl,
        accessToken: token,
        userId: uid,
        deviceId: did || undefined,
        store,
        cryptoStore,
      });

      setGlobalMatrix({
        client,
        baseUrl,
        userId: uid,
        accessToken: token,
        deviceId: did,
      });

      log("Connecting…");
    }

    clientRef.current = client;

    function onTimeline(ev, room, toStartOfTimeline) {
      if (stoppedRef.current) return;
      if (toStartOfTimeline) return;
      if (ev?.getType?.() !== "m.room.message") return;

      const current = activeRoomIdRef.current;
      if (!current || room?.roomId !== current) return;

      const m = eventToMsg(ev, room);
      setMessages((prev) => {
        if (prev.some((x) => x.id === m.id)) return prev;
        return [...prev, m];
      });
    }

    function onVerificationReq(req) {
      setVerificationReq(req);
      setSasData(null);
      setVerifyMsg("");
      log("Verification request from", req.otherUserId, req.otherDeviceId);
      req.on?.("change", () => {
        setVerificationReq(req);
      });
    }

    function onSync(state) {
      if (state === "PREPARED") {
        persistSessionFromClient(client);
        setReady(true);
        setStatus("Connected");
        refreshRooms();
        refreshVerificationTruth();
      }
    }

    function onRoomUpdate() {
      refreshRooms();
    }

    (async () => {
      if (!canReuse) {
        try {
          await store.startup();
        } catch (e) {
          log("Store startup failed:", e?.message || e);
        }

        try {
          if (typeof client.initRustCrypto === "function") {
            await client.initRustCrypto();
            persistSessionFromClient(client);
            setCryptoReady(true);
          } else if (typeof client.initCrypto === "function") {
            await client.initCrypto();
            persistSessionFromClient(client);
            setCryptoReady(true);
          } else {
            setCryptoReady(false);
            log("Crypto init not available");
          }
        } catch (e) {
          setCryptoReady(false);
          log("Crypto init failed:", e?.message || e);
        }
      } else {
        const okCrypto = await detectCryptoReady(client);
        setCryptoReady(okCrypto);
        if (!okCrypto) {
          log("Crypto not ready on resumed client. Use Reset Matrix storage.");
        }
      }

      persistSessionFromClient(client);
      refreshRooms();
      refreshVerificationTruth();

      try {
        const crypto = client.getCrypto?.();
        const myUid = client.getUserId?.() || uid;
        const pending = crypto?.getVerificationRequestsToDeviceInProgress?.(myUid);
        if (pending && pending.length) onVerificationReq(pending[0]);
      } catch {}

      client.on("sync", onSync);
      client.on(CryptoEvent.VerificationRequestReceived, onVerificationReq);
      client.on("Room.timeline", onTimeline);
      client.on?.("Room", onRoomUpdate);
      client.on?.("Room.name", onRoomUpdate);
      client.on?.("Room.myMembership", onRoomUpdate);

      if (!canReuse) client.startClient({ initialSyncLimit: 30 });
    })();

    return () => {
      stoppedRef.current = true;
      try {
        client.removeListener?.("sync", onSync);
        client.removeListener?.(CryptoEvent.VerificationRequestReceived, onVerificationReq);
        client.removeListener?.("Room.timeline", onTimeline);
        client.removeListener?.("Room", onRoomUpdate);
        client.removeListener?.("Room.name", onRoomUpdate);
        client.removeListener?.("Room.myMembership", onRoomUpdate);
      } catch {}
      clientRef.current = null;
    };
  }, [
    orgId,
    saved?.hsUrl,
    saved?.userId,
    saved?.accessToken,
    saved?.deviceId,
    refreshRooms,
    refreshVerificationTruth,
    persistSessionFromClient,
  ]);

  useEffect(() => {
    function onVis() {
      if (document.visibilityState === "visible") {
        refreshRooms();
        refreshVerificationTruth();
      }
    }
    window.addEventListener("focus", onVis);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("focus", onVis);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refreshRooms, refreshVerificationTruth]);

  async function requestOwnVerification() {
    const client = clientRef.current;
    if (!client) return;
    try {
      setVerifyMsg("");
      const crypto = client.getCrypto?.();
      if (!crypto?.requestOwnUserVerification) {
        setVerifyMsg(
          "This Matrix build can't request verification (missing requestOwnUserVerification). Use another client to initiate."
        );
        return;
      }
      const req = await crypto.requestOwnUserVerification();
      setVerificationReq(req);
      setSasData(null);
      setVerifyMsg("Verification request sent. Accept it on your other device, then click Start SAS.");
    } catch (e) {
      setVerifyMsg(e?.message || String(e));
    }
  }

  function checkPendingVerification() {
    const client = clientRef.current;
    if (!client) return;
    try {
      const crypto = client.getCrypto?.();
      const myUid = client.getUserId?.() || saved?.userId || userId;
      const pending = crypto?.getVerificationRequestsToDeviceInProgress?.(myUid) || [];
      if (pending.length) {
        setVerificationReq(pending[0]);
        setVerifyMsg("Found an in-progress verification. Continue below.");
      } else {
        setVerifyMsg("No in-progress verification found.");
      }
    } catch (e) {
      setVerifyMsg(e?.message || String(e));
    }
  }

  async function acceptVerification() {
    const req = verificationReq;
    if (!req) return;
    try {
      if (!canAcceptVerificationRequest(req)) {
        setVerifyMsg("Cannot accept: request already in progress.");
        return;
      }
      await req.accept();
      setVerifyMsg("Accepted. Now click Start SAS.");
    } catch (e) {
      setVerifyMsg(e?.message || String(e));
    }
  }

  async function startSas() {
    const req = verificationReq;
    if (!req) return;
    if (verifierRef.current) {
      setVerifyMsg("SAS already started. Use Confirm or Doesn’t match.");
      return;
    }

    try {
      setVerifyMsg("");
      setSasData(null);

      const verifier = await req.startVerification("m.sas.v1");
      verifierRef.current = verifier;

      verifier.on(VerifierEvent.ShowSas, (sas) => {
        const payload = sas?.sas || {};
        const emoji = Array.isArray(payload.emoji)
          ? payload.emoji
              .map((e) => {
                if (Array.isArray(e)) return [e[0], e[1]];
                if (e && typeof e === "object") return [e.emoji, e.description || e.name];
                return null;
              })
              .filter((pair) => Array.isArray(pair) && pair[0])
          : null;

        const decimal = payload.decimal ? payload.decimal : null;

        setSasData({
          emoji,
          decimal,
          confirm: sas.confirm,
          mismatch: sas.mismatch,
        });
      });

      verifier.on(VerifierEvent.Done, () => {
        markThisDeviceVerified();
        cleanupVerification("Verified ✅");
      });

      verifier.on(VerifierEvent.Cancel, (e) => {
        cleanupVerification(`Cancelled: ${e?.reason || "unknown"}`);
      });

      verifier.on?.("change", () => {
        try {
          if (typeof verifier.isDone === "function" && verifier.isDone()) {
            markThisDeviceVerified();
            cleanupVerification("Verified ✅");
          }
        } catch {}
      });

      await verifier.verify();
    } catch (e) {
      verifierRef.current = null;
      setVerifyMsg(e?.message || String(e));
    }
  }

  async function confirmSas() {
    try {
      await sasData?.confirm?.();
      setVerifyMsg("Confirmed. Waiting for other device…");
      setTimeout(() => {
        if (verifierRef.current) markThisDeviceVerified();
        cleanupVerification("Verified ✅");
      }, 6500);
    } catch (e) {
      setVerifyMsg(e?.message || String(e));
    }
  }

  async function mismatchSas() {
    try {
      await sasData?.mismatch?.();
      cleanupVerification("Mismatch sent.");
    } catch (e) {
      setVerifyMsg(e?.message || String(e));
    }
  }

  const loggedIn = !!(saved?.hsUrl && saved?.userId && saved?.accessToken);

  const login = async (e) => {
    e.preventDefault();
    try {
      const baseUrl = HS_DEFAULT;
      const localpart = username.trim();
      const temp = createClient({ baseUrl });
      const res = await temp.login("m.login.password", {
        identifier: { type: "m.id.user", user: localpart },
        password,
      });

      const next = {
        hsUrl: baseUrl,
        userId: normalizeMxid(res.user_id),
        accessToken: res.access_token,
        deviceId: res.device_id || "",
      };

        writeJSON(MATRIX_SESSION_KEY, next);
      try { removeKey(`bf_matrix_${orgId}`); } catch {}

      setUserId(next.userId);
      setAccessToken(next.accessToken);
      setDeviceId(next.deviceId);

      setPassword("");
      window.location.hash = window.location.hash;
    } catch (err) {
      log("Login failed:", err?.message || "Unknown error");
    }
  };

  const logout = async () => {
    removeKey(MATRIX_SESSION_KEY);
    try { removeKey(`bf_matrix_${orgId}`); } catch {}

    try {
      const k = verifiedKeyFor(saved?.userId || userId || "", saved?.deviceId || deviceId || "");
      if (k) removeKey(k);
    } catch {}

    setDeviceVerified(false);

    const client = clientRef.current;
    clientRef.current = null;

    try {
      if (client) {
        try { client.stopClient?.(); } catch {}
        try { client.removeAllListeners?.(); } catch {}
      }
    } catch {}

    clearGlobalMatrix();

    setUserId("");
    setAccessToken("");
    setDeviceId("");
    setReady(false);
    setCryptoReady(false);
    setRooms([]);
    setActiveRoomId(null);
    setMessages([]);
    setMsg("");
    cleanupVerification("");

    log("Logged out");
  };

  const resetMatrixStorage = async () => {
    const uid = saved?.userId || userId || "";
    const client = clientRef.current;

    try {
      client?.stopClient?.();
      client?.removeAllListeners?.();
    } catch {}

    clientRef.current = null;
    clearGlobalMatrix();

    removeKey(MATRIX_SESSION_KEY);
    try { removeKey(`bf_matrix_${orgId}`); } catch {}
    try {
      const k = verifiedKeyFor(uid, saved?.deviceId || deviceId || "");
      if (k) removeKey(k);
    } catch {}

    await nukeMatrixIdbForUser(uid);

    setReady(false);
    setCryptoReady(false);
    setRooms([]);
    setActiveRoomId(null);
    setMessages([]);
    setMsg("");
    cleanupVerification("");
    setDeviceVerified(false);

    window.location.replace(window.location.href);
  };

  const selectRoom = async (roomId) => {
    setActiveRoomId(roomId);
    setMessages([]);

    const client = clientRef.current;
    if (!client) return;

    const room = client.getRoom(roomId);
    if (!room) return;

    try {
      const members = room.getJoinedMembers?.() || [];
      members.forEach((m) => {
        const mxid = m?.userId;
        if (!mxid) return;

        let avatarUrl = "";
        const mxc = m?.getMxcAvatarUrl?.() || m?.events?.member?.getContent?.()?.avatar_url;
        if (mxc && typeof client.mxcUrlToHttp === "function") {
          avatarUrl = client.mxcUrlToHttp(mxc, 48, 48, "crop") || "";
        }

        cacheMember(roomId, mxid, { name: m?.name || mxid, avatarUrl });
      });
    } catch {}

    const tl = room.getLiveTimeline?.();
    const evs = (tl?.getEvents?.() || []).filter((e) => e.getType?.() === "m.room.message");
    const mapped = evs.map((ev) => eventToMsg(ev, room));
    setMessages(mapped);
  };

  const send = async (e) => {
    e.preventDefault();
    const client = clientRef.current;
    if (!client || !activeRoomId || !msg.trim()) return;

    const body = msg.trim();
    setMsg("");

    const optimistic = {
      id: `local:${Date.now()}:${Math.random().toString(16).slice(2)}`,
      body,
      sender: saved?.userId || userId || "",
      ts: Date.now(),
      encrypted: true,
      undecryptable: false,
    };
    setMessages((prev) => [...prev, optimistic]);

    try {
      await client.sendEvent(
        activeRoomId,
        "m.room.message",
        { msgtype: "m.text", body },
        ""
      );
    } catch (err) {
      log("Send failed:", err?.message || "Unknown error");
    }
  };

  const currentRoom = useMemo(
    () => rooms.find((r) => r.id === activeRoomId) || null,
    [rooms, activeRoomId]
  );

  const shownMessages = useMemo(() => {
    const base = hideUndecryptable ? messages.filter((m) => !m.undecryptable) : messages;
    const sorted = [...base].sort((a, b) => a.ts - b.ts);
    return newestFirst ? sorted.reverse() : sorted;
  }, [messages, hideUndecryptable, newestFirst]);

  const deviceLock = !cryptoReady ? "🟡" : deviceVerified ? "🔒" : "🔓";

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 16 }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginTop: 0,
          borderBottom: "1px solid #222",
          paddingBottom: 12,
        }}
      >
        <button className="btn" onClick={logout}>
          Logout
        </button>
        <button className="btn" onClick={resetMatrixStorage}>
          Reset Matrix storage
        </button>
        <div className="helper" style={{ marginLeft: "auto" }}>
          {status}
        </div>
      </header>

      {loggedIn && (
        <div className="helper" style={{ marginTop: 8 }}>
          <strong>Signed in as:</strong> {saved?.userId || userId} ·{" "}
          <strong>Device:</strong> {saved?.deviceId || deviceId || "(loading)"} {deviceLock}
        </div>
      )}

      {loggedIn && (
        <div className="card" style={{ padding: 12, marginTop: 12 }}>
          <h3 className="section-title" style={{ marginTop: 0 }}>
            Verify this session
          </h3>

          {!cryptoReady ? (
            <div className="helper">
              Crypto isn’t ready yet, so verification can’t start.
            </div>
          ) : deviceVerified && !verificationReq ? (
            <>
              <div className="helper">
                This device is verified for this account. You should be able to read and send E2EE messages in encrypted rooms. 🔒
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                <button className="btn" onClick={requestOwnVerification}>
                  Re-verify (optional)
                </button>
              </div>
            </>
          ) : verificationReq ? (
            <>
              <div className="helper">
                From: {verificationReq.otherUserId} · {verificationReq.otherDeviceId}
              </div>

              {sasData?.emoji || sasData?.decimal ? (
                <>
                  {sasData.emoji ? (
                    <div
                      style={{
                        display: "flex",
                        gap: 12,
                        flexWrap: "wrap",
                        alignItems: "center",
                        marginTop: 12,
                      }}
                    >
                      {sasData.emoji.map(([emoji, name], i) => (
                        <div
                          key={i}
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            minWidth: 56,
                          }}
                        >
                          <div style={{ fontSize: 28, lineHeight: 1 }}>{emoji}</div>
                          <div style={{ fontSize: 11, opacity: 0.8 }}>{name}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="helper" style={{ marginTop: 12 }}>
                      Code: {Array.isArray(sasData.decimal) ? sasData.decimal.join(" ") : ""}
                    </div>
                  )}

                  <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    <button className="btn" onClick={confirmSas}>
                      Confirm match
                    </button>
                    <button className="btn" onClick={mismatchSas}>
                      Doesn’t match
                    </button>
                  </div>
                </>
              ) : (
                <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                  <button className="btn" onClick={acceptVerification}>
                    Accept
                  </button>
                  <button className="btn" onClick={startSas}>
                    Start SAS
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="helper">
                No active verification request. If you have another device (or Element) signed in, start verification from either side.
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                <button className="btn" onClick={requestOwnVerification}>
                  Request verification
                </button>
                <button className="btn" onClick={checkPendingVerification}>
                  Check pending
                </button>
              </div>
            </>
          )}

          {verifyMsg && (
            <div className="helper" style={{ marginTop: 8 }}>
              {verifyMsg}
            </div>
          )}
        </div>
      )}

      {!loggedIn ? (
        <section className="card" style={{ marginTop: 12, padding: 12 }}>
          <h3 className="section-title" style={{ marginTop: 0 }}>
            Sign in to Matrix
          </h3>
          <div className="helper" style={{ marginBottom: 10 }}>
            Homeserver is fixed to {HS_DEFAULT}
          </div>
          <form onSubmit={login} className="grid" style={{ gap: 8, maxWidth: 520 }}>
            <input
              className="input"
              placeholder="Username (localpart, without @ and domain)"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
            <input
              className="input"
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button className="btn">Login</button>
          </form>
        </section>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              window.matchMedia && window.matchMedia("(max-width: 820px)").matches
                ? "1fr"
                : "280px 1fr",
            gap: 12,
            marginTop: 12,
          }}
        >
          <aside className="card" style={{ padding: 12, minHeight: 0 }}>
            <h3 className="section-title" style={{ marginTop: 0 }}>
              Rooms
            </h3>

            <div style={{ marginBottom: 10 }}>
              <label className="row" style={{ gap: 8, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={hideUndecryptable}
                  onChange={(e) => setHideUndecryptable(e.target.checked)}
                />
                <span className="helper">Hide undecryptable</span>
              </label>

              <label className="row" style={{ gap: 8, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={newestFirst}
                  onChange={(e) => setNewestFirst(e.target.checked)}
                />
                <span className="helper">Newest first</span>
              </label>
            </div>

            <ul style={{ paddingLeft: 18 }}>
              {rooms.map((r) => (
                <li key={r.id}>
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      selectRoom(r.id);
                    }}
                  >
                    {r.name}
                    {r.encrypted ? " 🔒" : ""}
                  </a>
                </li>
              ))}
              {rooms.length === 0 && <li className="helper">No rooms yet.</li>}
            </ul>
          </aside>

          <main
            className="card"
            style={{
              padding: 12,
              minHeight: 420,
              height:
                window.matchMedia && window.matchMedia("(max-width: 820px)").matches
                  ? "calc(100dvh - 220px)"
                  : "auto",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <h3 className="section-title" style={{ marginTop: 0, marginBottom: 8 }}>
              {currentRoom ? currentRoom.name : "Select a room"}
              {currentRoom?.encrypted ? " 🔒" : ""}
            </h3>

            <div
              style={{
                flex: 1,
                overflow: "auto",
                border: "1px solid #222",
                borderRadius: 8,
                padding: 8,
              }}
            >
              {shownMessages.length === 0 ? (
                <div className="helper">No messages yet.</div>
              ) : (
                shownMessages.map((m) => {
                  const info = activeRoomId
                    ? getMemberInfo(activeRoomId, m.sender)
                    : { name: m.sender, avatarUrl: "" };

                  return (
                    <div
                      key={m.id}
                      style={{
                        display: "flex",
                        gap: 10,
                        marginBottom: 10,
                        alignItems: "flex-start",
                      }}
                    >
                      {info.avatarUrl ? (
                        <img
                          src={info.avatarUrl}
                          alt=""
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: 999,
                            objectFit: "cover",
                            border: "1px solid rgba(255,255,255,0.10)",
                            marginTop: 2,
                          }}
                        />
                      ) : (
                        <div
                          aria-hidden="true"
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: 999,
                            background: "rgba(255,255,255,0.08)",
                            border: "1px solid rgba(255,255,255,0.10)",
                            marginTop: 2,
                          }}
                        />
                      )}

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: "#6b7280" }}>
                          {info.name} · {new Date(m.ts).toLocaleString()}{" "}
                          {m.encrypted && !m.undecryptable ? "🔒" : ""}
                        </div>
                        <div>
                          {m.body || <span className="helper">(undecryptable)</span>}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <form onSubmit={send} className="row" style={{ gap: 8, marginTop: 8 }}>
              <input
                className="input"
                placeholder={currentRoom ? "Type a message…" : "Pick a room first"}
                value={msg}
                onChange={(e) => setMsg(e.target.value)}
                disabled={!currentRoom}
              />
              <button className="btn" disabled={!currentRoom || !msg.trim()}>
                Send
              </button>
            </form>
          </main>
        </div>
      )}
    </div>
  );
}
