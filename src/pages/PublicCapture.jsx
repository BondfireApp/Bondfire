import React from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../utils/api.js";
import { cacheOrgKey, encryptJsonWithOrgKey, getCachedOrgKey } from "../lib/zk.js";
import { loadPrivateKey } from "../lib/privateCrypto.js";

const CHUNK_MS = 3000;
const REC_API_BASE = (import.meta.env.VITE_REC_API_BASE_URL || "https://rec.bjgarr.workers.dev").replace(/\/+$/, "");
const HANDOFF_KEY = "bf_rec_pending_capture_v2";

const RECOVERY_ADJECTIVES = [
  "amber", "ancient", "autumn", "black", "blue", "bold", "bright", "bronze",
  "calm", "cedar", "clear", "cold", "copper", "crimson", "distant", "dusky",
  "early", "ember", "empty", "faint", "fern", "fierce", "golden", "gray",
  "green", "hidden", "hollow", "iron", "ivory", "kind", "late", "little",
  "lone", "low", "lunar", "misty", "mossy", "night", "northern", "old",
  "open", "orange", "pale", "quiet", "red", "restless", "river", "rough",
  "rust", "safe", "scarlet", "secret", "silver", "soft", "solar", "still",
  "stormy", "strong", "swift", "tall", "velvet", "warm", "wild", "winter",
];

const RECOVERY_NOUNS = [
  "badgers", "beacons", "bears", "bells", "birds", "boats", "bridges", "canyons",
  "cedars", "clouds", "crows", "deer", "drums", "dunes", "eagles", "embers",
  "fields", "fires", "foxes", "gardens", "gates", "ghosts", "hammers", "harbors",
  "hawks", "hills", "islands", "keys", "kites", "lakes", "lamps", "lanterns",
  "leaves", "lions", "maps", "mirrors", "moons", "mountains", "otters", "owls",
  "paths", "pines", "rabbits", "radios", "ravens", "rivers", "roads", "rocks",
  "roses", "seeds", "shores", "signals", "sparrows", "stars", "stones", "storms",
  "towers", "trails", "trees", "valleys", "waves", "wells", "wolves", "woods",
];

const RECOVERY_VERBS = [
  "answer", "arrive", "carry", "circle", "climb", "cross", "dance", "drift",
  "enter", "follow", "gather", "glow", "guard", "guide", "hear", "hold",
  "keep", "leave", "listen", "meet", "move", "open", "pass", "rest",
  "return", "rise", "roam", "run", "sail", "search", "see", "share",
  "shine", "sing", "stand", "stay", "step", "travel", "turn", "wait",
  "wake", "walk", "wander", "watch", "welcome", "whisper", "write", "hide",
  "mark", "reach", "remember", "secure", "send", "shelter", "signal", "speak",
  "trace", "visit", "protect", "build", "notice", "rescue", "travel", "watch",
];

const RECOVERY_ADVERBS = [
  "abroad", "ahead", "apart", "away", "boldly", "briefly", "calmly", "closely",
  "deeply", "early", "easily", "evenly", "far", "freely", "gently", "gladly",
  "here", "kindly", "late", "lightly", "loudly", "nearby", "openly", "outside",
  "patiently", "plainly", "quietly", "rarely", "safely", "slowly", "softly", "steadily",
  "swiftly", "there", "together", "truly", "upward", "warmly", "widely", "wildly",
  "wisely", "bravely", "clearly", "closer", "downhill", "forward", "homeward", "inland",
  "northward", "outward", "roughly", "secretly", "silently", "southward", "straight", "westward",
  "eastward", "carefully", "firmly", "brightly", "honestly", "neatly", "patiently", "surely",
];

const RECOVERY_PREPOSITIONS = [
  "above", "across", "after", "around", "before", "behind", "below", "beside",
  "beyond", "inside", "near", "outside", "past", "through", "under", "within",
];

function toArrayBuffer(bytes) {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function randomInt(max) {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] % max;
}

function pick(values) {
  return values[randomInt(values.length)];
}

function makeRecoveryPhrase() {
  const phrase = [
    pick(RECOVERY_ADJECTIVES),
    pick(RECOVERY_NOUNS),
    pick(RECOVERY_ADVERBS),
    pick(RECOVERY_VERBS),
    pick(RECOVERY_ADJECTIVES),
    pick(RECOVERY_NOUNS),
    pick(RECOVERY_PREPOSITIONS),
    pick(RECOVERY_ADJECTIVES),
    pick(RECOVERY_NOUNS),
  ].join(" ");
  return `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)}.`;
}

