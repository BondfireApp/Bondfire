import React, { useEffect, useRef, useState } from "react";

const EMBED_ORIGIN = "https://embed.diagrams.net";
const EMBED_URL = `${EMBED_ORIGIN}/?embed=1&proto=json&spin=1&libraries=1&themes=1&noExitBtn=1&keepmodified=1`;

export const EMPTY_DRAWIO_DIAGRAM = `<mxfile host="app.diagrams.net"><diagram name="Page-1"><mxGraphModel dx="1422" dy="794" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>`;

function readEmbedMessage(event) {
  if (event.origin !== EMBED_ORIGIN) return null;
  if (event.data && typeof event.data === "object") return event.data;
  try {
    return JSON.parse(String(event.data || ""));
  } catch {
    return null;
  }
}

export default function DrawioFileView({ value, onChange, title = "Diagram", mode = "edit", privateContent = false }) {
  const iframeRef = useRef(null);
  const lastSentRef = useRef("");
  const [ready, setReady] = useState(false);
  const [externalEditorAllowed, setExternalEditorAllowed] = useState(!privateContent);
  const [status, setStatus] = useState(privateContent ? "Private diagram stays in Bondfire until you choose an external editor." : "Loading diagrams.net…");
  const readOnly = mode === "preview";
  const xml = String(value || EMPTY_DRAWIO_DIAGRAM);

  useEffect(() => {
    setExternalEditorAllowed(!privateContent);
    setReady(false);
    setStatus(privateContent ? "Private diagram stays in Bondfire until you choose an external editor." : "Loading diagrams.net…");
  }, [privateContent]);

  function sendLoad(nextXml = xml) {
    const frame = iframeRef.current?.contentWindow;
    if (!frame) return;
    lastSentRef.current = String(nextXml || EMPTY_DRAWIO_DIAGRAM);
    frame.postMessage(JSON.stringify({
      action: "load",
      xml: lastSentRef.current,
      title: String(title || "Diagram"),
      autosave: readOnly ? 0 : 1,
      noSaveBtn: readOnly ? 1 : 0,
      noExitBtn: 1,
      saveAndExit: 0,
      modified: readOnly ? 0 : 1,
      dark: 1,
    }), EMBED_ORIGIN);
  }

  useEffect(() => {
    if (!externalEditorAllowed) return undefined;
    const onMessage = (event) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const message = readEmbedMessage(event);
      if (!message) return;

      if (message.event === "init" || message.event === "ready") {
        setReady(true);
        setStatus(readOnly ? "Preview ready" : "Ready");
        sendLoad();
        return;
      }

      if ((message.event === "autosave" || message.event === "save") && typeof message.xml === "string" && !readOnly) {
        lastSentRef.current = message.xml;
        onChange?.(message.xml);
        setStatus("Saved");
        return;
      }

      if (message.event === "exit" && !readOnly) setStatus("Ready");
      if (message.error) setStatus(`Diagram error: ${String(message.error)}`);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onChange, readOnly, title, xml, externalEditorAllowed]);

  useEffect(() => {
    if (!externalEditorAllowed || !ready || xml === lastSentRef.current) return;
    sendLoad(xml);
  }, [ready, xml, readOnly, title, externalEditorAllowed]);

  const standaloneUrl = `https://app.diagrams.net/#R${encodeURIComponent(xml)}`;

  const allowExternalEditor = () => {
    if (privateContent && !window.confirm("This will send this decrypted diagram to diagrams.net in your browser. Continue?")) return;
    setExternalEditorAllowed(true);
    setReady(false);
    setStatus(privateContent ? "Opening diagrams.net for this private diagram…" : "Loading diagrams.net…");
  };

  const downloadXml = () => {
    const blob = new Blob([xml], { type: "application/vnd.jgraph.mxfile;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = String(title || "diagram").replace(/\.drawio$/i, "") + ".drawio";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div style={{ display: "grid", gap: 8, minHeight: "72vh" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className="helper">diagrams.net</span>
        <span className="helper" role="status">{status}</span>
        <div style={{ display: "flex", gap: 6, marginLeft: "auto", flexWrap: "wrap" }}>
          <button className="btn" type="button" onClick={downloadXml} style={{ padding: "6px 10px" }}>Download .drawio</button>
          {externalEditorAllowed ? <a className="btn" href={standaloneUrl} target="_blank" rel="noopener noreferrer" style={{ padding: "6px 10px" }}>Open standalone editor</a> : <button className="btn" type="button" onClick={allowExternalEditor} style={{ padding: "6px 10px" }}>Use diagrams.net</button>}
        </div>
      </div>
      {externalEditorAllowed ? <iframe
        ref={iframeRef}
        title={title || "Diagram"}
        src={EMBED_URL}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
        allow="clipboard-read; clipboard-write"
        style={{ width: "100%", minHeight: "68vh", border: "1px solid #24262a", borderRadius: 12, background: "#17191d" }}
      /> : <div className="card" style={{ minHeight: "240px", display: "grid", placeItems: "center", textAlign: "center", padding: 24 }}><div><div style={{ fontWeight: 800, marginBottom: 8 }}>Private diagram</div><div className="helper" style={{ maxWidth: 520 }}>The diagram’s decrypted content has not been sent to an external editor. Download it, or explicitly open it in diagrams.net when you are ready.</div></div></div>}
    </div>
  );
}
