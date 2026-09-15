import React from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

const CHUNK_MS = 3000;
const REC_API_BASE = (import.meta.env.VITE_REC_API_BASE_URL || "https://rec.bjgarr.workers.dev").replace(/\/+$/, "");
const HANDOFF_KEY = "bf_rec_pending_capture_v1";
const RECOVERY_WORDS = [
  "river", "ghost", "iron", "storm", "velvet", "ember", "signal", "ash",
  "cinder", "orchid", "marrow", "cedar", "fox", "light", "gate", "kite",
  "field", "mirror", "thread", "harbor", "stone", "drift", "siren", "lamp",
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

function makeRecoveryPhrase() {
  const words = Array.from({ length: 6 }, () => RECOVERY_WORDS[randomInt(RECOVERY_WORDS.length)]);
  const suffix = String(randomInt(10000)).padStart(4, "0");
  return `${words.join("-")}-${suffix}`;
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
  const wrapped = await wrapRecordingKey(key, phrase);
  const response = await fetch(`${REC_API_BASE}/api/recordings/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      accessMode: "anonymous",
      ...wrapped,
      recoveryHashHex: await sha256Hex(phrase.trim().toLowerCase()),
      retrievalHint: "Open Bondfire REC retrieval and enter the recovery phrase.",
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
    body: JSON.stringify({ archiveId: archiveId.trim(), phrase }),
  });
  return readJson(response);
}

async function fetchAnonymousChunk(archiveId, phrase, sequence) {
  const response = await fetch(`${REC_API_BASE}/api/retrieve/anonymous/chunk`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ archiveId, phrase, sequence }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.error || `Could not retrieve chunk ${sequence}`);
  }
  return response.arrayBuffer();
}

function formatClock(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function recoveryLink(recordingId) {
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}#/capture?retrieve=1&archiveId=${encodeURIComponent(recordingId)}`;
}

function saveHandoff(recordingId, phrase) {
  try {
    sessionStorage.setItem(
      HANDOFF_KEY,
      JSON.stringify({
        recordingId,
        recoveryPhrase: phrase,
        retrievalUrl: recoveryLink(recordingId),
        savedAt: new Date().toISOString(),
      })
    );
  } catch {}
}

export default function PublicCapture({ authed = false }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
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

  const [status, setStatus] = React.useState("idle");
  const [recordingId, setRecordingId] = React.useState("");
  const [recoveryPhrase, setRecoveryPhrase] = React.useState("");
  const [safeSeconds, setSafeSeconds] = React.useState(0);
  const [pendingChunks, setPendingChunks] = React.useState(0);
  const [failedChunks, setFailedChunks] = React.useState(0);
  const [elapsed, setElapsed] = React.useState(0);
  const [error, setError] = React.useState("");
  const [reviewUrl, setReviewUrl] = React.useState("");
  const [copied, setCopied] = React.useState("");

  const [retrieveId, setRetrieveId] = React.useState(() => searchParams.get("archiveId") || "");
  const [retrievePhrase, setRetrievePhrase] = React.useState("");
  const [retrieveBusy, setRetrieveBusy] = React.useState(false);
  const [retrieveNotice, setRetrieveNotice] = React.useState("");
  const [downloadUrl, setDownloadUrl] = React.useState("");

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
    } catch {
      setCopied("");
    }
  }

  async function startCapture() {
    if (status === "preparing" || status === "recording") return;
    setError("");
    setFailedChunks(0);
    setPendingChunks(0);
    setSafeSeconds(0);
    setElapsed(0);
    setReviewUrl("");
    rawChunksRef.current = [];
    sequenceRef.current = 0;
    setStatus("preparing");

    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        throw new Error("This browser cannot start camera recording here.");
      }

      const phrase = makeRecoveryPhrase();
      setRecoveryPhrase(phrase);

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
      keyRef.current = key;
      const session = await startAnonymousSession(key, phrase);
      const nextRecordingId = String(session.recordingId || "");
      if (!nextRecordingId) throw new Error("REC did not return an archive ID.");

      recordingIdRef.current = nextRecordingId;
      setRecordingId(nextRecordingId);
      saveHandoff(nextRecordingId, phrase);

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
        setPendingChunks((count) => count + 1);
        void uploadEncryptedChunk({
          recordingId: recordingIdRef.current,
          sequence,
          blob,
          key: keyRef.current,
        })
          .then((result) => {
            const reported = Number(result?.safeSeconds);
            if (Number.isFinite(reported)) setSafeSeconds((current) => Math.max(current, reported));
          })
          .catch((chunkError) => {
            console.error("REC chunk upload failed", chunkError);
            setFailedChunks((count) => count + 1);
            setError("One or more encrypted chunks did not reach the archive. Keep this tab open and preserve the local review copy.");
          })
          .finally(() => setPendingChunks((count) => Math.max(0, count - 1)));
      };
      recorder.onerror = () => setError("The browser recorder reported an error.");
      recorder.onstop = () => {
        setStatus("stopped");
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
    } catch (captureError) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setStatus("idle");
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

  function signInWithCaptureReserved() {
    if (recordingId && recoveryPhrase) saveHandoff(recordingId, recoveryPhrase);
    navigate("/signin?mode=login&from=capture");
  }

  async function retrieveRecording(event) {
    event.preventDefault();
    const archiveId = retrieveId.trim();
    const phrase = retrievePhrase.trim();
    if (!archiveId || !phrase) {
      setRetrieveNotice("Archive ID and recovery phrase are required.");
      return;
    }

    setRetrieveBusy(true);
    setRetrieveNotice("Retrieving encrypted archive…");
    setError("");
    try {
      const manifest = await fetchAnonymousManifest(archiveId, phrase);
      const key = await unwrapRecordingKey(manifest, phrase);
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
      setRetrieveNotice(`Recovered ${chunks.length} encrypted chunk${chunks.length === 1 ? "" : "s"}.`);
    } catch (retrieveError) {
      setRetrieveNotice(retrieveError?.message || "Could not retrieve this archive.");
    } finally {
      setRetrieveBusy(false);
    }
  }

  if (retrieveMode) {
    return (
      <div className="bf-build-page">
        <header className="bf-build-hero">
          <div>
            <p className="bf-build-eyebrow">BONDFIRE // REC</p>
            <h1>Retrieve an anonymous archive.</h1>
            <p className="bf-build-lede">The archive ID locates the encrypted recording. The recovery phrase unlocks it on this device.</p>
          </div>
        </header>
        <main style={{ width: "min(760px, calc(100% - 32px))", margin: "0 auto", padding: "42px 0 72px" }}>
          <form className="card" style={{ padding: 20, display: "grid", gap: 14 }} onSubmit={retrieveRecording}>
            <label style={{ display: "grid", gap: 6 }}>
              <span className="bf-build-label">ARCHIVE ID</span>
              <input className="input" value={retrieveId} onChange={(event) => setRetrieveId(event.target.value)} autoComplete="off" />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span className="bf-build-label">RECOVERY PHRASE</span>
              <input className="input" value={retrievePhrase} onChange={(event) => setRetrievePhrase(event.target.value)} autoComplete="off" />
            </label>
            <button className="btn-red" disabled={retrieveBusy}>{retrieveBusy ? "Retrieving…" : "Retrieve recording"}</button>
            {retrieveNotice ? <p className="helper" style={{ margin: 0 }}>{retrieveNotice}</p> : null}
            {downloadUrl ? (
              <a className="btn" href={downloadUrl} download={`rec-${retrieveId || "archive"}.webm`} style={{ textAlign: "center", textDecoration: "none" }}>
                Download recovered recording
              </a>
            ) : null}
          </form>
          <div style={{ marginTop: 18 }}><Link className="helper" to="/capture">Back to REC</Link></div>
        </main>
      </div>
    );
  }

  return (
    <div className="bf-build-page">
      <header className="bf-build-hero">
        <div>
          <p className="bf-build-eyebrow">BONDFIRE // REC</p>
          <h1>Record first.</h1>
          <p className="bf-build-lede">
            No account gate. REC encrypts each chunk on this device before upload and gives you the recovery path.
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
                    <p className="helper" style={{ margin: 0 }}>Permission is requested only when you start REC.</p>
                  </div>
                </div>
              ) : null}
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
              {status === "idle" ? (
                <button className="btn-red" type="button" onClick={startCapture}>START REC</button>
              ) : null}
              {status === "preparing" ? <button className="btn-red" type="button" disabled>Preparing encrypted archive…</button> : null}
              {status === "recording" ? (
                <button className="btn-red" type="button" onClick={stopCapture}>STOP REC</button>
              ) : null}
              {status === "stopped" ? (
                <button className="btn" type="button" onClick={startCapture}>Start another recording</button>
              ) : null}
              <Link className="btn" to="/capture?retrieve=1" style={{ textDecoration: "none" }}>Retrieve archive</Link>
              <Link className="btn" to="/" style={{ textDecoration: "none" }}>Back</Link>
            </div>

            {error ? <div className="error" style={{ marginTop: 12 }}>{error}</div> : null}

            {reviewUrl ? (
              <div style={{ marginTop: 18 }}>
                <p className="bf-build-label">LOCAL REVIEW COPY</p>
                <video controls src={reviewUrl} style={{ width: "100%", maxHeight: 420, background: "#050606" }} />
                <a className="btn" href={reviewUrl} download={`rec-${recordingId || "capture"}.webm`} style={{ display: "inline-block", marginTop: 10, textDecoration: "none" }}>
                  Download local copy
                </a>
              </div>
            ) : null}
          </section>

          <aside className="card" style={{ padding: 18, minWidth: 0 }}>
            <p className="bf-build-label">RECOVERY</p>
            <h2 style={{ margin: "8px 0 12px" }}>{recordingId ? "Archive reserved." : "Recovery appears before capture starts."}</h2>
            <p className="helper">
              {recordingId
                ? "Keep both values. The archive can be recovered without a Bondfire account."
                : "REC will create a recovery phrase and anonymous archive before the recorder begins writing chunks."}
            </p>

            {recordingId ? (
              <div style={{ display: "grid", gap: 12, marginTop: 18 }}>
                <div style={{ borderTop: "1px solid var(--bf-v3-line)", paddingTop: 12 }}>
                  <span className="bf-build-label">ARCHIVE ID</span>
                  <code style={{ display: "block", marginTop: 6, overflowWrap: "anywhere", color: "var(--bf-v3-cream)" }}>{recordingId}</code>
                  <button className="btn" type="button" onClick={() => copyValue("id", recordingId)} style={{ marginTop: 8 }}>
                    {copied === "id" ? "Copied" : "Copy archive ID"}
                  </button>
                </div>
                <div style={{ borderTop: "1px solid var(--bf-v3-line)", paddingTop: 12 }}>
                  <span className="bf-build-label">RECOVERY PHRASE</span>
                  <code style={{ display: "block", marginTop: 6, overflowWrap: "anywhere", color: "var(--bf-v3-cream)" }}>{recoveryPhrase}</code>
                  <button className="btn" type="button" onClick={() => copyValue("phrase", recoveryPhrase)} style={{ marginTop: 8 }}>
                    {copied === "phrase" ? "Copied" : "Copy recovery phrase"}
                  </button>
                </div>
                <div style={{ borderTop: "1px solid var(--bf-v3-line)", paddingTop: 12 }}>
                  <span className="bf-build-label">RETRIEVAL LINK</span>
                  <button className="btn" type="button" onClick={() => copyValue("link", recoveryLink(recordingId))} style={{ marginTop: 8 }}>
                    {copied === "link" ? "Copied" : "Copy retrieval link"}
                  </button>
                </div>
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
                    ? "You are already signed in to Bondfire. This REC archive remains protected by its recovery phrase."
                    : "The recording is already reserved anonymously. Signing in is optional and will not discard this recovery path."}
                </p>
                {!authed ? (
                  <button className="btn-red" type="button" onClick={signInWithCaptureReserved}>SIGN IN WITH THIS CAPTURE RESERVED</button>
                ) : (
                  <Link className="btn-red" to="/orgs" style={{ display: "inline-block", textDecoration: "none" }}>GO TO MY ORGANIZATIONS</Link>
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