function normalizedPhrase(value) {
  return value.trim().toLowerCase().replace(/[.!?]+$/g, "").replace(/\s+/g, " ");
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function deriveWrapKey(secret, salt) {
  const imported = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: toArrayBuffer(salt), iterations: 100000, hash: "SHA-256" },
    imported,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function exportRawKey(key) {
  return new Uint8Array(await crypto.subtle.exportKey("raw", key));
}

async function wrapRecordingKey(key, secret) {
  const raw = await exportRawKey(key);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrapKey = await deriveWrapKey(secret, salt);
  const wrapped = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    wrapKey,
    toArrayBuffer(raw)
  );
  return {
    wrappedKeyB64: bytesToBase64(new Uint8Array(wrapped)),
    wrappedKeyIvB64: bytesToBase64(iv),
    wrappedKeySaltB64: bytesToBase64(salt),
  };
}

async function unwrapRecordingKey(manifest, secret) {
  const salt = base64ToBytes(manifest.wrappedKey.wrappedKeySaltB64);
  const iv = base64ToBytes(manifest.wrappedKey.wrappedKeyIvB64);
  const wrapKey = await deriveWrapKey(secret, salt);
  const raw = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    wrapKey,
    toArrayBuffer(base64ToBytes(manifest.wrappedKey.wrappedKeyB64))
  );
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
}

async function encryptBlob(key, blob) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = await blob.arrayBuffer();
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    key,
    plaintext
  );
  return { iv, ciphertext: new Uint8Array(ciphertext) };
}

async function readJson(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || `REC request failed (${response.status})`);
  return payload;
}

async function startAnonymousSession(key, phrase) {
  const secret = normalizedPhrase(phrase);
  const wrapped = await wrapRecordingKey(key, secret);
  const response = await fetch(`${REC_API_BASE}/api/recordings/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      accessMode: "anonymous",
      ...wrapped,
      recoveryHashHex: await sha256Hex(secret),
      retrievalHint: "Open the Bondfire REC recovery link and use the memorable recovery sentence.",
    }),
  });
  return readJson(response);
}

async function uploadEncryptedChunk({ recordingId, sequence, blob, key }) {
  const encrypted = await encryptBlob(key, blob);
  const rawKey = await exportRawKey(key);
  const response = await fetch(
    `${REC_API_BASE}/api/recordings/${encodeURIComponent(recordingId)}/chunks/${sequence}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Chunk-IV": bytesToBase64(encrypted.iv),
        "X-Chunk-Duration-Ms": String(CHUNK_MS),
        "X-Chunk-Key-Hint": bytesToBase64(rawKey).slice(0, 16),
      },
      body: toArrayBuffer(encrypted.ciphertext),
    }
  );
  return readJson(response);
}

async function fetchAnonymousManifest(archiveId, phrase) {
  const response = await fetch(`${REC_API_BASE}/api/retrieve/anonymous/manifest`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ archiveId: archiveId.trim(), phrase: normalizedPhrase(phrase) }),
  });
  return readJson(response);
}

async function fetchAnonymousChunk(archiveId, phrase, sequence) {
  const response = await fetch(`${REC_API_BASE}/api/retrieve/anonymous/chunk`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ archiveId, phrase: normalizedPhrase(phrase), sequence }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.error || `Could not retrieve chunk ${sequence}`);
  }
  return response.arrayBuffer();
}

async function deleteAnonymousArchive(archiveId, phrase) {
  const response = await fetch(`${REC_API_BASE}/api/retrieve/anonymous/archive`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ archiveId: archiveId.trim(), phrase: normalizedPhrase(phrase) }),
  });
  return readJson(response);
}

