import React from "react";
import {
  GOOGLE_FONT_CATALOG,
  buildGoogleFontHref,
  normalizeFontFamilyName,
  detectFontFormat,
  uploadedFontsStorageKey,
  recentFontsStorageKey,
  readStoredJson,
  saveStoredJson,
} from "../utils/fonts.js";

export function useStudioFonts({ orgId = "", search = "" }) {
  const [uploadedFonts, setUploadedFonts] = React.useState(() => readStoredJson(uploadedFontsStorageKey(orgId), []));
  const [recentFamilies, setRecentFamilies] = React.useState(() => readStoredJson(recentFontsStorageKey(orgId), []));
  const [loadedFamilies, setLoadedFamilies] = React.useState(() => new Set());
  const [fontStatus, setFontStatus] = React.useState("");

  React.useEffect(() => {
    setUploadedFonts(readStoredJson(uploadedFontsStorageKey(orgId), []));
    setRecentFamilies(readStoredJson(recentFontsStorageKey(orgId), []));
  }, [orgId]);

  React.useEffect(() => {
    uploadedFonts.forEach((font) => {
      injectUploadedFont(font);
    });
  }, [uploadedFonts]);

  const availableFonts = React.useMemo(() => {
    const q = String(search || "").trim().toLowerCase();
    const list = GOOGLE_FONT_CATALOG.map((family) => ({ family, source: "google" }));
    if (!q) return list;
    return list.filter((item) => item.family.toLowerCase().includes(q));
  }, [search]);

  const recentFonts = React.useMemo(() => {
    return recentFamilies.map((family) => {
      const uploaded = uploadedFonts.find((font) => font.family === family);
      return uploaded ? uploaded : { id: `recent_${family}`, family, source: "google" };
    });
  }, [recentFamilies, uploadedFonts]);

  const markFontRecent = React.useCallback((family) => {
    const clean = String(family || "").trim();
    if (!clean) return;
    setRecentFamilies((prev) => {
      const next = [clean, ...prev.filter((item) => item !== clean)].slice(0, 12);
      saveStoredJson(recentFontsStorageKey(orgId), next);
      return next;
    });
  }, [orgId]);

  const ensureFontLoaded = React.useCallback((family) => {
    const clean = String(family || "").trim();
    if (!clean) return;
    if (loadedFamilies.has(clean)) return;

    const uploaded = uploadedFonts.find((font) => font.family === clean);
    if (uploaded) {
      injectUploadedFont(uploaded);
      setLoadedFamilies((prev) => {
        const next = new Set(prev);
        next.add(clean);
        return next;
      });
      setFontStatus(`Loaded ${clean}`);
      return;
    }

    const id = `bf_google_font_${slug(clean)}`;
    if (!document.getElementById(id)) {
      const link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      link.href = buildGoogleFontHref(clean);
      document.head.appendChild(link);
    }
    setLoadedFamilies((prev) => {
      const next = new Set(prev);
      next.add(clean);
      return next;
    });
    setFontStatus(`Loaded ${clean}`);
  }, [loadedFamilies, uploadedFonts]);

  const uploadFontFile = React.useCallback(async (file) => {
    const format = detectFontFormat(file);
    if (!format) throw new Error("Unsupported font type. Use WOFF2, WOFF, TTF, or OTF.");
    if (file.size > 2.5 * 1024 * 1024) throw new Error("Font file too large. Keep it under 2.5MB.");

    const family = normalizeFontFamilyName(file.name) || `Custom Font ${Date.now()}`;
    const dataUrl = await readFileAsDataUrl(file);
    const font = {
      id: `font_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      family,
      source: "uploaded",
      format,
      dataUrl,
      createdAt: Date.now(),
    };

    injectUploadedFont(font);
    setUploadedFonts((prev) => {
      const next = [font, ...prev.filter((item) => item.family !== family)];
      saveStoredJson(uploadedFontsStorageKey(orgId), next);
      return next;
    });
    markFontRecent(family);
    setLoadedFamilies((prev) => {
      const next = new Set(prev);
      next.add(family);
      return next;
    });
    setFontStatus(`Uploaded ${family}`);
    return font;
  }, [orgId, markFontRecent]);

  return {
    availableFonts,
    uploadedFonts,
    recentFonts,
    ensureFontLoaded,
    markFontRecent,
    uploadFontFile,
    fontStatus,
  };
}

function injectUploadedFont(font) {
  if (!font?.family || !font?.dataUrl || !font?.format) return;
  const id = `bf_uploaded_font_${slug(font.family)}`;
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `@font-face {
    font-family: "${font.family}";
    src: url("${font.dataUrl}") format("${font.format}");
    font-display: swap;
  }`;
  document.head.appendChild(style);
}

function slug(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
