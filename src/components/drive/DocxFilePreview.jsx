import React, { useEffect, useState } from "react";

function bytesFromDataUrl(dataUrl) {
  const raw = String(dataUrl || "");
  const comma = raw.indexOf(",");
  if (comma < 0) throw new Error("DOCX data is unavailable.");
  const meta = raw.slice(0, comma);
  const payload = raw.slice(comma + 1);
  if (!/;base64$/i.test(meta)) return new TextEncoder().encode(decodeURIComponent(payload));
  const bin = atob(payload);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function u16(view, offset) {
  return view.getUint16(offset, true);
}

function u32(view, offset) {
  return view.getUint32(offset, true);
}

function findEndOfCentralDirectory(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const min = Math.max(0, bytes.byteLength - 65557);
  for (let offset = bytes.byteLength - 22; offset >= min; offset -= 1) {
    if (u32(view, offset) === 0x06054b50) return offset;
  }
  return -1;
}

async function unzipEntry(bytes, wantedName) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEndOfCentralDirectory(bytes);
  if (eocd < 0) throw new Error("This DOCX does not contain a readable ZIP directory.");
  const centralOffset = u32(view, eocd + 16);
  const totalEntries = u16(view, eocd + 10);
  let cursor = centralOffset;
  const decoder = new TextDecoder();

  for (let i = 0; i < totalEntries && cursor + 46 <= bytes.byteLength; i += 1) {
    if (u32(view, cursor) !== 0x02014b50) break;
    const method = u16(view, cursor + 10);
    const compressedSize = u32(view, cursor + 20);
    const fileNameLength = u16(view, cursor + 28);
    const extraLength = u16(view, cursor + 30);
    const commentLength = u16(view, cursor + 32);
    const localOffset = u32(view, cursor + 42);
    const nameStart = cursor + 46;
    const name = decoder.decode(bytes.slice(nameStart, nameStart + fileNameLength));

    if (name === wantedName) {
      if (u32(view, localOffset) !== 0x04034b50) throw new Error("DOCX entry is damaged.");
      const localNameLength = u16(view, localOffset + 26);
      const localExtraLength = u16(view, localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = bytes.slice(dataStart, dataStart + compressedSize);

      if (method === 0) return compressed;
      if (method !== 8) throw new Error("This DOCX uses an unsupported compression method.");
      if (typeof DecompressionStream === "undefined") throw new Error("This browser cannot preview DOCX files yet.");
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }

    cursor += 46 + fileNameLength + extraLength + commentLength;
  }

  throw new Error("word/document.xml was not found in this DOCX.");
}

function documentXmlToText(xml) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("The DOCX document XML could not be parsed.");
  const paragraphs = Array.from(doc.getElementsByTagNameNS("*", "p"));
  const lines = paragraphs.map((paragraph) => {
    let out = "";
    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) return;
      const local = node.localName;
      if (local === "t") {
        out += node.textContent || "";
        return;
      }
      if (local === "tab") out += "\t";
      if (local === "br" || local === "cr") out += "\n";
      for (const child of Array.from(node.childNodes || [])) walk(child);
    };
    walk(paragraph);
    return out.replace(/[ \t]+\n/g, "\n").trimEnd();
  });
  return lines.join("\n\n").replace(/\n{4,}/g, "\n\n\n").trim();
}

async function extractDocxText(dataUrl) {
  const bytes = bytesFromDataUrl(dataUrl);
  const documentXml = await unzipEntry(bytes, "word/document.xml");
  return documentXmlToText(new TextDecoder("utf-8").decode(documentXml));
}

export default function DocxFilePreview({ file }) {
  const [state, setState] = useState({ loading: true, text: "", error: "" });

  useEffect(() => {
    let alive = true;
    setState({ loading: true, text: "", error: "" });
    extractDocxText(file?.dataUrl || "")
      .then((text) => {
        if (alive) setState({ loading: false, text, error: "" });
      })
      .catch((error) => {
        if (alive) setState({ loading: false, text: "", error: String(error?.message || error || "DOCX preview failed.") });
      });
    return () => {
      alive = false;
    };
  }, [file?.id, file?.dataUrl]);

  if (state.loading) return <div className="card" style={{ padding: 16 }}>Opening DOCX…</div>;
  if (state.error) return <div className="card" style={{ padding: 16, color: "#ff9a9a", whiteSpace: "pre-wrap" }}>{state.error}</div>;

  return (
    <article
      className="card"
      style={{
        maxWidth: 920,
        margin: "0 auto",
        minHeight: "72vh",
        padding: "22px clamp(16px, 4vw, 44px)",
        whiteSpace: "pre-wrap",
        lineHeight: 1.65,
        overflowWrap: "anywhere",
      }}
    >
      {state.text || "This DOCX contains no readable text."}
    </article>
  );
}