function formatClock(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function recoveryLink(recordingId, phrase = "") {
  const base = `${window.location.origin}${window.location.pathname}`;
  const params = new URLSearchParams({ retrieve: "1", archiveId: recordingId });
  if (phrase) params.set("phrase", phrase);
  return `${base}#/capture?${params.toString()}`;
}

function saveHandoff(recordingId, phrase) {
  try {
    sessionStorage.setItem(
      HANDOFF_KEY,
      JSON.stringify({
        recordingId,
        recoveryPhrase: phrase,
        retrievalUrl: recoveryLink(recordingId, phrase),
        savedAt: new Date().toISOString(),
      })
    );
  } catch {}
}

function clearHandoff(recordingId) {
  try {
    const raw = sessionStorage.getItem(HANDOFF_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (!recordingId || saved?.recordingId === recordingId) sessionStorage.removeItem(HANDOFF_KEY);
  } catch {}
}

export default function PublicCapture({ authed = false, embedded = false }) {
  const navigate = useNavigate();
  const { orgId: routeOrgId } = useParams();
  const [searchParams] = useSearchParams();
  const orgId = embedded ? String(routeOrgId || "").trim() : "";
  const captureRoute = orgId ? `/org/${encodeURIComponent(orgId)}/witness/capture` : "/capture";
  const backRoute = orgId ? `/org/${encodeURIComponent(orgId)}/witness` : "/";
  const retrieveMode = searchParams.get("retrieve") === "1";

  const videoRef = React.useRef(null);
  const streamRef = React.useRef(null);
  const recorderRef = React.useRef(null);
  const keyRef = React.useRef(null);
  const recordingIdRef = React.useRef("");
  const sequenceRef = React.useRef(0);
  const rawChunksRef = React.useRef([]);
  const reviewObjectUrlRef = React.useRef("");
  const startedAtRef = React.useRef(0);
  const sessionReadyRef = React.useRef(null);
  const deletingRef = React.useRef(false);

  const [status, setStatus] = React.useState("idle");
  const [recordingId, setRecordingId] = React.useState("");
  const [recoveryPhrase, setRecoveryPhrase] = React.useState("");
  const [recoveryPromptOpen, setRecoveryPromptOpen] = React.useState(false);
  const [recoveryShared, setRecoveryShared] = React.useState(false);
  const [recoverySaved, setRecoverySaved] = React.useState(false);
  const [safeSeconds, setSafeSeconds] = React.useState(0);
  const [pendingChunks, setPendingChunks] = React.useState(0);
  const [failedChunks, setFailedChunks] = React.useState(0);
  const [elapsed, setElapsed] = React.useState(0);
  const [error, setError] = React.useState("");
  const [reviewUrl, setReviewUrl] = React.useState("");
  const [copied, setCopied] = React.useState("");

  const [retrieveId, setRetrieveId] = React.useState(() => searchParams.get("archiveId") || "");
  const [retrievePhrase, setRetrievePhrase] = React.useState(() => searchParams.get("phrase") || "");
  const [retrieveBusy, setRetrieveBusy] = React.useState(false);
  const [retrieveNotice, setRetrieveNotice] = React.useState("");
  const [downloadUrl, setDownloadUrl] = React.useState("");
  const [deleteBusy, setDeleteBusy] = React.useState(false);
  const [deleteNotice, setDeleteNotice] = React.useState("");

  React.useEffect(() => {
    if (status !== "recording") return undefined;
    const interval = window.setInterval(() => {
      if (startedAtRef.current) setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 500);
    return () => window.clearInterval(interval);
  }, [status]);

  React.useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    if (reviewObjectUrlRef.current) URL.revokeObjectURL(reviewObjectUrlRef.current);
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  }, [downloadUrl]);

  async function copyValue(label, value) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(""), 1600);
      return true;
    } catch {
      setCopied("");
      return false;
    }
  }

  async function initializeRemoteArchive(key, phrase) {
    const session = await startAnonymousSession(key, phrase);
    const nextRecordingId = String(session.recordingId || "");
    if (!nextRecordingId) throw new Error("REC did not return an archive ID.");

    recordingIdRef.current = nextRecordingId;
    setRecordingId(nextRecordingId);
    saveHandoff(nextRecordingId, phrase);

    if (orgId) {
      void (async () => {
        let encryptedRecovery = null;
        if (authed) {
          let orgKey = getCachedOrgKey(orgId);
          if (!orgKey) {
            try {
              const privacy = await api(`/api/orgs/${encodeURIComponent(orgId)}/privacy`);
              orgKey = await loadPrivateKey(orgId, privacy, api);
              if (orgKey) cacheOrgKey(orgId, orgKey);
            } catch {}
          }
          if (orgKey) {
            encryptedRecovery = await encryptJsonWithOrgKey(orgKey, {
              archiveId: nextRecordingId,
              recoveryPhrase: phrase,
            });
          }
        }
        await api(`/api/orgs/${encodeURIComponent(orgId)}/witness`, {
          method: "POST",
          body: JSON.stringify({
            title: `REC video ${new Date().toLocaleString()}`,
            summary: "Encrypted REC video capture. Signed-in owners can manage it from the REC Archive; the recovery sentence remains available for emergency or off-device recovery.",
            happened_at: new Date().toISOString(),
            visibility: "private",
            tags: ["rec", "video", `archive:${nextRecordingId}`],
            rec_archive_id: nextRecordingId,
            rec_management_token: session.managementToken || "",
            encrypted_recovery: encryptedRecovery,
          }),
        });
      })().catch((archiveError) => console.warn("REC managed archive registration failed", archiveError));
    }

    return { recordingId: nextRecordingId };
  }

  async function uploadChunkWhenReady(sequence, blob) {
    setPendingChunks((count) => count + 1);
    try {
      const session = await sessionReadyRef.current;
      if (!session?.recordingId || !keyRef.current) throw new Error("Remote archive is unavailable.");
      const result = await uploadEncryptedChunk({
        recordingId: session.recordingId,
        sequence,
        blob,
        key: keyRef.current,
      });
      const reported = Number(result?.safeSeconds);
      if (Number.isFinite(reported)) setSafeSeconds((current) => Math.max(current, reported));
    } catch (chunkError) {
      if (!deletingRef.current) {
        console.error("REC chunk upload failed", chunkError);
        setFailedChunks((count) => count + 1);
        setError("One or more encrypted chunks did not reach the remote archive. Keep recording if needed; REC is preserving the local review copy on this device.");
      }
    } finally {
      setPendingChunks((count) => Math.max(0, count - 1));
    }
  }

  async function startCapture() {
    if (status === "preparing" || status === "recording") return;
    deletingRef.current = false;
    setDeleteNotice("");
    setError("");
    setFailedChunks(0);
    setPendingChunks(0);
    setSafeSeconds(0);
    setElapsed(0);
    setReviewUrl("");
    setRecordingId("");
    setRecoveryShared(false);
    setRecoverySaved(false);
    setRecoveryPromptOpen(false);
    recordingIdRef.current = "";
    rawChunksRef.current = [];
    sequenceRef.current = 0;
    sessionReadyRef.current = null;
    setStatus("preparing");

    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        throw new Error("This browser cannot start camera recording here.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      const phrase = makeRecoveryPhrase();
      const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
      setRecoveryPhrase(phrase);
      keyRef.current = key;

      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
        ? "video/webm;codecs=vp9,opus"
        : MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
          ? "video/webm;codecs=vp8,opus"
          : "video/webm";

      const recorder = new MediaRecorder(stream, { mimeType });
      recorder.ondataavailable = (event) => {
        if (!event.data || event.data.size === 0) return;
        const blob = event.data;
        const sequence = sequenceRef.current++;
        rawChunksRef.current.push(blob);
        void uploadChunkWhenReady(sequence, blob);
      };
      recorder.onerror = () => setError("The browser recorder reported an error.");
      recorder.onstop = () => {
        setStatus("stopped");
        setRecoveryPromptOpen(false);
        const blob = new Blob(rawChunksRef.current, { type: mimeType });
        if (reviewObjectUrlRef.current) URL.revokeObjectURL(reviewObjectUrlRef.current);
        const url = URL.createObjectURL(blob);
        reviewObjectUrlRef.current = url;
        setReviewUrl(url);
      };

      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      recorder.start(CHUNK_MS);
      setStatus("recording");
      setRecoveryPromptOpen(true);

      sessionReadyRef.current = initializeRemoteArchive(key, phrase).catch((archiveError) => {
        console.error("REC archive initialization failed", archiveError);
        setError(`${archiveError?.message || "Could not create the remote archive."} Recording is continuing locally.`);
        throw archiveError;
      });
    } catch (captureError) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setStatus("idle");
      setRecoveryPromptOpen(false);
      setError(captureError?.message || "Could not start REC.");
    }
  }

  function stopCapture() {
    if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    startedAtRef.current = 0;
  }

  async function saveRecoveryPhrase() {
    const copiedOkay = await copyValue("phrase", recoveryPhrase);
    if (copiedOkay) setRecoverySaved(true);
    setRecoveryPromptOpen(false);
  }

  async function shareSafetyHandoff() {
    if (!recordingId || !recoveryPhrase) return;
    const url = recoveryLink(recordingId, recoveryPhrase);
    const text = `Bondfire REC safety handoff\n\nA recording is active or was recently active. This link contains the recovery capability for the encrypted footage already received by REC.\n\n${url}`;

    try {
      if (navigator.share) {
        await navigator.share({ title: "Bondfire REC safety handoff", text, url });
      } else {
        const copiedOkay = await copyValue("handoff", text);
        if (!copiedOkay) throw new Error("Could not open the share sheet or copy the handoff.");
      }
      setRecoveryShared(true);
      setRecoverySaved(true);
      setRecoveryPromptOpen(false);
    } catch (shareError) {
      if (shareError?.name === "AbortError") return;
      setError(shareError?.message || "Could not share the recovery handoff.");
    }
  }

  function signInWithCaptureReserved() {
    if (recordingId && recoveryPhrase) saveHandoff(recordingId, recoveryPhrase);
    navigate("/signin?mode=login&from=capture");
  }

  async function removeOrgWitnessMetadata(archiveId) {
    if (!orgId || !archiveId) return true;
    try {
      await api(`/api/orgs/${encodeURIComponent(orgId)}/witness?archiveId=${encodeURIComponent(archiveId)}`, {
        method: "DELETE",
      });
      return true;
    } catch (metadataError) {
      console.warn("REC archive metadata cleanup failed", metadataError);
      return false;
    }
  }

  async function deleteCurrentRecording() {
    const archiveId = recordingIdRef.current || recordingId;
    const phrase = recoveryPhrase;
    if (!archiveId || !phrase || deleteBusy) return;
    if (!window.confirm("Delete this REC archive from remote storage?")) return;

    deletingRef.current = true;
    setDeleteBusy(true);
    setDeleteNotice("Deleting encrypted archive…");
    setError("");
    try {
      await deleteAnonymousArchive(archiveId, phrase);
      const metadataRemoved = await removeOrgWitnessMetadata(archiveId);
      clearHandoff(archiveId);
      if (reviewObjectUrlRef.current) URL.revokeObjectURL(reviewObjectUrlRef.current);
      reviewObjectUrlRef.current = "";
      rawChunksRef.current = [];
      keyRef.current = null;
      recordingIdRef.current = "";
      sessionReadyRef.current = null;
      setReviewUrl("");
      setRecordingId("");
      setRecoveryPhrase("");
      setSafeSeconds(0);
      setFailedChunks(0);
      setStatus("idle");
      setDeleteNotice(metadataRemoved ? "Archive deleted." : "Archive deleted; its Bondfire list entry could not be removed.");
    } catch (deleteError) {
      deletingRef.current = false;
      setDeleteNotice(deleteError?.message || "Could not delete this archive.");
    } finally {
      setDeleteBusy(false);
    }
  }

  async function retrieveRecording(event) {
    event.preventDefault();
    const archiveId = retrieveId.trim();
    const phrase = retrievePhrase.trim();
    if (!archiveId || !phrase) {
      setRetrieveNotice("The recovery link or both the archive ID and recovery sentence are required.");
      return;
    }

    setRetrieveBusy(true);
    setRetrieveNotice("Retrieving encrypted archive…");
    setError("");
    try {
      const manifest = await fetchAnonymousManifest(archiveId, phrase);
      const key = await unwrapRecordingKey(manifest, normalizedPhrase(phrase));
      const decrypted = [];
      const chunks = [...(manifest.chunks || [])].sort((a, b) => Number(a.sequence) - Number(b.sequence));

      for (const chunk of chunks) {
        const ciphertext = await fetchAnonymousChunk(archiveId, phrase, chunk.sequence);
        const plain = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: toArrayBuffer(base64ToBytes(chunk.ivB64)) },
          key,
          ciphertext
        );
        decrypted.push(new Uint8Array(plain));
      }

      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
      const blob = new Blob(decrypted, { type: "video/webm" });
      const url = URL.createObjectURL(blob);
      setDownloadUrl(url);
      setRetrieveNotice(`Recovered ${chunks.length} encrypted chunk${chunks.length === 1 ? "" : "s"}. If the source recording is still active, repeat retrieval later for newer chunks.`);
    } catch (retrieveError) {
      setRetrieveNotice(retrieveError?.message || "Could not retrieve this archive.");
    } finally {
      setRetrieveBusy(false);
    }
  }

  async function deleteRecoveredRecording() {
    const archiveId = retrieveId.trim();
    const phrase = retrievePhrase.trim();
    if (!archiveId || !phrase || deleteBusy) return;
    if (!window.confirm("Delete this recovered REC archive from remote storage?")) return;

    setDeleteBusy(true);
    setDeleteNotice("Deleting encrypted archive…");
    try {
      await deleteAnonymousArchive(archiveId, phrase);
      const metadataRemoved = await removeOrgWitnessMetadata(archiveId);
      clearHandoff(archiveId);
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
      setDownloadUrl("");
      setRetrieveNotice(metadataRemoved ? "Archive deleted." : "Archive deleted; its Bondfire list entry could not be removed.");
      setDeleteNotice("");
    } catch (deleteError) {
      setDeleteNotice(deleteError?.message || "Could not delete this archive.");
    } finally {
      setDeleteBusy(false);
    }
  }

  if (retrieveMode) {
    const sharedHandoff = Boolean(searchParams.get("archiveId") && searchParams.get("phrase"));
    return (
      <div className="bf-build-page">
        <header className="bf-build-hero">
          <div>
            <p className="bf-build-eyebrow">BONDFIRE // REC</p>
            <h1>{sharedHandoff ? "Safety handoff received." : "Retrieve an anonymous archive."}</h1>
            <p className="bf-build-lede">
              {sharedHandoff
                ? "This recovery link carries the archive location and recovery sentence. Retrieval and decryption happen on this device."
                : "Use a REC recovery link when possible. Older captures can still be recovered with their archive ID and recovery phrase."}
            </p>
          </div>
        </header>
        <main style={{ width: "min(760px, calc(100% - 32px))", margin: "0 auto", padding: "42px 0 72px" }}>
          <form className="card" style={{ padding: 20, display: "grid", gap: 14 }} onSubmit={retrieveRecording}>
            {!sharedHandoff ? (
              <label style={{ display: "grid", gap: 6 }}>
                <span className="bf-build-label">ARCHIVE ID</span>
                <input className="input" value={retrieveId} onChange={(event) => setRetrieveId(event.target.value)} autoComplete="off" />
              </label>
            ) : null}
            <label style={{ display: "grid", gap: 6 }}>
              <span className="bf-build-label">RECOVERY SENTENCE</span>
              <input className="input" value={retrievePhrase} onChange={(event) => setRetrievePhrase(event.target.value)} autoComplete="off" />
            </label>
            <button className="btn-red" disabled={retrieveBusy}>{retrieveBusy ? "Retrieving…" : "Retrieve recording"}</button>
            {retrieveNotice ? <p className="helper" style={{ margin: 0 }}>{retrieveNotice}</p> : null}
            {downloadUrl ? (
              <>
                <video controls src={downloadUrl} style={{ width: "100%", maxHeight: 420, background: "#050606" }} />
                <a className="btn" href={downloadUrl} download={`rec-${retrieveId || "archive"}.webm`} style={{ textAlign: "center", textDecoration: "none" }}>
                  Download recovered recording
                </a>
                <button className="btn-red" type="button" onClick={deleteRecoveredRecording} disabled={deleteBusy}>
                  {deleteBusy ? "Deleting…" : "Delete archive"}
                </button>
              </>
            ) : null}
            {deleteNotice ? <p className="error" style={{ margin: 0 }}>{deleteNotice}</p> : null}
          </form>
          <div style={{ marginTop: 18 }}><Link className="helper" to={captureRoute}>Back to REC</Link></div>
        </main>
      </div>
    );
  }

  const recoveryStateLabel = recoveryShared
    ? "Recovery shared"
    : recoverySaved
      ? "Recovery saved"
      : "Recovery not shared";

  return (
    <div className="bf-build-page">
      <header className="bf-build-hero">
        <div>
          <p className="bf-build-eyebrow">BONDFIRE // REC</p>
          <h1>Record first.</h1>
          <p className="bf-build-lede">
            {orgId
              ? "Tap REC and capture starts as soon as camera permission is available. Recovery and safety handoff come second."
              : "No account gate. Tap REC first; recovery and safety handoff are offered after the timer is already moving."}
          </p>
        </div>
        <div className="bf-build-counter" aria-live="polite">
          <span>{status === "recording" ? "RECORDING" : "ARCHIVE"}</span>
          <strong>{status === "recording" ? formatClock(elapsed) : safeSeconds}</strong>
          <small>{status === "recording" ? `${safeSeconds}s safe remotely` : "seconds safe remotely"}</small>
        </div>
      </header>

      <main style={{ width: "min(1100px, calc(100% - 32px))", margin: "0 auto", padding: "32px 0 72px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.6fr) minmax(260px, .8fr)", gap: 14 }}>
          <section className="card" style={{ padding: 14, minWidth: 0 }}>
            <div style={{ position: "relative", aspectRatio: "16 / 9", background: "#050606", overflow: "hidden", border: "1px solid var(--bf-v3-line)" }}>
              <video ref={videoRef} muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover", display: status === "idle" ? "none" : "block" }} />
              {status === "idle" ? (
                <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", padding: 24, textAlign: "center" }}>
                  <div>
                    <p className="bf-build-label">CAMERA + MICROPHONE</p>
                    <h2 style={{ margin: "8px 0" }}>Ready when you are.</h2>
                    <p className="helper" style={{ margin: 0 }}>Nothing to fill out first. Browser permission is requested only when you tap REC.</p>
                  </div>
                </div>
              ) : null}
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14, alignItems: "center" }}>
              {status === "idle" ? <button className="btn-red" type="button" onClick={startCapture}>START REC</button> : null}
              {status === "preparing" ? <button className="btn-red" type="button" disabled>OPENING CAMERA…</button> : null}
              {status === "recording" ? <button className="btn-red" type="button" onClick={stopCapture}>STOP REC</button> : null}
              {status === "recording" ? (
                <button className="btn" type="button" onClick={() => setRecoveryPromptOpen(true)}>
                  {recoveryStateLabel}
                </button>
              ) : null}
              {status === "stopped" ? <button className="btn" type="button" onClick={startCapture}>Start another recording</button> : null}
              <Link className="btn" to={`${captureRoute}?retrieve=1`} style={{ textDecoration: "none" }}>Retrieve archive</Link>
              <Link className="btn" to={backRoute} style={{ textDecoration: "none" }}>{orgId ? "Back to REC archive" : "Back"}</Link>
            </div>

            {status === "recording" && recoveryPromptOpen ? (
              <div
                role="region"
                aria-label="Protect this recording"
                className="card"
                style={{ marginTop: 14, padding: 16, border: "1px solid var(--bf-v3-line)", display: "grid", gap: 12 }}
              >
                <div>
                  <p className="bf-build-label" style={{ margin: 0 }}>PROTECT THIS RECORDING</p>
                  <h2 style={{ margin: "6px 0 8px" }}>Recording is already underway.</h2>
                  <p className="helper" style={{ margin: 0 }}>Keep this sentence or hand recovery to someone away from the scene. Neither action stops recording.</p>
                </div>
                <div style={{ padding: 14, border: "1px solid var(--bf-v3-line)", borderRadius: 8 }}>
                  <span className="bf-build-label">YOUR RECOVERY SENTENCE</span>
                  <strong style={{ display: "block", marginTop: 8, fontSize: "clamp(18px, 3vw, 26px)", lineHeight: 1.35 }}>
                    {recoveryPhrase}
                  </strong>
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button className="btn-red" type="button" onClick={shareSafetyHandoff} disabled={!recordingId}>
                    {recordingId ? "SEND TO SOMEONE I TRUST" : "SECURING REMOTE ARCHIVE…"}
                  </button>
                  <button className="btn" type="button" onClick={saveRecoveryPhrase}>
                    {copied === "phrase" ? "COPIED" : "KEEP THIS SENTENCE"}
                  </button>
                  <button className="btn" type="button" onClick={() => setRecoveryPromptOpen(false)}>LATER</button>
                </div>
              </div>
            ) : null}

            {error ? <div className="error" style={{ marginTop: 12 }}>{error}</div> : null}
            {deleteNotice ? <div className="helper" style={{ marginTop: 12 }}>{deleteNotice}</div> : null}

            {reviewUrl ? (
              <div style={{ marginTop: 18 }}>
                <p className="bf-build-label">LOCAL REVIEW COPY</p>
                <video controls src={reviewUrl} style={{ width: "100%", maxHeight: 420, background: "#050606" }} />
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
                  <a className="btn" href={reviewUrl} download={`rec-${recordingId || "capture"}.webm`} style={{ display: "inline-block", textDecoration: "none" }}>
                    Download local copy
                  </a>
                  {recordingId ? (
                    <button className="btn-red" type="button" onClick={deleteCurrentRecording} disabled={deleteBusy}>
                      {deleteBusy ? "Deleting…" : "Delete archive"}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </section>

          <aside className="card" style={{ padding: 18, minWidth: 0 }}>
            <p className="bf-build-label">RECOVERY</p>
            <h2 style={{ margin: "8px 0 12px" }}>
              {status === "recording"
                ? "Capture first. Recovery second."
                : recordingId
                  ? "This capture has a recovery path."
                  : "Recovery is created automatically."}
            </h2>
            <p className="helper">
              {status === "recording"
                ? "The recorder is already running. REC is securing encrypted chunks remotely while you decide whether to save or share recovery."
                : "New captures use one memorable recovery sentence. A shared safety link carries the archive location automatically."}
            </p>

            {recoveryPhrase ? (
              <div style={{ display: "grid", gap: 12, marginTop: 18 }}>
                <div style={{ borderTop: "1px solid var(--bf-v3-line)", paddingTop: 12 }}>
                  <span className="bf-build-label">RECOVERY SENTENCE</span>
                  <strong style={{ display: "block", marginTop: 8, lineHeight: 1.45 }}>{recoveryPhrase}</strong>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                    <button className="btn" type="button" onClick={() => copyValue("phrase", recoveryPhrase)}>
                      {copied === "phrase" ? "Copied" : "Copy sentence"}
                    </button>
                    {recordingId ? (
                      <button className="btn" type="button" onClick={shareSafetyHandoff}>
                        {recoveryShared ? "Shared" : "Send safety handoff"}
                      </button>
                    ) : null}
                  </div>
                </div>
                {recordingId ? (
                  <details style={{ borderTop: "1px solid var(--bf-v3-line)", paddingTop: 12 }}>
                    <summary className="helper" style={{ cursor: "pointer" }}>Advanced recovery details</summary>
                    <div style={{ marginTop: 10 }}>
                      <span className="bf-build-label">ARCHIVE ID</span>
                      <code style={{ display: "block", marginTop: 6, overflowWrap: "anywhere", color: "var(--bf-v3-cream)" }}>{recordingId}</code>
                      <button className="btn" type="button" onClick={() => copyValue("id", recordingId)} style={{ marginTop: 8 }}>
                        {copied === "id" ? "Copied" : "Copy archive ID"}
                      </button>
                    </div>
                  </details>
                ) : null}
              </div>
            ) : null}

            <div style={{ borderTop: "1px solid var(--bf-v3-line)", marginTop: 18, paddingTop: 14 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div><span className="bf-build-label">SAFE</span><strong style={{ display: "block", fontSize: 24 }}>{safeSeconds}s</strong></div>
                <div><span className="bf-build-label">PENDING</span><strong style={{ display: "block", fontSize: 24 }}>{pendingChunks}</strong></div>
              </div>
              {failedChunks ? <p className="error" style={{ marginBottom: 0 }}>{failedChunks} chunk upload{failedChunks === 1 ? "" : "s"} failed.</p> : null}
            </div>

            {status === "stopped" && recordingId ? (
              <div style={{ borderTop: "1px solid var(--bf-v3-line)", marginTop: 18, paddingTop: 14 }}>
                <p className="helper" style={{ marginTop: 0 }}>
                  {authed
                    ? "You are signed in to Bondfire. This REC archive still requires its recovery sentence or safety handoff."
                    : "The recording is already reserved anonymously. Signing in is optional and does not discard this recovery path."}
                </p>
                {!authed ? (
                  <button className="btn-red" type="button" onClick={signInWithCaptureReserved}>SIGN IN WITH THIS CAPTURE RESERVED</button>
                ) : (
                  <Link className="btn-red" to={orgId ? backRoute : "/orgs"} style={{ display: "inline-block", textDecoration: "none" }}>{orgId ? "BACK TO REC ARCHIVE" : "GO TO MY ORGANIZATIONS"}</Link>
                )}
              </div>
            ) : null}
          </aside>
        </div>

        <style>{`@media (max-width: 760px){main > div{grid-template-columns:1fr!important}}`}</style>
      </main>
    </div>
  );
}
