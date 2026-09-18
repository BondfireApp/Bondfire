import React from "react";
import { useParams } from "react-router-dom";
import { api } from "../utils/api.js";
import { STUDIO_ASSETS } from "../data/studioAssets.js";
import { searchPixabayImages } from "../utils/pixabay.js";
import { buildQrCodeUrl } from "../utils/qr.js";
import { decryptWithOrgKey, encryptWithOrgKey, getCachedOrgKey } from "../lib/zk.js";
import { useStudioFonts } from "../hooks/useStudioFonts.js";
import { canApplyStudioRemoteSnapshot, cloneStudioElements, moveStudioElementsBetweenPages, normalizeStudioSyncMeta, updateStudioDocument, updateStudioPage } from "../studio/studioState.js";
import { Plus, LayoutGrid, Image as ImageIcon, Database, FileText } from "lucide-react";

const PRESETS = {
	flyer: { label: "Flyer", width: 1080, height: 1350 },
	square: { label: "Square Post", width: 1080, height: 1080 },
	story: { label: "Story", width: 1080, height: 1920 },
	banner: { label: "Banner", width: 1600, height: 900 },
};

const FALLBACK_FONT = "Inter";


const TEMPLATE_LIBRARY = {
	eventFlyer: {
		label: "Event Flyer",
		preset: "flyer",
		build: () => ({
			name: "Event Flyer",
			elements: [
				makeShapeElement({ x: 0, y: 0, width: 1080, height: 1350, fill: "#0f172a", radius: 0, name: "Background" }),
				makeTextElement({ text: "{{org.name}}", x: 90, y: 110, width: 900, height: 60, fontSize: 28, fontWeight: 700, color: "#fca5a5", name: "Org Name" }),
				makeTextElement({ text: "{{meeting.title}}", x: 90, y: 200, width: 900, height: 180, fontSize: 86, fontWeight: 800, lineHeight: 0.95, color: "#000000", name: "Title" }),
				makeTextElement({ text: "{{meeting.date}}\n{{meeting.location}}", x: 90, y: 420, width: 420, height: 200, fontSize: 34, fontWeight: 600, lineHeight: 1.2, color: "#e5e7eb", name: "Date + Location" }),
				makeShapeElement({ x: 610, y: 420, width: 320, height: 320, fill: "rgba(255,255,255,0.05)", stroke: "#fca5a5", strokeWidth: 2, radius: 24, name: "Image Frame" }),
				makeTextElement({ text: "{{org.contact}}", x: 90, y: 1175, width: 920, height: 34, fontSize: 22, fontWeight: 500, color: "#d1d5db", name: "Contact" }),
			],
		}),
	},
	needPost: {
		label: "Need Post",
		preset: "square",
		build: () => ({
			name: "Need Post",
			elements: [
				makeShapeElement({ x: 0, y: 0, width: 1080, height: 1080, fill: "#111827", radius: 0, name: "Background" }),
				makeTextElement({ text: "{{org.name}} needs", x: 80, y: 90, width: 920, height: 90, fontSize: 42, fontWeight: 700, color: "#fca5a5", name: "Heading" }),
				makeTextElement({ text: "{{need.title}}", x: 80, y: 220, width: 920, height: 170, fontSize: 82, fontWeight: 800, lineHeight: 0.95, color: "#ffffff", name: "Need Title" }),
				makeTextElement({ text: "{{need.description}}", x: 80, y: 450, width: 920, height: 250, fontSize: 30, fontWeight: 500, lineHeight: 1.25, color: "#e5e7eb", name: "Need Description" }),
				makeTextElement({ text: "{{org.contact}}", x: 80, y: 930, width: 920, height: 50, fontSize: 24, fontWeight: 500, color: "#d1d5db", name: "Contact" }),
			],
		}),
	},
	meetingCard: {
		label: "Meeting Graphic",
		preset: "story",
		build: () => ({
			name: "Meeting Graphic",
			elements: [
				makeShapeElement({ x: 0, y: 0, width: 1080, height: 1920, fill: "#0b1020", radius: 0, name: "Background" }),
				makeTextElement({ text: "{{org.name}}", x: 80, y: 120, width: 920, height: 70, fontSize: 34, fontWeight: 700, letterSpacing: 2, color: "#fca5a5", name: "Org Name" }),
				makeTextElement({ text: "{{meeting.title}}", x: 80, y: 260, width: 920, height: 260, fontSize: 98, fontWeight: 800, lineHeight: 0.92, color: "#ffffff", name: "Meeting Title" }),
				makeTextElement({ text: "{{meeting.date}}", x: 80, y: 630, width: 920, height: 80, fontSize: 38, fontWeight: 700, color: "#e5e7eb", name: "Meeting Date" }),
				makeTextElement({ text: "{{meeting.location}}", x: 80, y: 730, width: 920, height: 160, fontSize: 42, fontWeight: 600, lineHeight: 1.15, color: "#f9fafb", name: "Meeting Location" }),
			],
		}),
	},
	volunteerCall: {
		label: "Volunteer Call",
		preset: "banner",
		build: () => ({
			name: "Volunteer Call",
			elements: [
				makeShapeElement({ x: 0, y: 0, width: 1600, height: 900, fill: "#111827", radius: 0, name: "Background" }),
				makeTextElement({ text: "{{org.name}}", x: 100, y: 110, width: 1320, height: 50, fontSize: 28, fontWeight: 700, letterSpacing: 1.5, color: "#fca5a5", name: "Org Name" }),
				makeTextElement({ text: "volunteers needed", x: 100, y: 200, width: 840, height: 180, fontSize: 96, fontWeight: 800, lineHeight: 0.95, color: "#ffffff", name: "Heading" }),
				makeTextElement({ text: "{{need.title}}", x: 100, y: 430, width: 860, height: 120, fontSize: 42, fontWeight: 600, lineHeight: 1.1, color: "#e5e7eb", name: "Need Title" }),
				makeTextElement({ text: "{{org.contact}}", x: 100, y: 720, width: 860, height: 50, fontSize: 24, fontWeight: 500, color: "#d1d5db", name: "Contact" }),
			],
		}),
	},
};

const RULER_SIZE = 24;
const GUIDE_COLORS = {
	vertical: "rgba(239,68,68,0.85)",
	horizontal: "rgba(96,165,250,0.85)",
};

function storageKey(orgId) {
	return `bf_studio_docs_${orgId}`;
}

function blocksKey(orgId) {
	return `bf_studio_blocks_${orgId}`;
}

function studioSyncMetaKey(orgId) {
	return `bf_studio_sync_meta_${orgId}`;
}

function readStudioSyncMeta(orgId) {
	if (!orgId) return normalizeStudioSyncMeta(null);
	return normalizeStudioSyncMeta(readJson(studioSyncMetaKey(orgId), {}));
}

function saveStudioSyncMeta(orgId, meta) {
	if (!orgId) return;
	localStorage.setItem(studioSyncMetaKey(orgId), JSON.stringify(normalizeStudioSyncMeta(meta)));
}

function uid() {
	return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function clone(obj) {
	return JSON.parse(JSON.stringify(obj));
}

function isCorruptStudioNullText(el) {
	if (!el || el.type !== "text") return false;
	const text = String(el.text ?? "").trim();
	const x = Number(el.x || 0);
	const y = Number(el.y || 0);
	return /^:?\s*null\s*\}?$/i.test(text) && x <= 24 && y <= 24;
}

function sanitizeStudioElements(elements) {
	return (Array.isArray(elements) ? elements : []).filter((el) => !isCorruptStudioNullText(el));
}

function makePage(preset = "flyer", patch = {}) {
	return {
		id: uid(),
		width: PRESETS[preset]?.width || 1080,
		height: PRESETS[preset]?.height || 1350,
		background: "#ffffff",
		elements: [],
		guides: [],
		...patch,
	};
}

function normalizeDoc(doc) {
	if (!doc) return doc;
	if (Array.isArray(doc.pages) && doc.pages.length) {
		const firstPage = doc.pages[0] || makePage(doc.preset || "flyer");
		return {
			...doc,
			pages: doc.pages.map((page) => ({
				id: page?.id || uid(),
				width: Number(page?.width || doc.width || PRESETS[doc.preset]?.width || 1080),
				height: Number(page?.height || doc.height || PRESETS[doc.preset]?.height || 1350),
				background: page?.background || doc.background || "#ffffff",
				elements: sanitizeStudioElements(Array.isArray(page?.elements) ? page.elements : []),
				guides: Array.isArray(page?.guides) ? page.guides : [],
			})),
			width: Number(firstPage.width || doc.width || PRESETS[doc.preset]?.width || 1080),
			height: Number(firstPage.height || doc.height || PRESETS[doc.preset]?.height || 1350),
			background: firstPage.background || doc.background || "#ffffff",
			elements: sanitizeStudioElements(Array.isArray(firstPage.elements) ? firstPage.elements : []),
			guides: Array.isArray(firstPage.guides) ? firstPage.guides : [],
		};
	}
	const firstPage = makePage(doc.preset || "flyer", {
		width: Number(doc.width || PRESETS[doc.preset]?.width || 1080),
		height: Number(doc.height || PRESETS[doc.preset]?.height || 1350),
		background: doc.background || "#ffffff",
		elements: sanitizeStudioElements(Array.isArray(doc.elements) ? doc.elements : []),
		guides: Array.isArray(doc.guides) ? doc.guides : [],
	});
	return {
		...doc,
		width: firstPage.width,
		height: firstPage.height,
		background: firstPage.background,
		elements: firstPage.elements,
		guides: firstPage.guides,
		pages: [firstPage],
	};
}

function normalizeDocs(docs) {
	return (Array.isArray(docs) ? docs : []).map(normalizeDoc);
}

function makeDoc(preset = "flyer") {
	const firstPage = makePage(preset);
	return {
		id: uid(),
		name: `Untitled ${PRESETS[preset]?.label || "Design"}`,
		preset,
		width: firstPage.width,
		height: firstPage.height,
		background: firstPage.background,
		elements: firstPage.elements,
		guides: firstPage.guides,
		pages: [firstPage],
		updatedAt: Date.now(),
	};
}

function makeTextElement(patch = {}) {
	return {
		id: uid(),
		type: "text",
		name: patch.name || "Text",
		locked: false,
		hidden: false,
		text: "new text",
		x: 80,
		y: 80,
		width: 320,
		height: 80,
		rotation: 0,
		opacity: 1,
		fontSize: 36,
		fontWeight: 700,
		fontFamily: FALLBACK_FONT,
		lineHeight: 1.1,
		letterSpacing: 0,
		align: "left",
		color: "#000000",
		...patch,
	};
}

function makeShapeElement(patch = {}) {
	return {
		id: uid(),
		type: "shape",
		name: patch.name || "Shape",
		locked: false,
		hidden: false,
		x: 120,
		y: 120,
		width: 240,
		height: 160,
		rotation: 0,
		opacity: 1,
		fill: "#ef4444",
		stroke: "#ffffff",
		strokeWidth: 0,
		radius: 16,
		flipX: false,
		flipY: false,
		cropLeft: 0,
		cropRight: 0,
		cropTop: 0,
		cropBottom: 0,
		...patch,
	};
}

function makeImageElement(patch = {}) {
	return {
		id: uid(),
		type: "image",
		name: patch.name || "Image",
		locked: false,
		hidden: false,
		x: 140,
		y: 140,
		width: 320,
		height: 240,
		rotation: 0,
		opacity: 1,
		fit: "cover",
		src: "",
		flipX: false,
		flipY: false,
		cropLeft: 0,
		cropRight: 0,
		cropTop: 0,
		cropBottom: 0,
		...patch,
	};
}

function readJson(key, fallback) {
	try {
		const parsed = JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
		return parsed ?? fallback;
	} catch {
		return fallback;
	}
}

function readDocs(orgId) {
	if (!orgId) return [];
	return normalizeDocs(readJson(storageKey(orgId), []));
}

function saveDocs(orgId, docs) {
	localStorage.setItem(storageKey(orgId), JSON.stringify(normalizeDocs(docs)));
}

function readBlocks(orgId) {
	if (!orgId) return [];
	return readJson(blocksKey(orgId), []);
}

function saveBlocks(orgId, blocks) {
	localStorage.setItem(blocksKey(orgId), JSON.stringify(blocks));
}

async function loadStudioStateFromServer(orgId) {
	return api(`/api/orgs/${encodeURIComponent(orgId)}/studio/state`);
}

async function saveStudioStateToServer(orgId, payload) {
	return api(`/api/orgs/${encodeURIComponent(orgId)}/studio/state`, {
		method: "POST",
		body: JSON.stringify(payload),
	});
}

function openStudioUpdatesStream(orgId, onMessage) {
	if (!orgId || typeof window === "undefined" || typeof window.EventSource === "undefined") return null;
	const es = new window.EventSource(`/api/orgs/${encodeURIComponent(orgId)}/studio/updates`);
	const handle = (event) => {
		try {
			onMessage?.(JSON.parse(String(event?.data || "{}")));
		} catch {}
	};
	es.onmessage = handle;
	es.addEventListener("ready", handle);
	es.addEventListener("studio-updated", handle);
	return es;
}

function hasStudioRemoteRows(resp) {
	return !!((Array.isArray(resp?.docs) && resp.docs.length) || (Array.isArray(resp?.blocks) && resp.blocks.length));
}

function buildStudioRemoteSignature(resp) {
  if(resp?.private_mode)return `private:${resp.revision}`;
	const docsSig = (Array.isArray(resp?.docs) ? resp.docs : [])
		.map((row) => `${row?.id || ""}:${row?.updated_at || 0}`)
		.join("|");
	const blocksSig = (Array.isArray(resp?.blocks) ? resp.blocks : [])
		.map((row) => `${row?.id || ""}:${row?.updated_at || 0}`)
		.join("|");
	return `${docsSig}__${blocksSig}`;
}

async function decryptStudioStatePayload(orgId, resp) {
  if(resp?.private_mode)return {docs:normalizeDocs(resp.docs),blocks:resp.blocks};
	let orgKey = null;
	try { orgKey = getCachedOrgKey(orgId); } catch {}
	if (!orgKey) return null;
	const remoteDocs = [];
	for (const row of Array.isArray(resp?.docs) ? resp.docs : []) {
		if (!row?.encrypted_blob) continue;
		try {
			remoteDocs.push(normalizeDoc(JSON.parse(await decryptWithOrgKey(orgKey, row.encrypted_blob))));
		} catch {}
	}
	const remoteBlocks = [];
	for (const row of Array.isArray(resp?.blocks) ? resp.blocks : []) {
		if (!row?.encrypted_blob) continue;
		try {
			const parsed = JSON.parse(await decryptWithOrgKey(orgKey, row.encrypted_blob));
			if (parsed && parsed.id) remoteBlocks.push(parsed);
		} catch {}
	}
	return { docs: normalizeDocs(remoteDocs), blocks: remoteBlocks };
}

function getBrandKit(orgId) {
	const settings = readJson(`bf_org_settings_${orgId}`, {});
	return {
		name: String(settings?.name || "Bondfire Org"),
		primary: String(settings?.brandPrimary || settings?.primaryColor || "#ef4444"),
		secondary: String(settings?.brandSecondary || settings?.secondaryColor || "#111827"),
		accent: String(settings?.brandAccent || settings?.accentColor || "#fca5a5"),
		text: String(settings?.brandText || settings?.textColor || "#ffffff"),
	};
}

function getOrgBindings(orgId) {
	const orgs = readJson("bf_orgs", []);
	const settings = readJson(`bf_org_settings_${orgId}`, {});
	const meetings = readJson(`bf_meetings_${orgId}`, []);
	const needs = readJson(`bf_needs_${orgId}`, []);
	const org = Array.isArray(orgs) ? orgs.find((x) => String(x?.id) === String(orgId)) || {} : {};
	const firstMeeting = Array.isArray(meetings) ? meetings[0] || {} : {};
	const firstNeed = Array.isArray(needs) ? needs[0] || {} : {};
	const contact = settings?.publicEmail || settings?.contactEmail || settings?.email || settings?.contact || settings?.publicContact || "";
	const location = firstMeeting?.location || firstMeeting?.where || settings?.address || settings?.city || "";
	const date = firstMeeting?.startsAt || firstMeeting?.date || firstMeeting?.time || "";
	return {
		"org.name": String(settings?.name || org?.name || "Bondfire Org"),
		"org.contact": String(contact || "contact this org"),
		"meeting.title": String(firstMeeting?.title || firstMeeting?.name || "community meeting"),
		"meeting.date": String(date || "date tbd"),
		"meeting.location": String(location || "location tbd"),
		"need.title": String(firstNeed?.title || firstNeed?.name || "supplies and support"),
		"need.description": String(firstNeed?.description || firstNeed?.details || "bring what you can and spread the word"),
	};
}

function applyBindings(text, bindings) {
	if (typeof text !== "string") return text;
	return text.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_, token) => {
		const key = String(token || "").trim();
		return bindings[key] ?? `{{${key}}}`;
	});
}

function printableName(name, fallback = "design") {
	return String(name || fallback).trim().replace(/\s+/g, "-").replace(/[^a-zA-Z0-9-_]/g, "").toLowerCase() || fallback;
}

function downloadBlob(filename, blob) {
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 500);
}

function clamp(n, min, max) {
	return Math.max(min, Math.min(max, n));
}

function snapValue(value, targets, threshold = 8) {
	for (const target of targets) {
		if (Math.abs(value - target) <= threshold) return target;
	}
	return value;
}

function formatSavedAt(ts) {
	if (!ts) return "";
	return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function buildDriveImageUrl(orgId, fileId) {
	const encodedOrgId = encodeURIComponent(String(orgId || ""));
	const encodedFileId = encodeURIComponent(String(fileId || ""));
	return `/api/orgs/${encodedOrgId}/drive/files/${encodedFileId}/download`;
}

function getSelectionBounds(elements) {
	if (!elements.length) return null;
	const bounds = elements.map((el) => getElementBounds(el));
	const xs = bounds.map((b) => b.x);
	const ys = bounds.map((b) => b.y);
	const rights = bounds.map((b) => b.x + b.width);
	const bottoms = bounds.map((b) => b.y + b.height);
	const left = Math.min(...xs);
	const top = Math.min(...ys);
	const right = Math.max(...rights);
	const bottom = Math.max(...bottoms);
	return { left, top, width: right - left, height: bottom - top };
}

function intersectsRect(el, rect) {
	const bounds = getElementBounds(el);
	const left = bounds.x;
	const top = bounds.y;
	const right = left + bounds.width;
	const bottom = top + bounds.height;
	return !(right < rect.left || left > rect.left + rect.width || bottom < rect.top || top > rect.top + rect.height);
}

function withNewIds(elements) {
	return cloneStudioElements(elements, { offset: 24, idFactory: uid });
}

function makeGuide(orientation, position) {
	return { id: uid(), orientation, position };
}

function panelButtonStyle(active) {
	return {
		width: "100%",
		textAlign: "left",
		padding: "7px 9px",
		borderRadius: 10,
		border: active ? "1px solid rgba(239,68,68,0.6)" : "1px solid rgba(255,255,255,0.08)",
		background: active ? "rgba(239,68,68,0.14)" : "rgba(255,255,255,0.04)",
		color: "white",
	};
}

function iconButtonStyle(active) {
	return {
		width: 36,
		height: 36,
		padding: 0,
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		borderRadius: 10,
		border: active ? "1px solid rgba(239,68,68,0.6)" : "1px solid rgba(255,255,255,0.08)",
		background: active ? "rgba(239,68,68,0.16)" : "rgba(255,255,255,0.04)",
		color: "white",
		fontWeight: 700,
		lineHeight: 0,
	};
}


async function loadImageData(src) {
	return await new Promise((resolve, reject) => {
		const img = new Image();
		img.crossOrigin = "anonymous";
		img.onload = () => resolve(img);
		img.onerror = reject;
		img.src = src;
	});
}

function roundRectPath(ctx, x, y, width, height, radius) {
	const r = Math.max(0, Math.min(radius || 0, width / 2, height / 2));
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + width, y, x + width, y + height, r);
	ctx.arcTo(x + width, y + height, x, y + height, r);
	ctx.arcTo(x, y + height, x, y, r);
	ctx.arcTo(x, y, x + width, y, r);
	ctx.closePath();
}

function drawImageCover(ctx, img, x, y, width, height) {
	const iw = Math.max(1, Number(img?.naturalWidth || img?.width || 1));
	const ih = Math.max(1, Number(img?.naturalHeight || img?.height || 1));
	const scale = Math.max(width / iw, height / ih);
	const drawWidth = iw * scale;
	const drawHeight = ih * scale;
	const drawX = x + (width - drawWidth) / 2;
	const drawY = y + (height - drawHeight) / 2;
	ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
}

function svgMarkupToDataUrl(svg, fill = "#111111") {
	const safeFill = String(fill || "#111111");
	const markup = String(svg || "").replace(/currentColor/g, safeFill);
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
}

function makeSvgElement(asset, patch = {}) {
	return {
		id: uid(),
		type: "svg",
		name: patch.name || asset?.label || "Asset",
		locked: false,
		hidden: false,
		x: 140,
		y: 140,
		width: Number(patch.width || asset?.width || 180),
		height: Number(patch.height || asset?.height || 180),
		rotation: 0,
		opacity: 1,
		fill: patch.fill || "#111111",
		svg: asset?.svg || patch.svg || "",
		flipX: false,
		flipY: false,
		cropLeft: 0,
		cropRight: 0,
		cropTop: 0,
		cropBottom: 0,
		...patch,
	};
}

function getElementTransform(el) {
	const scaleX = el?.flipX ? -1 : 1;
	const scaleY = el?.flipY ? -1 : 1;
	return `rotate(${el?.rotation || 0}deg) scale(${scaleX}, ${scaleY})`;
}

function isCropCapableElement(el) {
	return el?.type === "image" || el?.type === "svg";
}

function getLegacyCropInsets(el) {
	const width = Math.max(1, Number(el?.width || 0));
	const height = Math.max(1, Number(el?.height || 0));
	const left = clamp(Number(el?.cropLeft || 0), 0, width - 1);
	const right = clamp(Number(el?.cropRight || 0), 0, Math.max(0, width - left - 1));
	const top = clamp(Number(el?.cropTop || 0), 0, height - 1);
	const bottom = clamp(Number(el?.cropBottom || 0), 0, Math.max(0, height - top - 1));
	return { left, right, top, bottom };
}

function getMediaFrame(el) {
	if (!isCropCapableElement(el)) return null;
	const frameX = Number(el?.x || 0);
	const frameY = Number(el?.y || 0);
	const frameWidth = Math.max(1, Number(el?.width || 1));
	const frameHeight = Math.max(1, Number(el?.height || 1));
	const explicitMediaWidth = Number(el?.mediaWidth || 0);
	const explicitMediaHeight = Number(el?.mediaHeight || 0);
	if (explicitMediaWidth > 0 && explicitMediaHeight > 0) {
		return {
			frameX,
			frameY,
			frameWidth,
			frameHeight,
			mediaX: Number(el?.mediaX ?? frameX),
			mediaY: Number(el?.mediaY ?? frameY),
			mediaWidth: explicitMediaWidth,
			mediaHeight: explicitMediaHeight,
		};
	}
	const legacy = getLegacyCropInsets(el);
	return {
		frameX,
		frameY,
		frameWidth,
		frameHeight,
		mediaX: frameX - legacy.left,
		mediaY: frameY - legacy.top,
		mediaWidth: frameWidth + legacy.left + legacy.right,
		mediaHeight: frameHeight + legacy.top + legacy.bottom,
	};
}

function deriveCropPatch(frame) {
	const cropLeft = Math.max(0, Math.round(frame.frameX - frame.mediaX));
	const cropTop = Math.max(0, Math.round(frame.frameY - frame.mediaY));
	const cropRight = Math.max(0, Math.round((frame.mediaX + frame.mediaWidth) - (frame.frameX + frame.frameWidth)));
	const cropBottom = Math.max(0, Math.round((frame.mediaY + frame.mediaHeight) - (frame.frameY + frame.frameHeight)));
	return {
		x: frame.frameX,
		y: frame.frameY,
		width: frame.frameWidth,
		height: frame.frameHeight,
		mediaX: frame.mediaX,
		mediaY: frame.mediaY,
		mediaWidth: frame.mediaWidth,
		mediaHeight: frame.mediaHeight,
		cropLeft,
		cropRight,
		cropTop,
		cropBottom,
	};
}

function getElementBounds(el) {
	if (!isCropCapableElement(el)) {
		return {
			x: Number(el?.x || 0),
			y: Number(el?.y || 0),
			width: Number(el?.width || 0),
			height: Number(el?.height || 0),
		};
	}
	const frame = getMediaFrame(el);
	return {
		x: frame.frameX,
		y: frame.frameY,
		width: frame.frameWidth,
		height: frame.frameHeight,
	};
}

function getContentFrame(el) {
	const frame = getMediaFrame(el);
	if (!frame) {
		return {
			frameX: Number(el?.x || 0),
			frameY: Number(el?.y || 0),
			frameWidth: Number(el?.width || 0),
			frameHeight: Number(el?.height || 0),
			contentWidth: Number(el?.width || 0),
			contentHeight: Number(el?.height || 0),
			offsetX: 0,
			offsetY: 0,
		};
	}
	return {
		frameX: frame.frameX,
		frameY: frame.frameY,
		frameWidth: frame.frameWidth,
		frameHeight: frame.frameHeight,
		contentWidth: frame.mediaWidth,
		contentHeight: frame.mediaHeight,
		offsetX: frame.mediaX - frame.frameX,
		offsetY: frame.mediaY - frame.frameY,
	};
}

function applyCropDrag(resizeState, handle, dx, dy) {
	const minVisible = 24;
	const mediaLeft = Number(resizeState?.mediaX ?? resizeState?.x ?? 0);
	const mediaTop = Number(resizeState?.mediaY ?? resizeState?.y ?? 0);
	const mediaWidth = Math.max(1, Number(resizeState?.mediaWidth || resizeState?.width || 1));
	const mediaHeight = Math.max(1, Number(resizeState?.mediaHeight || resizeState?.height || 1));
	const mediaRight = mediaLeft + mediaWidth;
	const mediaBottom = mediaTop + mediaHeight;
	let frameLeft = Number(resizeState?.x || 0);
	let frameTop = Number(resizeState?.y || 0);
	let frameRight = frameLeft + Math.max(1, Number(resizeState?.width || 1));
	let frameBottom = frameTop + Math.max(1, Number(resizeState?.height || 1));

	if (handle.includes("w")) frameLeft = clamp(frameLeft + dx, mediaLeft, frameRight - minVisible);
	if (handle.includes("e")) frameRight = clamp(frameRight + dx, frameLeft + minVisible, mediaRight);
	if (handle.includes("n")) frameTop = clamp(frameTop + dy, mediaTop, frameBottom - minVisible);
	if (handle.includes("s")) frameBottom = clamp(frameBottom + dy, frameTop + minVisible, mediaBottom);

	return deriveCropPatch({
		frameX: frameLeft,
		frameY: frameTop,
		frameWidth: frameRight - frameLeft,
		frameHeight: frameBottom - frameTop,
		mediaX: mediaLeft,
		mediaY: mediaTop,
		mediaWidth,
		mediaHeight,
	});
}

function StudioCroppedMedia({ el, common, src }) {
	const frame = getContentFrame(el);
	return (
		<div style={{ ...common, left: frame.frameX, top: frame.frameY, width: frame.frameWidth, height: frame.frameHeight, overflow: "hidden", borderRadius: 12 }}>
			<div
				style={{
					position: "absolute",
					left: frame.offsetX,
					top: frame.offsetY,
					width: frame.contentWidth,
					height: frame.contentHeight,
					pointerEvents: "none",
					userSelect: "none",
				}}
			>
				<img
					alt=""
					src={src}
					draggable={false}
					style={{
						display: "block",
						width: "100%",
						height: "100%",
						maxWidth: "none",
						maxHeight: "none",
						objectFit: "cover",
						pointerEvents: "none",
						userSelect: "none",
					}}
				/>
			</div>
		</div>
	);
}

async function renderDocToCanvas(doc, bindings) {
	const canvas = document.createElement("canvas");
	canvas.width = doc.width;
	canvas.height = doc.height;
	const ctx = canvas.getContext("2d");
	ctx.fillStyle = doc.background || "#ffffff";
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	for (const el of doc.elements || []) {
		if (el.hidden) continue;
		const bounds = getElementBounds(el);
		ctx.save();
		ctx.globalAlpha = Number(el.opacity ?? 1);
		ctx.translate(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
		ctx.rotate((Number(el.rotation || 0) * Math.PI) / 180);
		ctx.scale(el.flipX ? -1 : 1, el.flipY ? -1 : 1);
		ctx.translate(-bounds.width / 2, -bounds.height / 2);
		if (el.type === "shape") {
			ctx.save();
			roundRectPath(ctx, 0, 0, bounds.width, bounds.height, Number(el.radius || 0));
			ctx.fillStyle = el.fill || "transparent";
			ctx.fill();
			if (Number(el.strokeWidth || 0) > 0) {
				ctx.lineWidth = Number(el.strokeWidth || 0);
				ctx.strokeStyle = el.stroke || "transparent";
				ctx.stroke();
			}
			ctx.restore();
		} else if (el.type === "svg" && el.svg) {
			try {
				const img = await loadImageData(svgMarkupToDataUrl(el.svg, el.fill));
				const frame = getContentFrame(el);
				ctx.save();
				roundRectPath(ctx, 0, 0, frame.frameWidth, frame.frameHeight, 12);
				ctx.clip();
				drawImageCover(ctx, img, frame.offsetX, frame.offsetY, frame.contentWidth, frame.contentHeight);
				ctx.restore();
			} catch {}
		} else if (el.type === "image" && el.src) {
			try {
				const img = await loadImageData(el.src);
				const frame = getContentFrame(el);
				ctx.save();
				roundRectPath(ctx, 0, 0, frame.frameWidth, frame.frameHeight, 12);
				ctx.clip();
				drawImageCover(ctx, img, frame.offsetX, frame.offsetY, frame.contentWidth, frame.contentHeight);
				ctx.restore();
			} catch {}
		} else if (el.type === "text") {
			const text = applyBindings(el.text || "", bindings);
			ctx.fillStyle = el.color || "#fff";
			ctx.textBaseline = "top";
			ctx.font = `${Number(el.fontWeight || 700)} ${Number(el.fontSize || 36)}px ${el.fontFamily || FALLBACK_FONT}`;
			const lines = String(text).split("\n");
			const lineHeight = Number(el.fontSize || 36) * Number(el.lineHeight || 1.1);
			for (let i = 0; i < lines.length; i += 1) {
				const line = lines[i];
				const metrics = ctx.measureText(line);
				let x = 0;
				if (el.align === "center") x = (Number(el.width || 0) - metrics.width) / 2;
				if (el.align === "right") x = Number(el.width || 0) - metrics.width;
				ctx.fillText(line, x, i * lineHeight);
			}
		}
		ctx.restore();
	}
	return canvas;
}

export default function Studio() {
	const { orgId = "" } = useParams();
	const workspaceRef = React.useRef(null);
	const canvasShellRef = React.useRef(null);
	const pageShellRefs = React.useRef(new Map());
	const fileInputRef = React.useRef(null);
	const fontUploadRef = React.useRef(null);
	const dragPayloadRef = React.useRef(null);
	const suppressCanvasClickRef = React.useRef(false);

	const [docs, setDocs] = React.useState(() => readDocs(orgId));
	const [currentId, setCurrentId] = React.useState(() => readDocs(orgId)[0]?.id || null);
	const [activePageIndex, setActivePageIndex] = React.useState(0);
	const [selectedIds, setSelectedIds] = React.useState([]);
	const [history, setHistory] = React.useState([]);
	const [future, setFuture] = React.useState([]);
	const [savedAt, setSavedAt] = React.useState(0);
		const [showBoundPreview, setShowBoundPreview] = React.useState(true);
	const [leftPanel, setLeftPanel] = React.useState(null);
	const [customSize, setCustomSize] = React.useState({ width: 1080, height: 1080 });
	const [fileMenuOpen, setFileMenuOpen] = React.useState(false);
	const [exportMenuOpen, setExportMenuOpen] = React.useState(false);
	const [clipboard, setClipboard] = React.useState([]);
	const [contextMenu, setContextMenu] = React.useState(null);
	const [selectedGuideId, setSelectedGuideId] = React.useState(null);
	const [inspectorOpen, setInspectorOpen] = React.useState(false);
	const [docSettingsOpen, setDocSettingsOpen] = React.useState(false);
	const [tool, setTool] = React.useState("select");
	const [zoom, setZoom] = React.useState(0.42);
	const [pan, setPan] = React.useState({ x: 84, y: 56 });
	const [showRulers, setShowRulers] = React.useState(true);
	const [driveAssets, setDriveAssets] = React.useState([]);
	const [driveLoading, setDriveLoading] = React.useState(false);
	const [driveError, setDriveError] = React.useState("");
	const [assetSearch, setAssetSearch] = React.useState("");
	const [assetTab, setAssetTab] = React.useState("builtins");
	const [pixabayResults, setPixabayResults] = React.useState([]);
	const [pixabayLoading, setPixabayLoading] = React.useState(false);
	const [pixabayError, setPixabayError] = React.useState("");
	const [fontSearch, setFontSearch] = React.useState("");
	const [dragState, setDragState] = React.useState(null);
	const [resizeState, setResizeState] = React.useState(null);
	const [marquee, setMarquee] = React.useState(null);
	const [panState, setPanState] = React.useState(null);
	const [guideDrag, setGuideDrag] = React.useState(null);
	const [spacePan, setSpacePan] = React.useState(false);
	const [textEditId, setTextEditId] = React.useState(null);
	const [isMobileViewport, setIsMobileViewport] = React.useState(() => typeof window !== "undefined" ? window.innerWidth <= 900 : false);
	const [savedBlocks, setSavedBlocks] = React.useState(() => readBlocks(orgId));
	const [studioSyncMsg, setStudioSyncMsg] = React.useState("");
	const [studioRemoteNotice, setStudioRemoteNotice] = React.useState(null);
	const [studioKeyNotice, setStudioKeyNotice] = React.useState(null);
	const studioLoadedRef = React.useRef(false);
	const studioPrivateRevisionRef = React.useRef(null);
	const studioPrivateBaselineRef = React.useRef('');
	const studioSyncTimerRef = React.useRef(null);
	const studioLocalRevisionRef = React.useRef(0);
	const studioSyncedLocalRevisionRef = React.useRef(0);
	const studioSaveQueueRef = React.useRef(Promise.resolve());
	const studioRemoteSigRef = React.useRef("");
	const studioPendingRemoteRef = React.useRef(null);
	const studioLastLocalEditRef = React.useRef(0);
	const studioLastRemoteApplyRef = React.useRef(0);
	const studioLastSharedSaveRef = React.useRef(0);
	const studioStreamRef = React.useRef(null);
	const studioFastPollUntilRef = React.useRef(0);
	const studioNeedsRemoteHydrationRef = React.useRef(false);
	const studioHasAppliedRemoteRef = React.useRef(false);
	const studioInitialHydrationTimerRef = React.useRef(null);
	const pinchStateRef = React.useRef(null);
	const studioFetchRef = React.useRef(null);
	studioFetchRef.current=fetchAndApplyRemoteStudioState;

	React.useEffect(() => {
		let cancelled = false;
		studioLoadedRef.current = false;
		studioPrivateRevisionRef.current = null;
		studioPrivateBaselineRef.current = '';
		if (studioSyncTimerRef.current) {
			clearTimeout(studioSyncTimerRef.current);
			studioSyncTimerRef.current = null;
		}
		if (studioInitialHydrationTimerRef.current) {
			clearTimeout(studioInitialHydrationTimerRef.current);
			studioInitialHydrationTimerRef.current = null;
		}
		const cachedDocs = normalizeDocs(readDocs(orgId));
		const cachedBlocks = readBlocks(orgId);
		const cachedSyncMeta = readStudioSyncMeta(orgId);
		studioLocalRevisionRef.current = cachedSyncMeta.localRevision;
		studioSyncedLocalRevisionRef.current = cachedSyncMeta.syncedLocalRevision;
		studioSaveQueueRef.current = Promise.resolve();
		setDocs(cachedDocs);
		setSavedBlocks(cachedBlocks);
		setCurrentId(cachedDocs[0]?.id || null);
		setActivePageIndex(0);
		setSelectedIds([]);
		setTextEditId(null);
		setHistory([]);
		setFuture([]);
		setStudioSyncMsg("");
		setStudioRemoteNotice(null);
		setStudioKeyNotice(null);
		studioLastLocalEditRef.current = 0;
		studioLastRemoteApplyRef.current = 0;
		studioLastSharedSaveRef.current = 0;
		studioRemoteSigRef.current = "";
		studioPendingRemoteRef.current = null;
		studioNeedsRemoteHydrationRef.current = false;
		studioHasAppliedRemoteRef.current = false;

		(async () => {
if (!orgId) {
	studioLoadedRef.current = true;
	return;
}
try {
	await studioFetchRef.current({ queueIfBusy: false, forceApply: true, reason: "initial" });
} catch (err) {
	if (!cancelled) setStudioSyncMsg(String(err?.message || err || "Studio sync failed. Using local cache."));
} finally {
	if (!cancelled) studioLoadedRef.current = true;
}
		})();
		return () => { cancelled = true; };
	}, [orgId]);

	React.useEffect(() => {
		if (!studioLoadedRef.current || !orgId) return;
		if (studioHasAppliedRemoteRef.current) return;
		let cancelled = false;
		let tries = 0;

		const tryHydrate = async () => {
			if (cancelled) return;
			tries += 1;
			try {
				await studioFetchRef.current({ queueIfBusy: false, forceApply: true, reason: "rehydrate" });
			} catch {}
			if (cancelled) return;
			if (studioHasAppliedRemoteRef.current) {
				if (studioInitialHydrationTimerRef.current) {
					clearTimeout(studioInitialHydrationTimerRef.current);
					studioInitialHydrationTimerRef.current = null;
				}
				return;
			}
			if (tries >= 20 && !studioNeedsRemoteHydrationRef.current) return;
			studioInitialHydrationTimerRef.current = setTimeout(tryHydrate, studioNeedsRemoteHydrationRef.current ? 1200 : 1800);
		};

		tryHydrate();
		return () => {
			cancelled = true;
			if (studioInitialHydrationTimerRef.current) {
				clearTimeout(studioInitialHydrationTimerRef.current);
				studioInitialHydrationTimerRef.current = null;
			}
		};
	}, [orgId, studioLoadedRef.current, studioSyncMsg]);

	const bindings = React.useMemo(() => getOrgBindings(orgId), [orgId]);
	const brandKit = React.useMemo(() => getBrandKit(orgId), [orgId]);
	const {
		availableFonts,
		uploadedFonts,
		recentFonts,
		ensureFontLoaded,
		markFontRecent,
		uploadFontFile,
		fontStatus,
	} = useStudioFonts({ orgId, search: fontSearch });

	const currentDoc = React.useMemo(() => docs.find((doc) => doc.id === currentId) || null, [docs, currentId]);
	const currentPages = React.useMemo(() => {
		if (!currentDoc) return [];
		return Array.isArray(currentDoc.pages) && currentDoc.pages.length ? currentDoc.pages : [makePage(currentDoc.preset || "flyer", {
			width: currentDoc.width,
			height: currentDoc.height,
			background: currentDoc.background,
			elements: currentDoc.elements || [],
			guides: currentDoc.guides || [],
		})];
	}, [currentDoc]);
	const currentPage = React.useMemo(() => {
		if (!currentPages.length) return null;
		return currentPages[Math.max(0, Math.min(activePageIndex, currentPages.length - 1))] || currentPages[0] || null;
	}, [currentPages, activePageIndex]);
	const selectedElements = React.useMemo(() => (currentPage?.elements || []).filter((el) => selectedIds.includes(el.id)), [currentPage, selectedIds]);
	const selected = selectedElements.length === 1 ? selectedElements[0] : null;
	const selectionBounds = React.useMemo(() => getSelectionBounds(selectedElements), [selectedElements]);
	const orderedLayers = React.useMemo(() => (currentPage?.elements || []).map((el, idx) => ({ ...el, _order: idx + 1 })).reverse(), [currentPage]);

	React.useEffect(() => {
		if (selected?.type === "text" && selected?.fontFamily) {
			ensureFontLoaded(selected.fontFamily);
		}
	}, [selected?.id, selected?.type, selected?.fontFamily, ensureFontLoaded]);

	const markStudioLocalEdit = React.useCallback(() => {
		studioLastLocalEditRef.current = Date.now();
		const nextRevision = Math.max(studioLocalRevisionRef.current, studioSyncedLocalRevisionRef.current) + 1;
		studioLocalRevisionRef.current = nextRevision;
		saveStudioSyncMeta(orgId, { localRevision: nextRevision, syncedLocalRevision: studioSyncedLocalRevisionRef.current });
		return nextRevision;
	}, [orgId]);

	const commitDocs = React.useCallback((updater) => {
		markStudioLocalEdit();
		setDocs((prev) => {
			const next = normalizeDocs(typeof updater === "function" ? updater(prev) : updater);
			saveDocs(orgId, next);
			setSavedAt(Date.now());
			return next;
		});
	}, [orgId, markStudioLocalEdit]);

React.useEffect(() => {
	if (!studioLoadedRef.current || !orgId) return;
	const privateSnapshot=JSON.stringify({docs:normalizeDocs(docs),blocks:savedBlocks});
	if(studioPrivateRevisionRef.current!==null&&privateSnapshot===studioPrivateBaselineRef.current)return;
	const queuedLocalRevision = studioLocalRevisionRef.current;
	let orgKey = null;
	try { orgKey = getCachedOrgKey(orgId); } catch {}
	if (!orgKey) return;
	if (studioSyncTimerRef.current) clearTimeout(studioSyncTimerRef.current);
	studioSyncTimerRef.current = setTimeout(() => {
		studioSaveQueueRef.current = studioSaveQueueRef.current.catch(() => {}).then(async () => {
			if (queuedLocalRevision < studioLocalRevisionRef.current) return;
			const expectedPrivateRevision = studioPrivateRevisionRef.current;
		try {
			const encDocs = [];
			for (const doc of normalizeDocs(docs)) {
				encDocs.push({
					id: String(doc.id || ""),
					name: "__encrypted__",
					encrypted_blob: await encryptWithOrgKey(orgKey, JSON.stringify(normalizeDoc(doc))),
				});
			}
			const encBlocks = [];
			for (const block of Array.isArray(savedBlocks) ? savedBlocks : []) {
				encBlocks.push({
					id: String(block.id || ""),
					name: "__encrypted__",
					encrypted_blob: await encryptWithOrgKey(orgKey, JSON.stringify(block)),
				});
			}
			const saved=await saveStudioStateToServer(orgId, { docs: encDocs, blocks: encBlocks,
				...(expectedPrivateRevision!==null?{revision:expectedPrivateRevision}:{}) });
			if(saved.private_mode){studioPrivateRevisionRef.current=saved.revision;studioRemoteSigRef.current=`private:${saved.revision}`;if(queuedLocalRevision===studioLocalRevisionRef.current)studioPrivateBaselineRef.current=privateSnapshot;}
			studioLastSharedSaveRef.current = Date.now();
			studioFastPollUntilRef.current = Date.now() + 12000;
			if (queuedLocalRevision === studioLocalRevisionRef.current) {
				studioSyncedLocalRevisionRef.current = queuedLocalRevision;
				saveStudioSyncMeta(orgId, { localRevision: studioLocalRevisionRef.current, syncedLocalRevision: studioSyncedLocalRevisionRef.current });
				studioPendingRemoteRef.current = null;
				setStudioRemoteNotice(null);
				setStudioSyncMsg("");
			}
			
		} catch (err) {
			setStudioSyncMsg(String(err?.message || err || "Studio encrypted sync failed. Your local copy is still saved on this device."));
		}
		});
	}, 700);
	return () => {
		if (studioSyncTimerRef.current) {
			clearTimeout(studioSyncTimerRef.current);
			studioSyncTimerRef.current = null;
		}
	};
}, [orgId, docs, savedBlocks]);


React.useEffect(() => {
	if (!studioLoadedRef.current || !orgId) return;
	let cancelled = false;
	let intervalId = null;

	const poll = async () => {
		try {
			await studioFetchRef.current({ queueIfBusy: true, forceApply: false, reason: "poll" });
		} catch {}
	};

	const resetInterval = () => {
		if (intervalId) window.clearInterval(intervalId);
		const visible = typeof document !== "undefined" ? document.visibilityState === "visible" : true;
		const inFastMode = Date.now() < studioFastPollUntilRef.current || studioNeedsRemoteHydrationRef.current;
		const intervalMs = visible ? (inFastMode ? 1200 : 3000) : 12000;
		intervalId = window.setInterval(poll, intervalMs);
	};

	poll();
	resetInterval();
	const onVisible = () => {
		if (typeof document === "undefined") return;
		if (document.visibilityState === "visible") {
			studioFastPollUntilRef.current = Math.max(studioFastPollUntilRef.current, Date.now() + 8000);
			poll();
		}
		resetInterval();
	};
	const onFocus = () => {
		studioFastPollUntilRef.current = Math.max(studioFastPollUntilRef.current, Date.now() + 8000);
		poll();
		resetInterval();
	};
	window.addEventListener("visibilitychange", onVisible);
	window.addEventListener("focus", onFocus);
	return () => {
		cancelled = true;
		if (intervalId) window.clearInterval(intervalId);
		window.removeEventListener("visibilitychange", onVisible);
		window.removeEventListener("focus", onFocus);
	};
}, [orgId]);

React.useEffect(() => {
	if (!studioLoadedRef.current || !orgId) return;
	if (studioStreamRef.current) {
		try { studioStreamRef.current.close(); } catch {}
		studioStreamRef.current = null;
	}
	// Private workspaces already poll authenticated ciphertext; no legacy SSE URL.
	if(studioPrivateRevisionRef.current!==null)return;
	const es = openStudioUpdatesStream(orgId, async (payload) => {
		const sig = String(payload?.sig || "");
		if (!sig || sig === studioRemoteSigRef.current) return;
		studioFastPollUntilRef.current = Date.now() + 12000;
		
		try {
			await studioFetchRef.current({ queueIfBusy: true, forceApply: false, reason: "push" });
		} catch {}
	});
	studioStreamRef.current = es;
	return () => {
		if (studioStreamRef.current) {
			try { studioStreamRef.current.close(); } catch {}
			studioStreamRef.current = null;
		}
	};
}, [orgId]);

React.useEffect(() => {
	if (!studioLoadedRef.current || !orgId) return;
	if (!studioNeedsRemoteHydrationRef.current) return;
	let cancelled = false;
	const id = window.setTimeout(async () => {
		try {
			let orgKey = null;
			try { orgKey = getCachedOrgKey(orgId); } catch {}
			if (!orgKey) return;
			await studioFetchRef.current({ queueIfBusy: false, forceApply: true, reason: "rehydrate" });
		} catch {} 
	}, 600);
	return () => {
		cancelled = true;
		window.clearTimeout(id);
	};
}, [orgId, studioSyncMsg, docs.length, savedBlocks.length, textEditId, dragState, resizeState, marquee, panState, guideDrag]);

React.useEffect(() => {
	const pending = studioPendingRemoteRef.current;
	if (!pending) return;
	if (dragState || resizeState || marquee || panState || guideDrag || textEditId) return;
	if (studioLocalRevisionRef.current > studioSyncedLocalRevisionRef.current) return;
	if(studioPrivateRevisionRef.current!==null&&JSON.stringify({docs:normalizeDocs(docs),blocks:savedBlocks})!==studioPrivateBaselineRef.current)return;
	const debounceWindowMs = 900;
	const localEditAgeMs = Date.now() - Number(studioLastLocalEditRef.current || 0);
	if (studioLastLocalEditRef.current > studioLastSharedSaveRef.current) {
		if(studioPrivateRevisionRef.current!==null)return;
		if (localEditAgeMs <= debounceWindowMs) return;
	}
	const id = window.setTimeout(() => {
		studioRemoteSigRef.current = pending.sig;
		if(pending.revision!==undefined)studioPrivateRevisionRef.current=pending.revision;
		if(pending.revision!==undefined)studioPrivateBaselineRef.current=JSON.stringify(pending.remoteState);
		setDocs(pending.remoteState.docs);
		setSavedBlocks(pending.remoteState.blocks);
		saveDocs(orgId, pending.remoteState.docs);
		saveBlocks(orgId, pending.remoteState.blocks);
		setCurrentId((prev) => pending.remoteState.docs.some((doc) => doc.id === prev) ? prev : (pending.remoteState.docs[0]?.id || null));
		studioPendingRemoteRef.current = null;
		studioLastRemoteApplyRef.current = Date.now();
		studioSyncedLocalRevisionRef.current = studioLocalRevisionRef.current;
		saveStudioSyncMeta(orgId, { localRevision: studioLocalRevisionRef.current, syncedLocalRevision: studioSyncedLocalRevisionRef.current });
		studioHasAppliedRemoteRef.current = true;
		studioNeedsRemoteHydrationRef.current = false;
		setStudioRemoteNotice(null);
	}, 750);
	return () => window.clearTimeout(id);
}, [orgId, dragState, resizeState, marquee, panState, guideDrag, textEditId, docs]);


async function fetchAndApplyRemoteStudioState({ queueIfBusy = true, forceApply = false, reason = "poll" } = {}) {
	if (!orgId) return false;
	const requestLocalRevision = studioLocalRevisionRef.current;
	const resp = await loadStudioStateFromServer(orgId);
	const sig = buildStudioRemoteSignature(resp);
	const hasRemoteRows = hasStudioRemoteRows(resp);
	let orgKey = null;
	try { orgKey = getCachedOrgKey(orgId); } catch {}
	if (!orgKey) {
		studioNeedsRemoteHydrationRef.current = hasRemoteRows;
		if (hasRemoteRows) {
			setStudioKeyNotice({
				kind: "missing_key",
				text: "Studio found shared encrypted docs for this org, but this device cannot read them yet because the org key is missing. Restore the org key on this device to load the same Studio docs as your other devices.",
			});
			setStudioSyncMsg("Studio found synced docs but this device is still waiting for the org key.");
		}
		return false;
	}
	const remoteState = await decryptStudioStatePayload(orgId, resp);
	if (!remoteState) {
		studioNeedsRemoteHydrationRef.current = hasRemoteRows;
		if (hasRemoteRows) {
			setStudioKeyNotice({
				kind: "decrypt_wait",
				text: "Studio can see shared encrypted docs on the server, but this device cannot decrypt them yet. If they do not appear in a moment, restore or unlock the org key for this device.",
			});
		}
		return false;
	}
	const remoteDocs = remoteState.docs || [];
	const remoteBlocks = remoteState.blocks || [];
	if (hasRemoteRows && !remoteDocs.length && !remoteBlocks.length) {
		studioNeedsRemoteHydrationRef.current = true;
		setStudioKeyNotice({
			kind: "decrypt_empty",
			text: "Studio found shared encrypted docs, but this device still cannot decrypt them into usable files. This usually means the org key needs to be restored or unlocked here.",
		});
		setStudioSyncMsg("Studio found remote state but this device could not decrypt it yet.");
		return false;
	}
	if (!sig || sig === studioRemoteSigRef.current) {
		if (remoteDocs.length || remoteBlocks.length) {
			studioHasAppliedRemoteRef.current = true;
			studioNeedsRemoteHydrationRef.current = false;
			setStudioKeyNotice(null);
		}
		return false;
	}
	const hasActiveInteraction = !!(dragState || resizeState || marquee || panState || guideDrag || textEditId);
	const hasUnsyncedLocalEdits = studioLocalRevisionRef.current > studioSyncedLocalRevisionRef.current || (resp.private_mode
		? studioHasAppliedRemoteRef.current&&JSON.stringify({docs:normalizeDocs(docs),blocks:savedBlocks})!==studioPrivateBaselineRef.current
		: studioLastLocalEditRef.current > studioLastSharedSaveRef.current);
	const localAdvancedSinceRequest = studioLocalRevisionRef.current > requestLocalRevision;
	if (localAdvancedSinceRequest || hasUnsyncedLocalEdits || hasActiveInteraction) {
		studioPendingRemoteRef.current = { sig, remoteState, revision: resp.private_mode ? resp.revision : undefined, receivedAt: Date.now() };
		setStudioRemoteNotice({
			kind: "queued",
			text: hasUnsyncedLocalEdits || localAdvancedSinceRequest
				? "Remote changes are waiting because this device has newer unsynced Studio edits."
				: "Remote changes are waiting until the current Studio interaction finishes.",
		});
		return false;
	}
	const hasLocalDocs = Array.isArray(docs) && docs.length > 0;
	const hasLocalBlocks = Array.isArray(savedBlocks) && savedBlocks.length > 0;
	const needsAuthoritativeRemoteHydration = hasRemoteRows && (
		forceApply ||
		!studioHasAppliedRemoteRef.current ||
		studioNeedsRemoteHydrationRef.current ||
		(!hasLocalDocs && !hasLocalBlocks)
	);
	const debounceWindowMs = 900;
	const localEditAgeMs = Date.now() - Number(studioLastLocalEditRef.current || 0);
	const shouldTreatAsRealOverwriteRisk = hasUnsyncedLocalEdits && (resp.private_mode||localEditAgeMs > debounceWindowMs);
	if (!needsAuthoritativeRemoteHydration && !forceApply && queueIfBusy && (hasActiveInteraction || shouldTreatAsRealOverwriteRisk)) {
		studioPendingRemoteRef.current = { sig, remoteState, revision:resp.private_mode?resp.revision:undefined, receivedAt: Date.now() };
		if (shouldTreatAsRealOverwriteRisk) {
			setStudioRemoteNotice({
				kind: "queued",
				text: "Remote changes are waiting because this device still has unsynced local edits.",
			});
		} else {
			setStudioRemoteNotice(null);
		}
		return false;
	}
	studioRemoteSigRef.current = sig;
	if(resp.private_mode)studioPrivateRevisionRef.current=resp.revision;
	if(resp.private_mode)studioPrivateBaselineRef.current=JSON.stringify(remoteState);
	studioPendingRemoteRef.current = null;
	setDocs(remoteDocs);
	setSavedBlocks(remoteBlocks);
	saveDocs(orgId, remoteDocs);
	saveBlocks(orgId, remoteBlocks);
	setCurrentId((prev) => remoteDocs.some((doc) => doc.id === prev) ? prev : (remoteDocs[0]?.id || null));
	studioLastRemoteApplyRef.current = Date.now();
	studioLastSharedSaveRef.current = studioLastRemoteApplyRef.current;
	studioSyncedLocalRevisionRef.current = studioLocalRevisionRef.current;
	saveStudioSyncMeta(orgId, { localRevision: studioLocalRevisionRef.current, syncedLocalRevision: studioSyncedLocalRevisionRef.current });
	studioHasAppliedRemoteRef.current = true;
	studioNeedsRemoteHydrationRef.current = false;
	setStudioKeyNotice(null);
	setStudioRemoteNotice(null);
	setStudioSyncMsg("");
	
	return true;
}

	const snapshot = React.useCallback(() => {
		setHistory((prev) => [...prev, clone(docs)]);
		setFuture([]);
	}, [docs]);

	const ensureDoc = React.useCallback((preset = "flyer") => {
		if (currentDoc) return currentDoc.id;
		const doc = makeDoc(preset);
		const next = normalizeDocs([doc]);
		commitDocs(next);
		setCurrentId(doc.id);
		return doc.id;
	}, [currentDoc, commitDocs]);

	const fitCanvas = React.useCallback((doc = currentPage || currentDoc) => {
		if (!doc || !workspaceRef.current) return;
		const rect = workspaceRef.current.getBoundingClientRect();
		const availableWidth = Math.max(320, rect.width - 120);
		const availableHeight = Math.max(320, rect.height - 120);
		const nextZoom = clamp(Math.min(availableWidth / doc.width, availableHeight / doc.height), 0.1, 1.5);
		setZoom(nextZoom);
		setPan({
			x: Math.max(40, (rect.width - doc.width * nextZoom) / 2),
			y: 0,
		});
		if (workspaceRef.current) {
			workspaceRef.current.scrollTop = 0;
		}
	}, [currentPage, currentDoc]);

	React.useEffect(() => {
		if (currentDoc) {
			setTimeout(() => fitCanvas(currentPage || currentDoc), 0);
		}
	}, [currentId, activePageIndex]);

	React.useEffect(() => {
		const onResize = () => fitCanvas(currentPage || currentDoc);
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, [fitCanvas, currentId, activePageIndex]);

	const createDoc = React.useCallback((preset = "flyer") => {
		snapshot();
		const doc = makeDoc(preset);
		commitDocs((prev) => [doc, ...prev]);
		setCurrentId(doc.id);
		setActivePageIndex(0);
		setSelectedIds([]);
		setLeftPanel(null);
		setTimeout(() => fitCanvas(doc), 0);
	}, [snapshot, commitDocs, fitCanvas]);

	const createCustomDoc = React.useCallback(() => {
		const width = clamp(Number(customSize.width || 1080), 64, 8192);
		const height = clamp(Number(customSize.height || 1080), 64, 8192);
		snapshot();
		const base = makeDoc("square");
		const page = makePage("square", { width, height, background: "#ffffff", elements: [], guides: [] });
		const doc = normalizeDoc({ ...base, preset: "custom", name: "Untitled Custom Design", width, height, background: page.background, elements: [], guides: [], pages: [page], updatedAt: Date.now() });
		commitDocs((prev) => [doc, ...prev]);
		setCurrentId(doc.id);
		setActivePageIndex(0);
		setSelectedIds([]);
		setLeftPanel(null);
		setTimeout(() => fitCanvas(page), 0);
	}, [customSize, snapshot, commitDocs, fitCanvas]);

	const createTemplateDoc = React.useCallback((templateKey) => {
		const template = TEMPLATE_LIBRARY[templateKey];
		if (!template) return;
		snapshot();
		const base = makeDoc(template.preset);
		const built = template.build(bindings);
		const firstPage = makePage(template.preset, {
			width: base.width,
			height: base.height,
			background: base.background,
			elements: built.elements || [],
			guides: [],
		});
		const doc = normalizeDoc({ ...base, name: built.name || template.label, elements: firstPage.elements, guides: firstPage.guides, pages: [firstPage], updatedAt: Date.now() });
		commitDocs((prev) => [doc, ...prev]);
		setCurrentId(doc.id);
		setSelectedIds(doc.elements[0]?.id ? [doc.elements[0].id] : []);
		setLeftPanel(null);
		setTimeout(() => fitCanvas(doc), 0);
	}, [snapshot, commitDocs, bindings, fitCanvas]);

	const updateDocument = React.useCallback((patch) => {
		if (!currentDoc) return;
		commitDocs((prev) => prev.map((doc) => doc.id === currentDoc.id ? updateStudioDocument(doc, patch) : doc));
	}, [currentDoc, commitDocs]);

	const updatePage = React.useCallback((patch) => {
		if (!currentDoc) return;
		commitDocs((prev) => prev.map((doc) => doc.id === currentDoc.id ? updateStudioPage(doc, activePageIndex, patch) : doc));
	}, [currentDoc, activePageIndex, commitDocs]);

	const updateElements = React.useCallback((ids, patchOrFn) => {
		if (!currentDoc || !ids?.length) return;
		const idSet = new Set(ids);
		commitDocs((prev) => prev.map((doc) => {
			if (doc.id !== currentDoc.id) return doc;
			return commitToActivePage(doc, (page) => ({
				...page,
				elements: (page.elements || []).map((el) => {
					if (!idSet.has(el.id)) return el;
					const patch = typeof patchOrFn === "function" ? patchOrFn(el) : patchOrFn;
					return { ...el, ...patch };
				}),
			}));
		}));
	}, [currentDoc, commitDocs]);

	const updateElement = React.useCallback((elementId, patchOrFn) => {
		updateElements([elementId], patchOrFn);
	}, [updateElements]);

	const addText = () => {
		const docId = ensureDoc("flyer");
		snapshot();
		const element = makeTextElement();
		commitDocs((prev) => prev.map((doc) => doc.id !== docId ? doc : commitToActivePage(doc, (page) => ({ ...page, elements: [...(Array.isArray(page.elements) ? page.elements : []), element] }))));
		setCurrentId(docId);
		setSelectedIds([element.id]);
	};

	const addShape = () => {
		const docId = ensureDoc("flyer");
		snapshot();
		const element = makeShapeElement();
		commitDocs((prev) => prev.map((doc) => doc.id !== docId ? doc : commitToActivePage(doc, (page) => ({ ...page, elements: [...(Array.isArray(page.elements) ? page.elements : []), element] }))));
		setCurrentId(docId);
		setSelectedIds([element.id]);
	};

	const addImageFromSrc = React.useCallback((src, name = "Image") => {
		const docId = ensureDoc(currentDoc?.preset || "flyer");
		snapshot();
		const element = makeImageElement({ src, name, mediaX: 140, mediaY: 140, mediaWidth: 320, mediaHeight: 240 });
		commitDocs((prev) => prev.map((doc) => doc.id !== docId ? doc : commitToActivePage(doc, (page) => ({ ...page, elements: [...(Array.isArray(page.elements) ? page.elements : []), element] }))));
		setCurrentId(docId);
		setSelectedIds([element.id]);
	}, [ensureDoc, currentDoc, snapshot, commitDocs]);

	
	const addSvgAsset = (asset) => {
		if (!asset) return;
		const docId = ensureDoc(currentDoc?.preset || "flyer");
		snapshot();
		const element = makeSvgElement(asset, { name: asset.label, fill: brandKit.primary || "#111111", mediaX: 140, mediaY: 140, mediaWidth: Number(asset?.width || 180), mediaHeight: Number(asset?.height || 180) });
		commitDocs((prev) => prev.map((doc) => doc.id !== docId ? doc : commitToActivePage(doc, (page) => ({
			...page,
			elements: [...(Array.isArray(page.elements) ? page.elements : []), element],
		}))));
		setCurrentId(docId);
		setSelectedIds([element.id]);
	};

	const placeImageAtPoint = React.useCallback((src, name, point, pageIndex = activePageIndex) => {
		const docId = ensureDoc(currentDoc?.preset || "flyer");
		snapshot();
		const element = makeImageElement({
			src,
			name: name || "Image",
			x: Math.max(0, Number(point?.x || 0) - 160),
			y: Math.max(0, Number(point?.y || 0) - 120),
			mediaX: Math.max(0, Number(point?.x || 0) - 160),
			mediaY: Math.max(0, Number(point?.y || 0) - 120),
			mediaWidth: 320,
			mediaHeight: 240,
		});
		commitDocs((prev) => prev.map((doc) => doc.id !== docId ? doc : updateStudioPage(doc, pageIndex, (page) => ({
			...page,
			elements: [...(Array.isArray(page.elements) ? page.elements : []), element],
		}))));
		setCurrentId(docId);
		setSelectedIds([element.id]);
	}, [ensureDoc, currentDoc, snapshot, commitDocs, activePageIndex]);

	const placeSvgAtPoint = React.useCallback((asset, point, pageIndex = activePageIndex) => {
		if (!asset?.svg) return;
		const docId = ensureDoc(currentDoc?.preset || "flyer");
		snapshot();
		const element = makeSvgElement(asset, {
			name: asset.label || "Asset",
			fill: brandKit.primary || "#111111",
			x: Math.max(0, Number(point?.x || 0) - Number(asset.width || 180) / 2),
			y: Math.max(0, Number(point?.y || 0) - Number(asset.height || 180) / 2),
			mediaX: Math.max(0, Number(point?.x || 0) - Number(asset.width || 180) / 2),
			mediaY: Math.max(0, Number(point?.y || 0) - Number(asset.height || 180) / 2),
			mediaWidth: Number(asset.width || 180),
			mediaHeight: Number(asset.height || 180),
		});
		commitDocs((prev) => prev.map((doc) => doc.id !== docId ? doc : updateStudioPage(doc, pageIndex, (page) => ({
			...page,
			elements: [...(Array.isArray(page.elements) ? page.elements : []), element],
		}))));
		setCurrentId(docId);
		setSelectedIds([element.id]);
	}, [ensureDoc, currentDoc, snapshot, commitDocs, brandKit.primary, activePageIndex]);

	const setAssetDragImage = (e) => {
		if (!e?.dataTransfer?.setDragImage || !e?.currentTarget?.cloneNode) return;
		try {
			const ghost = e.currentTarget.cloneNode(true);
			ghost.style.position = "fixed";
			ghost.style.top = "-10000px";
			ghost.style.left = "-10000px";
			ghost.style.width = `${Math.min(160, Math.max(96, e.currentTarget.getBoundingClientRect().width || 120))}px`;
			ghost.style.pointerEvents = "none";
			ghost.style.opacity = "0.96";
			ghost.style.transform = "none";
			ghost.style.zIndex = "9999";
			document.body.appendChild(ghost);
			e.dataTransfer.setDragImage(ghost, 16, 16);
			window.setTimeout(() => ghost.remove(), 0);
		} catch {}
	};

	const loadPixabayAssets = React.useCallback(async () => {
		const query = assetSearch.trim() || "community poster";
		setPixabayLoading(true);
		setPixabayError("");
		try {
			const results = await searchPixabayImages(query);
			setPixabayResults(results);
		} catch (err) {
			setPixabayError(String(err?.message || err || "Failed to load Pixabay results"));
		} finally {
			setPixabayLoading(false);
		}
	}, [assetSearch]);
	const addQrCode = () => {
		const value = window.prompt("Enter the URL or text for this QR code:");
		if (!value) return;
		const docId = ensureDoc(currentDoc?.preset || "flyer");
		snapshot();
		const element = makeImageElement({
			name: "QR Code",
			src: buildQrCodeUrl(value),
			qrValue: value,
			qrFg: "#000000",
			qrBg: "#ffffff",
			width: 220,
			height: 220,
		});
		commitDocs((prev) => prev.map((doc) => doc.id !== docId ? doc : commitToActivePage(doc, (page) => ({
			...page,
			elements: [...(Array.isArray(page.elements) ? page.elements : []), element],
		}))));
		setCurrentId(docId);
		setSelectedIds([element.id]);
	};

const addImage = () => {
		fileInputRef.current?.click();
	};

	const onUploadImage = (e) => {
		const file = e.target.files?.[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = () => addImageFromSrc(String(reader.result || ""), file.name || "Image");
		reader.readAsDataURL(file);
		e.target.value = "";
	};

	const onUploadFont = async (e) => {
		const file = e.target.files?.[0];
		if (!file) return;
		try {
			const uploaded = await uploadFontFile(file);
			if (selected?.type === "text" && uploaded?.family) {
				updateElement(selected.id, { fontFamily: uploaded.family });
				markFontRecent(uploaded.family);
			}
		} catch (err) {
			window.alert(String(err?.message || err || "Failed to upload font"));
		}
		e.target.value = "";
	};

	const loadDriveAssets = React.useCallback(async () => {
		if (!orgId) return;
		setDriveLoading(true);
		setDriveError("");
		try {
			const data = await api(`/api/orgs/${encodeURIComponent(orgId)}/drive`);
			const files = Array.isArray(data?.files) ? data.files : [];
			const images = await Promise.all(files
				.filter((file) => String(file?.mime || "").startsWith("image/"))
				.map(async(file) => {
					if(data.private_mode){const opened=await api(`/api/orgs/${encodeURIComponent(orgId)}/drive/files/${encodeURIComponent(file.id)}`);return {...file,previewUrl:opened.file.dataUrl};}
					return {...file,previewUrl:buildDriveImageUrl(orgId,file.id)};
				}));
			setDriveAssets(images);
		} catch (err) {
			setDriveError(String(err?.message || err || "Failed to load Drive assets"));
		} finally {
			setDriveLoading(false);
		}
	}, [orgId]);

	React.useEffect(() => {
		if (leftPanel === "assets" && assetTab === "drive" && !driveAssets.length && !driveLoading) {
			loadDriveAssets();
		}
	}, [leftPanel, assetTab, driveAssets.length, driveLoading, loadDriveAssets]);

	const removeSelected = () => {
		if (!currentDoc || !selectedIds.length) return;
		snapshot();
		const selectedSet = new Set(selectedIds);
		commitDocs((prev) => prev.map((doc) => doc.id !== currentDoc.id ? doc : commitToActivePage(doc, (page) => ({ ...page, elements: (page.elements || []).filter((el) => !selectedSet.has(el.id)) }))));
		setSelectedIds([]);
	};

	const duplicateSelected = () => {
		if (!currentDoc || !selectedIds.length) return;
		snapshot();
		const toDup = (currentPage?.elements || []).filter((el) => selectedIds.includes(el.id));
		const dupes = withNewIds(toDup).map((el) => ({ ...el, name: `${el.name || el.type} Copy` }));
		commitDocs((prev) => prev.map((doc) => doc.id !== currentDoc.id ? doc : commitToActivePage(doc, (page) => ({ ...page, elements: [...(Array.isArray(page.elements) ? page.elements : []), ...dupes] }))));
		setSelectedIds(dupes.map((el) => el.id));
	};

	const copySelected = () => {
		if (!currentDoc || !selectedIds.length) return;
		const copied = (currentPage?.elements || []).filter((el) => selectedIds.includes(el.id)).map((el) => clone(el));
		setClipboard(copied);
	};

	const pasteClipboard = () => {
		if (!currentDoc || !Array.isArray(clipboard) || !clipboard.length || !clipboard.every((item) => item && typeof item === "object" && !Array.isArray(item))) return;
		snapshot();
		const pasted = withNewIds(clipboard).map((el) => ({
			...el,
			name: `${el.name || el.type} Copy`,
		}));
		commitDocs((prev) => prev.map((doc) => doc.id !== currentDoc.id ? doc : commitToActivePage(doc, (page) => ({ ...page, elements: [...(Array.isArray(page.elements) ? page.elements : []), ...pasted] }))));
		setSelectedIds(pasted.map((el) => el.id));
	};

	const cutSelected = () => {
		if (!currentDoc || !selectedIds.length) return;
		copySelected();
		removeSelected();
	};

	const moveLayer = (dir) => {
		if (!currentDoc || !selectedIds.length) return;
		snapshot();
		const selectedSet = new Set(selectedIds);
		const elements = (currentPage?.elements || []).slice();
		if (dir === "up") {
			for (let i = elements.length - 2; i >= 0; i -= 1) {
				if (selectedSet.has(elements[i].id) && !selectedSet.has(elements[i + 1].id)) {
					[elements[i], elements[i + 1]] = [elements[i + 1], elements[i]];
				}
			}
		} else {
			for (let i = 1; i < elements.length; i += 1) {
				if (selectedSet.has(elements[i].id) && !selectedSet.has(elements[i - 1].id)) {
					[elements[i], elements[i - 1]] = [elements[i - 1], elements[i]];
				}
			}
		}
		commitDocs((prev) => prev.map((doc) => doc.id !== currentDoc.id ? doc : commitToActivePage(doc, { elements })));
	};

	const setFlagOnSelection = (key, value) => {
		if (!selectedIds.length) return;
		snapshot();
		updateElements(selectedIds, { [key]: value });
	};

	const toggleSelectedFlag = (key) => {
		if (!selectedElements.length) return;
		const next = !selectedElements.every((el) => !!el[key]);
		setFlagOnSelection(key, next);
	};

	const insertBindingToken = (token) => {
		if (!selected || selected.type !== "text") return;
		snapshot();
		updateElement(selected.id, { text: `${selected.text || ""}${selected.text ? "\n" : ""}{{${token}}}` });
	};

	const addBoundText = (token, label) => {
		const docId = ensureDoc("flyer");
		snapshot();
		const element = makeTextElement({ name: label, text: `{{${token}}}`, x: 80, y: 80 + ((currentPage?.elements?.length || 0) * 24), width: 420, height: 80 });
		commitDocs((prev) => prev.map((doc) => doc.id !== docId ? doc : commitToActivePage(doc, (page) => ({ ...page, elements: [...(Array.isArray(page.elements) ? page.elements : []), element] }))));
		setCurrentId(docId);
		setSelectedIds([element.id]);
	};

	const saveCurrentDoc = () => {
		saveDocs(orgId, normalizeDocs(docs));
		setSavedAt(Date.now());
	};

	const duplicateDoc = () => {
		if (!currentDoc) return;
		snapshot();
		const copy = clone(currentDoc);
		copy.id = uid();
		copy.name = `${currentDoc.name || "Untitled"} Copy`;
		copy.updatedAt = Date.now();
		copy.elements = withNewIds(copy.elements || []);
		copy.guides = (copy.guides || []).map((g) => ({ ...g, id: uid() }));
		copy.pages = (copy.pages || []).map((page, index) => ({
			...page,
			id: uid(),
			elements: index === 0 ? copy.elements : withNewIds(page.elements || []),
			guides: (page.guides || []).map((g) => ({ ...g, id: uid() })),
		}));
		commitDocs((prev) => [copy, ...prev]);
		setCurrentId(copy.id);
		setActivePageIndex(0);
		setSelectedIds([]);
		setFileMenuOpen(false);
		setLeftPanel(null);
		setTimeout(() => fitCanvas(copy), 0);
	};

	const addPage = () => {
		const nextPreset = currentDoc?.preset || "flyer";
		if (!currentDoc) {
			createDoc(nextPreset);
			return;
		}
		snapshot();
		const page = makePage(nextPreset, {
			width: currentPage?.width || currentDoc.width,
			height: currentPage?.height || currentDoc.height,
			background: currentPage?.background || currentDoc.background,
		});
		commitDocs((prev) => prev.map((doc) => doc.id !== currentDoc.id ? doc : normalizeDoc({
			...doc,
			pages: [...(Array.isArray(doc.pages) && doc.pages.length ? doc.pages : [makePage(doc.preset || nextPreset, {
				width: doc.width,
				height: doc.height,
				background: doc.background,
				elements: doc.elements || [],
				guides: doc.guides || [],
			})]), page],
			updatedAt: Date.now(),
		})));
		setActivePageIndex(currentPages.length);
		setSelectedIds([]);
	};

	const duplicatePage = (pageIndex) => {
		if (!currentDoc || !currentPages[pageIndex]) return;
		snapshot();
		const sourcePage = currentPages[pageIndex];
		const copyPage = {
			...clone(sourcePage),
			id: uid(),
			elements: withNewIds(sourcePage.elements || []),
			guides: (sourcePage.guides || []).map((guide) => ({ ...guide, id: uid() })),
		};
		commitDocs((prev) => prev.map((doc) => {
			if (doc.id !== currentDoc.id) return doc;
			const pages = Array.isArray(doc.pages) && doc.pages.length ? doc.pages.slice() : [makePage(doc.preset || currentDoc.preset || "flyer", {
				width: doc.width,
				height: doc.height,
				background: doc.background,
				elements: doc.elements || [],
				guides: doc.guides || [],
			})];
			pages.splice(pageIndex + 1, 0, copyPage);
			return normalizeDoc({ ...doc, pages, updatedAt: Date.now() });
		}));
		setActivePageIndex(pageIndex + 1);
		setSelectedIds([]);
	};

	const deletePage = (pageIndex) => {
		if (!currentDoc || currentPages.length <= 1) return;
		snapshot();
		commitDocs((prev) => prev.map((doc) => {
			if (doc.id !== currentDoc.id) return doc;
			const pages = (Array.isArray(doc.pages) ? doc.pages : []).filter((_, index) => index !== pageIndex);
			return normalizeDoc({ ...doc, pages, updatedAt: Date.now() });
		}));
		setActivePageIndex((prev) => {
			if (prev > pageIndex) return prev - 1;
			if (prev === pageIndex) return Math.max(0, pageIndex - 1);
			return prev;
		});
		setSelectedIds([]);
	};

	const deleteDoc = (docId) => {
		const target = docs.find((doc) => doc.id === docId);
		if (!target) return;
		if (!window.confirm(`Delete "${target.name}"?`)) return;
		snapshot();
		const next = normalizeDocs(docs.filter((doc) => doc.id !== docId));
		commitDocs(next);
		if (currentId === docId) {
			setCurrentId(next[0]?.id || null);
			setSelectedIds([]);
		}
		setFileMenuOpen(false);
		setLeftPanel(null);
	};

	const saveSelectionAsBlock = () => {
		if (!selected) return;
		const next = [{ id: uid(), name: selected.name || `${selected.type} Block`, element: clone(selected), createdAt: Date.now() }, ...savedBlocks];
		markStudioLocalEdit();
		setSavedBlocks(next);
		saveBlocks(orgId, next);
	};

	const addSavedBlock = (block) => {
		if (!block) return;
		const element = { ...clone(block.element), id: uid(), x: Number(block.element?.x || 80) + 24, y: Number(block.element?.y || 80) + 24, name: `${block.name} Copy` };
		const docId = ensureDoc(currentDoc?.preset || "flyer");
		snapshot();
		commitDocs((prev) => prev.map((doc) => doc.id !== docId ? doc : commitToActivePage(doc, (page) => ({ ...page, elements: [...(Array.isArray(page.elements) ? page.elements : []), element] }))));
		setCurrentId(docId);
		setSelectedIds([element.id]);
	};

	const removeSavedBlock = (blockId) => {
		const next = savedBlocks.filter((block) => block.id !== blockId);
		markStudioLocalEdit();
		setSavedBlocks(next);
		saveBlocks(orgId, next);
	};

	const groupSelection = () => {
		if (selectedIds.length < 2) return;
		const groupId = uid();
		snapshot();
		updateElements(selectedIds, (el) => ({ groupId, groupName: el.groupName || `Group ${groupId.slice(-4)}` }));
	};

	const ungroupSelection = () => {
		const groups = [...new Set(selectedElements.map((el) => el.groupId).filter(Boolean))];
		if (!groups.length) return;
		snapshot();
		const ids = (currentPage?.elements || []).filter((el) => groups.includes(el.groupId)).map((el) => el.id);
		updateElements(ids, { groupId: null, groupName: null });
	};

	const groupSpecificIds = (ids) => {
		const clean = [...new Set((ids || []).filter(Boolean))];
		if (clean.length < 2) return;
		const groupId = uid();
		snapshot();
		updateElements(clean, (el) => ({ groupId, groupName: el.groupName || `Group ${groupId.slice(-4)}` }));
		setSelectedIds(clean);
	};

	const ungroupSpecificIds = (ids) => {
		const clean = [...new Set((ids || []).filter(Boolean))];
		if (!clean.length) return;
		snapshot();
		const groupIds = [...new Set((currentPage?.elements || []).filter((el) => clean.includes(el.id)).map((el) => el.groupId).filter(Boolean))];
		if (!groupIds.length) return;
		const allIds = (currentPage?.elements || []).filter((el) => groupIds.includes(el.groupId)).map((el) => el.id);
		updateElements(allIds, { groupId: null, groupName: null });
		setSelectedIds(allIds);
	};

	const addGuide = (orientation, position) => {
		if (!currentDoc) return;
		snapshot();
		updatePage({ guides: [...(currentPage?.guides || []), makeGuide(orientation, position ?? (orientation === "vertical" ? Number(currentPage?.width || 0) / 2 : Number(currentPage?.height || 0) / 2))] });
	};

	const removeGuide = (guideId) => {
		if (!currentDoc) return;
		snapshot();
		updatePage({ guides: (currentPage?.guides || []).filter((guide) => guide.id !== guideId) });
	};

	const undo = () => {
		setHistory((prev) => {
			if (!prev.length) return prev;
			const last = prev[prev.length - 1];
			setFuture((f) => [clone(docs), ...f]);
			markStudioLocalEdit();
			setDocs(last);
			saveDocs(orgId, last);
			setSavedAt(Date.now());
			setSelectedIds([]);
			return prev.slice(0, -1);
		});
	};

	const redo = () => {
		setFuture((prev) => {
			if (!prev.length) return prev;
			const [first, ...rest] = prev;
			setHistory((h) => [...h, clone(docs)]);
			markStudioLocalEdit();
			setDocs(first);
			saveDocs(orgId, first);
			setSavedAt(Date.now());
			setSelectedIds([]);
			return rest;
		});
	};

	React.useEffect(() => {
		const onKeyDown = (e) => {
			const tag = document.activeElement?.tagName?.toLowerCase();
			const isTyping = tag === "input" || tag === "textarea" || document.activeElement?.contentEditable === "true";
			if (e.code === "Space" && !isTyping) {
				e.preventDefault();
				setSpacePan(true);
			}
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
				e.preventDefault();
				if (e.shiftKey) redo();
				else undo();
				return;
			}
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
				e.preventDefault();
				redo();
				return;
			}
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d" && selectedIds.length && !isTyping) {
				e.preventDefault();
				duplicateSelected();
				return;
			}
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c" && selectedIds.length && !isTyping) {
				e.preventDefault();
				copySelected();
				return;
			}
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "x" && selectedIds.length && !isTyping) {
				e.preventDefault();
				cutSelected();
				return;
			}
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v" && clipboard.length && !isTyping) {
				e.preventDefault();
				pasteClipboard();
				return;
			}
			if ((e.key === "Delete" || e.key === "Backspace") && !isTyping) {
				if (selectedGuideId) {
					e.preventDefault();
					removeGuide(selectedGuideId);
					setSelectedGuideId(null);
					return;
				}
				if (selectedIds.length) {
					e.preventDefault();
					removeSelected();
					return;
				}
			}
			if (selectedElements.length && !isTyping) {
				const movable = selectedElements.filter((el) => !el.locked).map((el) => el.id);
				if (!movable.length) return;
				const step = e.shiftKey ? 10 : 1;
				if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
					e.preventDefault();
					snapshot();
					updateElements(movable, (el) => ({
						x: e.key === "ArrowLeft" ? Math.max(0, Number(el.x || 0) - step) : e.key === "ArrowRight" ? Number(el.x || 0) + step : Number(el.x || 0),
						y: e.key === "ArrowUp" ? Math.max(0, Number(el.y || 0) - step) : e.key === "ArrowDown" ? Number(el.y || 0) + step : Number(el.y || 0),
					}));
				}
			}
		};
		const onKeyUp = (e) => {
			if (e.code === "Space") setSpacePan(false);
		};
		window.addEventListener("keydown", onKeyDown);
		window.addEventListener("keyup", onKeyUp);
		return () => {
			window.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("keyup", onKeyUp);
		};
	}, [selectedIds, selectedElements, docs, undo, redo, updateElements, snapshot, clipboard, currentDoc, commitDocs, selectedGuideId]);

	const selectElement = React.useCallback((el, add = false) => {
		if (!el) return;
		const idsForElement = el.groupId ? (currentPage?.elements || []).filter((item) => item.groupId === el.groupId).map((item) => item.id) : [el.id];
		setSelectedIds((prev) => {
			if (!add) return idsForElement;
			const next = new Set(prev);
			let allPresent = idsForElement.every((id) => next.has(id));
			idsForElement.forEach((id) => {
				if (allPresent) next.delete(id);
				else next.add(id);
			});
			return [...next];
		});
	}, [currentDoc]);

	const getEventClientPoint = (e) => {
		const touch = e?.touches?.[0] || e?.changedTouches?.[0] || null;
		return {
			clientX: touch ? touch.clientX : e.clientX,
			clientY: touch ? touch.clientY : e.clientY,
		};
	};

	const getTouchDistance = (touches) => {
		if (!touches || touches.length < 2) return 0;
		const dx = Number(touches[0].clientX || 0) - Number(touches[1].clientX || 0);
		const dy = Number(touches[0].clientY || 0) - Number(touches[1].clientY || 0);
		return Math.sqrt(dx * dx + dy * dy);
	};

	const getPageTargetAtClientPoint = React.useCallback((clientX, clientY) => {
		for (let pageIndex = 0; pageIndex < currentPages.length; pageIndex += 1) {
			const page = currentPages[pageIndex];
			const node = pageShellRefs.current.get(page.id);
			const rect = node?.getBoundingClientRect?.();
			if (!rect) continue;
			if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) continue;
			return {
				pageIndex,
				page,
				point: {
					x: clamp((clientX - rect.left) / zoom, 0, Number(page.width || 0)),
					y: clamp((clientY - rect.top) / zoom, 0, Number(page.height || 0)),
				},
			};
		}
		return null;
	}, [currentPages, zoom]);

	const startElementDrag = (e, el) => {
		if (!currentDoc || el.locked) return;
		if (e.button === 2) {
			e.preventDefault();
			e.stopPropagation();
			return;
		}
		e.preventDefault();
		e.stopPropagation();
		const { clientX, clientY } = getEventClientPoint(e);
		const add = e.shiftKey || e.ctrlKey || e.metaKey;
		if (add) {
			selectElement(el, true);
			return;
		}
		const groupSize = el.groupId ? (currentPage?.elements || []).filter((item) => item.groupId === el.groupId).length : 1;
		if (!selectedIds.includes(el.id) || selectedIds.length !== groupSize) {
			selectElement(el, false);
		}
		const activeIds = el.groupId
			? (currentPage?.elements || []).filter((item) => item.groupId === el.groupId).map((item) => item.id)
			: (selectedIds.includes(el.id) ? selectedIds : [el.id]);
		const ids = activeIds.filter((id) => {
			const item = (currentPage?.elements || []).find((x) => x.id === id);
			return item && !item.locked;
		});
		if (!ids.length) return;
		const point = getPageTargetAtClientPoint(clientX, clientY)?.point || getCanvasPoint(clientX, clientY);
		const origins = Object.fromEntries(ids.map((id) => {
			const item = (currentPage?.elements || []).find((x) => x.id === id);
			const frame = getMediaFrame(item || {});
			if (frame) {
				return [id, { x: frame.frameX, y: frame.frameY, mediaX: frame.mediaX, mediaY: frame.mediaY }];
			}
			return [id, { x: Number(item?.x || 0), y: Number(item?.y || 0) }];
		}));
		const visibleOrigins = Object.fromEntries(ids.map((id) => {
			const item = (currentPage?.elements || []).find((x) => x.id === id);
			const bounds = getElementBounds(item || {});
			return [id, { x: Number(bounds.x || 0), y: Number(bounds.y || 0) }];
		}));
		const anchorVisibleOrigin = visibleOrigins[el.id] || getElementBounds(el);
		const grabOffset = {
			x: point.x - Number(anchorVisibleOrigin.x || 0),
			y: point.y - Number(anchorVisibleOrigin.y || 0),
		};
		snapshot();
		setDragState({ ids, origins, visibleOrigins, anchorId: el.id, grabOffset, sourcePageIndex: activePageIndex });
	};

	const startResize = (e, handle = "se") => {
		if (!selected || selected.locked) return;
		e.preventDefault();
		e.stopPropagation();
		const { clientX, clientY } = getEventClientPoint(e);
		const frame = getMediaFrame(selected);
		const isCropHandle = isCropCapableElement(selected) && handle.length === 1;
		setResizeState({
			startX: clientX,
			startY: clientY,
			x: Number(selected.x || 0),
			y: Number(selected.y || 0),
			width: Number(selected.width || 1),
			height: Number(selected.height || 1),
			cropLeft: Number(selected.cropLeft || 0),
			cropRight: Number(selected.cropRight || 0),
			cropTop: Number(selected.cropTop || 0),
			cropBottom: Number(selected.cropBottom || 0),
			mediaX: Number(frame?.mediaX ?? selected.mediaX ?? selected.x ?? 0),
			mediaY: Number(frame?.mediaY ?? selected.mediaY ?? selected.y ?? 0),
			mediaWidth: Number(frame?.mediaWidth ?? selected.mediaWidth ?? selected.width ?? 1),
			mediaHeight: Number(frame?.mediaHeight ?? selected.mediaHeight ?? selected.height ?? 1),
			id: selected.id,
			handle,
			mode: isCropHandle ? "crop" : "resize",
		});
	};

	const getCanvasPoint = React.useCallback((clientX, clientY) => {
		const rect = workspaceRef.current?.getBoundingClientRect();
		if (!rect) return { x: 0, y: 0 };
		return {
			x: (clientX - rect.left - pan.x - RULER_SIZE) / zoom,
			y: (clientY - rect.top - pan.y - RULER_SIZE) / zoom,
		};
	}, [pan, zoom]);

	const getMarqueePoint = React.useCallback((clientX, clientY) => {
		const rect = canvasShellRef.current?.getBoundingClientRect();
		if (!rect || !currentPage) return getCanvasPoint(clientX, clientY);
		return {
			x: clamp((clientX - rect.left) / zoom, 0, Number(currentPage.width || 0)),
			y: clamp((clientY - rect.top) / zoom, 0, Number(currentPage.height || 0)),
		};
	}, [currentPage, zoom, getCanvasPoint]);

	const startWorkspaceAction = (e) => {
		if (!currentDoc) return;
		setLeftPanel(null);
		setFileMenuOpen(false);
		setTextEditId(null);
		setExportMenuOpen(false);
		setContextMenu(null);
		if (e.button === 2) {
			return;
		}
		if (e.touches?.length >= 2 && workspaceRef.current) {
			e.preventDefault();
			const rect = workspaceRef.current.getBoundingClientRect();
			const t1 = e.touches[0];
			const t2 = e.touches[1];
			const centerX = (t1.clientX + t2.clientX) / 2;
			const centerY = (t1.clientY + t2.clientY) / 2;
			pinchStateRef.current = {
				startDistance: getTouchDistance(e.touches),
				startZoom: zoom,
				centerX,
				centerY,
				worldX: (centerX - rect.left - pan.x - RULER_SIZE) / zoom,
				worldY: (centerY - rect.top - pan.y - RULER_SIZE) / zoom,
			};
			setMarquee(null);
			setPanState(null);
			return;
		}
		const { clientX, clientY } = getEventClientPoint(e);
		if (spacePan || tool === "hand" || e.button === 1) {
			setPanState({ startX: clientX, startY: clientY, panX: pan.x, panY: pan.y });
			return;
		}
		setSelectedIds([]);
		setSelectedGuideId(null);
		setTextEditId(null);
		if (tool === "select" && !isMobileViewport) {
			const point = getMarqueePoint(clientX, clientY);
			setMarquee({ left: point.x, top: point.y, width: 0, height: 0, startX: point.x, startY: point.y });
		}
	};

	React.useEffect(() => {
		const onMove = (e) => {
			if (e.type === "touchmove") e.preventDefault();
			if (e.touches?.length >= 2 && pinchStateRef.current && workspaceRef.current) {
				const rect = workspaceRef.current.getBoundingClientRect();
				const t1 = e.touches[0];
				const t2 = e.touches[1];
				const centerX = (t1.clientX + t2.clientX) / 2;
				const centerY = (t1.clientY + t2.clientY) / 2;
				const distance = getTouchDistance(e.touches);
				const ratio = pinchStateRef.current.startDistance > 0 ? distance / pinchStateRef.current.startDistance : 1;
				const nextZoom = clamp(pinchStateRef.current.startZoom * ratio, 0.1, 3);
				setZoom(nextZoom);
				setPan({
					x: centerX - rect.left - pinchStateRef.current.worldX * nextZoom - RULER_SIZE,
					y: centerY - rect.top - pinchStateRef.current.worldY * nextZoom - RULER_SIZE,
				});
				return;
			}
			const { clientX, clientY } = getEventClientPoint(e);
			if (panState) {
				setPan({ x: panState.panX + (clientX - panState.startX), y: panState.panY + (clientY - panState.startY) });
			}
			if (dragState && currentDoc) {
				const target = getPageTargetAtClientPoint(clientX, clientY);
				if (target?.pageIndex === dragState.sourcePageIndex) {
					const point = target.point;
					const anchorVisibleOrigin = dragState.visibleOrigins?.[dragState.anchorId] || { x: 0, y: 0 };
					const dx = point.x - Number(dragState.grabOffset?.x || 0) - Number(anchorVisibleOrigin.x || 0);
					const dy = point.y - Number(dragState.grabOffset?.y || 0) - Number(anchorVisibleOrigin.y || 0);
					updateElements(dragState.ids, (el) => {
						const origin = dragState.origins[el.id];
						if (!origin) return {};
						if (isCropCapableElement(el) && origin.mediaX !== undefined) {
							return {
								mediaX: origin.mediaX + dx,
								mediaY: origin.mediaY + dy,
								x: origin.x + dx,
								y: origin.y + dy,
							};
						}
						return { x: Math.max(0, origin.x + dx), y: Math.max(0, origin.y + dy) };
					});
				}
			}
			if (resizeState && currentPage) {
				const el = (currentPage?.elements || []).find((item) => item.id === resizeState.id);
				if (!el) return;
				const dx = (clientX - resizeState.startX) / zoom;
				const dy = (clientY - resizeState.startY) / zoom;
				const handle = resizeState.handle || "se";
				if (resizeState.mode === "crop" && isCropCapableElement(el)) {
					const patch = applyCropDrag(resizeState, handle, dx, dy);
					updateElement(resizeState.id, patch);
				} else {
					let nextX = resizeState.x;
					let nextY = resizeState.y;
					let nextWidth = resizeState.width;
					let nextHeight = resizeState.height;
					if (handle.includes("e")) nextWidth = resizeState.width + dx;
					if (handle.includes("s")) nextHeight = resizeState.height + dy;
					if (handle.includes("w")) {
						nextX = resizeState.x + dx;
						nextWidth = resizeState.width - dx;
					}
					if (handle.includes("n")) {
						nextY = resizeState.y + dy;
						nextHeight = resizeState.height - dy;
					}
					const minW = 24;
					const minH = 24;
					if (nextWidth < minW) {
						if (handle.includes("w")) nextX -= (minW - nextWidth);
						nextWidth = minW;
					}
					if (nextHeight < minH) {
						if (handle.includes("n")) nextY -= (minH - nextHeight);
						nextHeight = minH;
					}
					nextX = clamp(nextX, 0, currentPage.width - minW);
					nextY = clamp(nextY, 0, currentPage.height - minH);
					nextWidth = clamp(nextWidth, minW, currentPage.width - nextX);
					nextHeight = clamp(nextHeight, minH, currentPage.height - nextY);
					if (isCropCapableElement(el)) {
						const baseWidth = Math.max(1, Number(resizeState.width || 1));
						const baseHeight = Math.max(1, Number(resizeState.height || 1));
						const scaleX = nextWidth / baseWidth;
						const scaleY = nextHeight / baseHeight;
						const cropOffsetX = Number(resizeState.x || 0) - Number(resizeState.mediaX || 0);
						const cropOffsetY = Number(resizeState.y || 0) - Number(resizeState.mediaY || 0);
						updateElement(resizeState.id, {
							x: nextX,
							y: nextY,
							width: nextWidth,
							height: nextHeight,
							mediaX: nextX - cropOffsetX * scaleX,
							mediaY: nextY - cropOffsetY * scaleY,
							mediaWidth: Math.max(minW, Number(resizeState.mediaWidth || resizeState.width || 1) * scaleX),
							mediaHeight: Math.max(minH, Number(resizeState.mediaHeight || resizeState.height || 1) * scaleY),
							cropLeft: Math.max(0, Number(resizeState.cropLeft || 0) * scaleX),
							cropRight: Math.max(0, Number(resizeState.cropRight || 0) * scaleX),
							cropTop: Math.max(0, Number(resizeState.cropTop || 0) * scaleY),
							cropBottom: Math.max(0, Number(resizeState.cropBottom || 0) * scaleY),
						});
					} else {
						updateElement(resizeState.id, { x: nextX, y: nextY, width: nextWidth, height: nextHeight });
					}
				}
			}
			if (marquee) {
				const point = getMarqueePoint(clientX, clientY);
				const next = {
					...marquee,
					left: Math.min(marquee.startX, point.x),
					top: Math.min(marquee.startY, point.y),
					width: Math.abs(point.x - marquee.startX),
					height: Math.abs(point.y - marquee.startY),
				};
				setMarquee(next);
			}
			if (guideDrag && currentPage) {
				const target = getPageTargetAtClientPoint(clientX, clientY);
				if (target?.pageIndex === activePageIndex) {
					const point = target.point;
					const position = guideDrag.orientation === "vertical" ? clamp(point.x, 0, currentPage.width) : clamp(point.y, 0, currentPage.height);
					updatePage({ guides: (currentPage.guides || []).map((guide) => guide.id === guideDrag.id ? { ...guide, position } : guide) });
				}
			}
		};
		const onUp = (e) => {
			pinchStateRef.current = null;
			if (dragState && currentDoc) {
				const { clientX, clientY } = getEventClientPoint(e);
				const target = Number.isFinite(clientX) && Number.isFinite(clientY) ? getPageTargetAtClientPoint(clientX, clientY) : null;
				const sourcePageIndex = Number(dragState.sourcePageIndex ?? activePageIndex);
				if (!target || target.pageIndex !== sourcePageIndex) {
					const anchorVisibleOrigin = dragState.visibleOrigins?.[dragState.anchorId] || { x: 0, y: 0 };
					const dx = target ? target.point.x - Number(dragState.grabOffset?.x || 0) - Number(anchorVisibleOrigin.x || 0) : 0;
					const dy = target ? target.point.y - Number(dragState.grabOffset?.y || 0) - Number(anchorVisibleOrigin.y || 0) : 0;
					const originById = dragState.origins || {};
					commitDocs((prev) => prev.map((doc) => {
						if (doc.id !== currentDoc.id) return doc;
						const restored = updateStudioPage(doc, sourcePageIndex, (page) => ({
							...page,
							elements: (page.elements || []).map((element) => {
								if (!dragState.ids.includes(element.id)) return element;
								const origin = originById[element.id];
								if (!origin) return element;
								return { ...element, x: origin.x, y: origin.y, ...(origin.mediaX !== undefined ? { mediaX: origin.mediaX } : {}), ...(origin.mediaY !== undefined ? { mediaY: origin.mediaY } : {}) };
							}),
						}));
						if (!target) return restored;
						return moveStudioElementsBetweenPages(restored, sourcePageIndex, target.pageIndex, dragState.ids, { deltaX: dx, deltaY: dy }).document;
					}));
					if (target) {
						setActivePageIndex(target.pageIndex);
						setSelectedIds(dragState.ids);
					}
				}
			}
			if (marquee && currentDoc) {
				const rect = { left: marquee.left, top: marquee.top, width: marquee.width, height: marquee.height };
				const ids = sanitizeStudioElements(currentPage?.elements || []).filter((el) => intersectsRect(el, rect)).map((el) => el.id);
				setSelectedIds(ids);
				suppressCanvasClickRef.current = true;
			}
			setDragState(null);
			setResizeState(null);
			setMarquee(null);
			setPanState(null);
			setGuideDrag(null);
		};
		window.addEventListener("mousemove", onMove);
		window.addEventListener("mouseup", onUp);
		window.addEventListener("touchmove", onMove, { passive: false });
		window.addEventListener("touchend", onUp);
		window.addEventListener("touchcancel", onUp);
		return () => {
			window.removeEventListener("mousemove", onMove);
			window.removeEventListener("mouseup", onUp);
			window.removeEventListener("touchmove", onMove);
			window.removeEventListener("touchend", onUp);
			window.removeEventListener("touchcancel", onUp);
		};
	}, [panState, dragState, resizeState, marquee, guideDrag, currentDoc, currentPage, activePageIndex, zoom, getCanvasPoint, getMarqueePoint, getPageTargetAtClientPoint, updateElements, updateElement, updatePage, commitDocs]);

	const handleWheel = React.useCallback((e) => {
		if (!(e.ctrlKey || e.metaKey)) return;
		e.preventDefault();
		e.stopPropagation();
		if (!currentDoc || !workspaceRef.current) return;
		const rect = workspaceRef.current.getBoundingClientRect();
		const pointX = e.clientX - rect.left;
		const pointY = e.clientY - rect.top;
		const nextZoom = clamp(zoom * (e.deltaY < 0 ? 1.08 : 0.92), 0.1, 3);
		const worldX = (pointX - pan.x - RULER_SIZE) / zoom;
		const worldY = (pointY - pan.y - RULER_SIZE) / zoom;
		setZoom(nextZoom);
		setPan({
			x: pointX - worldX * nextZoom - RULER_SIZE,
			y: pointY - worldY * nextZoom - RULER_SIZE,
		});
	}, [currentDoc, pan.x, pan.y, zoom]);

	const onWorkspaceDrop = (e) => {
		e.preventDefault();
		e.stopPropagation();
		const target = getPageTargetAtClientPoint(e.clientX, e.clientY);
		if (!target) { dragPayloadRef.current = null; return; }
		const point = target.point;
		const targetPageIndex = target.pageIndex;
		setActivePageIndex(targetPageIndex);
		setSelectedIds([]);
		const payloads = [
			dragPayloadRef.current ? JSON.stringify(dragPayloadRef.current) : "",
			e.dataTransfer?.getData("application/x-bondfire-svg") || "",
			e.dataTransfer?.getData("application/x-bondfire-image") || "",
			e.dataTransfer?.getData("text/plain") || "",
		];
		for (const raw of payloads) {
			if (!raw) continue;
			try {
				const data = JSON.parse(raw);
				if ((data?.kind === "svg" || data?.svg) && data?.svg) {
					placeSvgAtPoint(data, point, targetPageIndex);
					dragPayloadRef.current = null;
					return;
				}
				if ((data?.kind === "image" || data?.src) && data?.src) {
					placeImageAtPoint(String(data.src), String(data.name || "Image"), point, targetPageIndex);
					dragPayloadRef.current = null;
					return;
				}
			} catch {}
		}
		const file = e.dataTransfer?.files?.[0];
		if (file && String(file.type || "").startsWith("image/")) {
			const reader = new FileReader();
			reader.onload = () => {
				placeImageAtPoint(String(reader.result || ""), file.name || "Image", point, targetPageIndex);
			};
			reader.readAsDataURL(file);
		}
		dragPayloadRef.current = null;
	};

	const onWorkspaceDragOver = (e) => {
		e.preventDefault();
		e.stopPropagation();
		if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
	};
	const onWorkspaceDragEnter = (e) => {
		e.preventDefault();
		e.stopPropagation();
		if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
	};
	const clearDragPayload = () => {
		dragPayloadRef.current = null;
	};

	React.useEffect(() => {
		const node = workspaceRef.current;
		if (!node) return;
		const onNativeWheel = (e) => {
			if (!(e.ctrlKey || e.metaKey)) return;
			handleWheel(e);
		};
		node.addEventListener("wheel", onNativeWheel, { passive: false });
		return () => node.removeEventListener("wheel", onNativeWheel);
	}, [handleWheel]);

	React.useEffect(() => {
		const workspace = workspaceRef.current;
		const shell = canvasShellRef.current;
		const onNativeDragOver = (e) => {
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
		};
		const onNativeDrop = (e) => onWorkspaceDrop(e);
		workspace?.addEventListener("dragover", onNativeDragOver);
		workspace?.addEventListener("drop", onNativeDrop);
		shell?.addEventListener("dragover", onNativeDragOver);
		shell?.addEventListener("drop", onNativeDrop);
		return () => {
			workspace?.removeEventListener("dragover", onNativeDragOver);
			workspace?.removeEventListener("drop", onNativeDrop);
			shell?.removeEventListener("dragover", onNativeDragOver);
			shell?.removeEventListener("drop", onNativeDrop);
		};
	}, [onWorkspaceDrop, currentId, activePageIndex]);


	const openContextMenu = (e, el) => {
		e.preventDefault();
		e.stopPropagation();
		if (el) {
			const alreadySelected = selectedIds.includes(el.id) || (el.groupId && (currentPage?.elements || []).some((item) => item.groupId === el.groupId && selectedIds.includes(item.id)));
			if (!alreadySelected) {
				selectElement(el, false);
			}
		}
		const targetIds = el
			? (el.groupId ? (currentPage?.elements || []).filter((item) => item.groupId === el.groupId).map((item) => item.id) : [el.id])
			: [];
		setContextMenu({
			x: e.clientX,
			y: e.clientY,
			elementId: el?.id || null,
			groupId: el?.groupId || null,
			targetIds,
		});
	};

	const closeMenus = () => {
		setLeftPanel(null);
		setFileMenuOpen(false);
		setTextEditId(null);
		setExportMenuOpen(false);
		setContextMenu(null);
		setDocSettingsOpen(false);
	};

	const exportJson = () => {
		if (!currentDoc) return;
		downloadBlob(`${printableName(currentDoc.name)}.json`, new Blob([JSON.stringify(normalizeDoc(currentDoc), null, 2)], { type: "application/json" }));
	};

	const exportPng = async () => {
		if (!currentDoc || !currentPage) return;
		const pageDoc = normalizeDoc({ ...currentDoc, pages: [clone(currentPage)], width: currentPage.width, height: currentPage.height, background: currentPage.background, elements: currentPage.elements || [], guides: currentPage.guides || [] });
		const canvas = await renderDocToCanvas(pageDoc, bindings);
		canvas.toBlob((png) => {
			if (png) downloadBlob(`${printableName(currentDoc.name)}-page-${activePageIndex + 1}.png`, png);
		}, "image/png");
	};

	const exportPdf = async () => {
		if (!currentDoc || !currentPages.length) return;
		const pageDataUrls = [];
		for (const page of currentPages) {
			const pageDoc = normalizeDoc({ ...currentDoc, pages: [clone(page)], width: page.width, height: page.height, background: page.background, elements: page.elements || [], guides: page.guides || [] });
			const canvas = await renderDocToCanvas(pageDoc, bindings);
			pageDataUrls.push({ url: canvas.toDataURL("image/png"), width: page.width, height: page.height });
		}
		const dataUrl = pageDataUrls[0]?.url || "";
		const frame = document.createElement("iframe");
		frame.style.position = "fixed";
		frame.style.right = "0";
		frame.style.bottom = "0";
		frame.style.width = "0";
		frame.style.height = "0";
		frame.style.border = "0";
		document.body.appendChild(frame);
		const doc = frame.contentWindow?.document;
		if (!doc) return;
		doc.open();
		doc.write(`<!doctype html><html><head><title>${currentDoc.name || "Design"}</title><style>html,body{margin:0;padding:0;background:#fff;} .page-break{break-after:page;page-break-after:always;} img{display:block;width:100%;height:auto;} @page{size:auto;margin:0;}</style></head><body>${pageDataUrls.map((item, index) => `<div class="${index < pageDataUrls.length - 1 ? "page-break" : ""}"><img src="${item.url}" alt="" /></div>`).join("")}</body></html>`);
		doc.close();
		setTimeout(() => {
			frame.contentWindow?.focus();
			frame.contentWindow?.print();
			setTimeout(() => frame.remove(), 1500);
		}, 150);
	};

	React.useEffect(() => {
		const onGlobalDown = () => setContextMenu(null);
		const onEsc = (e) => {
			if (e.key === "Escape") {
				setTextEditId(null);
				setContextMenu(null);
				setLeftPanel(null);
				setFileMenuOpen(false);
				setDocSettingsOpen(false);
						setExportMenuOpen(false);
			}
		};
		window.addEventListener("click", onGlobalDown);
		window.addEventListener("keydown", onEsc);
		return () => {
			window.removeEventListener("click", onGlobalDown);
			window.removeEventListener("keydown", onEsc);
		};
	}, []);

	const filteredAssets = React.useMemo(() => {
		const q = assetSearch.trim().toLowerCase();
		if (!q) return driveAssets;
		return driveAssets.filter((file) => String(file?.name || "").toLowerCase().includes(q));
	}, [driveAssets, assetSearch]);
	const filteredBuiltInAssets = React.useMemo(() => {
		const q = assetSearch.trim().toLowerCase();
		if (!q) return STUDIO_ASSETS;
		return STUDIO_ASSETS.filter((asset) => String(asset?.label || "").toLowerCase().includes(q) || String(asset?.category || "").toLowerCase().includes(q));
	}, [assetSearch]);

	const multiSelection = selectedIds.length > 1;
	const currentGuides = currentPage?.guides || [];
	const rulerStep = React.useMemo(() => {
		const steps = [5, 10, 25, 50, 100, 200, 500, 1000];
		return steps.find((step) => step * zoom >= 45) || 1000;
	}, [zoom]);
	const pageGap = 32;
	const pageLayouts = React.useMemo(() => {
		let offsetTop = RULER_SIZE + 36;
		return currentPages.map((page) => {
			const layout = {
				left: pan.x + RULER_SIZE,
				top: offsetTop,
				width: Number(page.width || currentDoc?.width || 1080) * zoom,
				height: Number(page.height || currentDoc?.height || 1350) * zoom,
			};
			offsetTop += layout.height + pageGap;
			return layout;
		});
	}, [currentPages, pan.x, pan.y, zoom, currentDoc]);
	const pageStackHeight = React.useMemo(() => {
		if (!pageLayouts.length) return 900;
		const last = pageLayouts[pageLayouts.length - 1];
		return Math.max(980, last.top + last.height + 170);
	}, [pageLayouts]);
React.useEffect(() => {
	let helpId = "studio";
	if (isMobileViewport) helpId = "studio-mobile";
	if (leftPanel) helpId = "studio-assets";
	if (selected?.type === "text") helpId = "studio-text";
	if (selected?.type === "image" || selected?.type === "svg" || selected?.type === "shape") helpId = "studio-images";
	try {
		window.dispatchEvent(new CustomEvent("bf-help-topic", { detail: { id: helpId } }));
	} catch {}
}, [isMobileViewport, leftPanel, selected?.type]);

	const applyQueuedRemoteChanges = React.useCallback(() => {
		const pending = studioPendingRemoteRef.current;
		if (!pending) return;
		if(pending.revision!==undefined&&JSON.stringify({docs:normalizeDocs(docs),blocks:savedBlocks})!==studioPrivateBaselineRef.current&&!window.confirm('Replace this device’s unsaved Studio edits with the shared version? Export your local documents first if you need to keep both.'))return;
		studioRemoteSigRef.current = pending.sig;
		if(pending.revision!==undefined){studioPrivateRevisionRef.current=pending.revision;studioPrivateBaselineRef.current=JSON.stringify(pending.remoteState);}
		setDocs(pending.remoteState.docs);
		setSavedBlocks(pending.remoteState.blocks);
		saveDocs(orgId, pending.remoteState.docs);
		saveBlocks(orgId, pending.remoteState.blocks);
		setCurrentId((prev) => pending.remoteState.docs.some((doc) => doc.id === prev) ? prev : (pending.remoteState.docs[0]?.id || null));
		studioPendingRemoteRef.current = null;
		studioLastRemoteApplyRef.current = Date.now();
		studioSyncedLocalRevisionRef.current = studioLocalRevisionRef.current;
		saveStudioSyncMeta(orgId, { localRevision: studioLocalRevisionRef.current, syncedLocalRevision: studioSyncedLocalRevisionRef.current });
		studioHasAppliedRemoteRef.current = true;
		studioNeedsRemoteHydrationRef.current = false;
		setStudioRemoteNotice(null);
		setStudioSyncMsg("Remote Studio changes applied.");
	}, [orgId, docs, savedBlocks]);

	const dismissQueuedRemoteChanges = React.useCallback(() => {
		if (!studioPendingRemoteRef.current) return;
		setStudioRemoteNotice(null);
	}, []);

	const retryStudioRemoteHydration = React.useCallback(async () => {
		try {
			setStudioKeyNotice(null);
			await studioFetchRef.current({ queueIfBusy: false, forceApply: true, reason: "rehydrate" });
		} catch (err) {
			setStudioSyncMsg(String(err?.message || err || "Studio rehydrate failed."));
		}
	}, [orgId, studioSyncMsg, docs.length, savedBlocks.length, textEditId, dragState, resizeState, marquee, panState, guideDrag]);

	React.useEffect(() => {
		if (!studioRemoteNotice) return;
		if(studioPrivateRevisionRef.current!==null&&studioPendingRemoteRef.current)return;
		if (!studioPendingRemoteRef.current) {
			setStudioRemoteNotice(null);
			return;
		}
		const hasActiveInteraction = !!(dragState || resizeState || marquee || panState || guideDrag || textEditId);
		const hasUnsyncedLocalEdits = studioLastLocalEditRef.current > studioLastSharedSaveRef.current;
		const debounceWindowMs = 900;
		const localEditAgeMs = Date.now() - Number(studioLastLocalEditRef.current || 0);
		const shouldKeepBanner = hasUnsyncedLocalEdits && !hasActiveInteraction && localEditAgeMs > debounceWindowMs;
		if (!shouldKeepBanner) {
			setStudioRemoteNotice(null);
		}
	}, [studioRemoteNotice, dragState, resizeState, marquee, panState, guideDrag, textEditId, docs.length, savedBlocks.length]);

	const activePageLayout = React.useMemo(() => {
		if (!pageLayouts.length) return null;
		return pageLayouts[Math.max(0, Math.min(activePageIndex, pageLayouts.length - 1))] || pageLayouts[0] || null;
	}, [pageLayouts, activePageIndex]);

	function commitToActivePage(doc, pageUpdater) {
		return normalizeDoc(updateStudioPage(doc, activePageIndex, pageUpdater));
	}


	return (

		<div className="bfStudioRoot" style={{ padding: 8, display: "grid", gap: 8 }}>
			<style>{`
				.bfStudioRoot button:focus-visible, .bfStudioRoot input:focus-visible, .bfStudioRoot textarea:focus-visible, .bfStudioRoot select:focus-visible, .bfStudioRoot [role="button"]:focus-visible { outline: 2px solid #f87171; outline-offset: 2px; }
				.bfStudioOpacitySlider {
					-webkit-appearance: none;
					appearance: none;
					background: transparent;
					height: 18px;
				}
				.bfStudioOpacitySlider::-webkit-slider-runnable-track {
					height: 8px;
					border-radius: 999px;
					background: rgba(59,130,246,0.9);
				}
				.bfStudioOpacitySlider::-webkit-slider-thumb {
					-webkit-appearance: none;
					appearance: none;
					width: 18px;
					height: 18px;
					border-radius: 999px;
					background: white;
					border: 2px solid rgba(17,24,39,0.95);
					margin-top: -5px;
					box-shadow: 0 1px 4px rgba(0,0,0,0.3);
				}
				.bfStudioOpacitySlider::-moz-range-track {
					height: 8px;
					border-radius: 999px;
					background: rgba(59,130,246,0.9);
				}
				.bfStudioOpacitySlider::-moz-range-thumb {
					width: 18px;
					height: 18px;
					border-radius: 999px;
					background: white;
					border: 2px solid rgba(17,24,39,0.95);
					box-shadow: 0 1px 4px rgba(0,0,0,0.3);
				}
			`}</style>
			<input ref={fileInputRef} type="file" accept="image/*" onChange={onUploadImage} style={{ display: "none" }} />
			<input ref={fontUploadRef} type="file" accept=".woff2,.woff,.ttf,.otf,font/woff2,font/woff,font/ttf,font/otf,application/font-woff,application/x-font-ttf,application/x-font-otf" onChange={onUploadFont} style={{ display: "none" }} />

			<div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: "space-between", flexWrap: "nowrap" }}>
				<div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: "1 1 420px", position: "relative" }}>
					<img src="/logos/studio.svg" alt="" aria-hidden="true" style={{ width: 34, height: 34, borderRadius: 9, flex: "0 0 auto" }} />
					<button aria-label="Studio file menu" style={{ padding: "6px 8px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(17,24,39,0.96)", color: "white" }} onClick={(e) => { e.stopPropagation(); setFileMenuOpen((v) => !v); setExportMenuOpen(false); setLeftPanel(null); }}>☰</button>
					<button type="button" onClick={() => { setLeftPanel("new"); setFileMenuOpen(false); setExportMenuOpen(false); }} style={{ padding: "7px 12px", borderRadius: 10, border: "1px solid rgba(239,68,68,0.65)", background: "#ef4444", color: "white", fontWeight: 800, whiteSpace: "nowrap" }}>New design</button>
					<button type="button" onClick={addPage} disabled={!currentDoc} style={{ padding: "7px 10px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(17,24,39,0.96)", color: "white", whiteSpace: "nowrap" }}>Add page</button>
					{docSettingsOpen && currentDoc ? (
						<div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", top: 40, right: 360, width: 220, zIndex: 40, background: "rgba(17,24,39,0.98)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 14, padding: 10, boxShadow: "0 18px 60px rgba(0,0,0,0.35)" }}>
							<div style={{ fontWeight: 700, marginBottom: 8 }}>Page background</div>
							<input type="color" value={currentPage?.background || "#ffffff"} onChange={(e) => updatePage({ background: e.target.value })} style={{ width: "100%", height: 36, marginBottom: 10 }} />
							<div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
								{["#ffffff", brandKit.primary, brandKit.secondary, brandKit.accent].map((color) => (
									<button key={color} onClick={() => updatePage({ background: color })} style={{ height: 30, borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)", background: color }} />
								))}
							</div>
						</div>
					) : null}
					{fileMenuOpen ? (
						<div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", top: 36, left: 0, width: 200, zIndex: 40, background: "rgba(17,24,39,0.98)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 14, padding: 8, boxShadow: "0 18px 60px rgba(0,0,0,0.35)" }}>
							<div style={{ display: "grid", gap: 6 }}>
								<button style={panelButtonStyle(false)} onClick={() => createDoc("flyer")}>New Flyer</button>
								<button style={panelButtonStyle(false)} onClick={() => createDoc("square")}>New Square Post</button>
								<button style={panelButtonStyle(false)} onClick={() => createDoc("story")}>New Story</button>
								<button style={panelButtonStyle(false)} onClick={() => createDoc("banner")}>New Banner</button>
								<button style={panelButtonStyle(false)} onClick={duplicateDoc} disabled={!currentDoc}>Duplicate Document</button>
								<button style={panelButtonStyle(false)} onClick={saveCurrentDoc} disabled={!currentDoc}>Save</button>
								<button style={panelButtonStyle(false)} onClick={exportJson} disabled={!currentDoc}>Export JSON</button>
								<button style={panelButtonStyle(false)} onClick={exportPng} disabled={!currentDoc}>Export PNG</button>
								<button style={panelButtonStyle(false)} onClick={exportPdf} disabled={!currentDoc}>Export PDF</button>
								<button style={panelButtonStyle(false)} onClick={() => currentDoc && deleteDoc(currentDoc.id)} disabled={!currentDoc}>Delete Current Doc</button>
							</div>
						</div>
					) : null}
					<input aria-label="Document name" title="Rename this design" value={currentDoc?.name || ""} onChange={(e) => updateDocument({ name: e.target.value })} placeholder="Untitled design" disabled={!currentDoc} style={{ minWidth: 0, flex: 1, padding: "7px 10px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.12)", background: "#111827", color: "white" }} />
				</div>
				<div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end", position: "relative" }}>
					<div style={{ display: "grid", lineHeight: 1.05, textAlign: "right", marginRight: 6 }}>
						<div style={{ fontSize: 11, fontWeight: 700 }}>{currentPage ? `${currentPage.width} × ${currentPage.height}` : currentDoc ? `${currentDoc.width} × ${currentDoc.height}` : "No canvas"}</div>
						<div style={{ fontSize: 10, opacity: 0.7 }}>{currentDoc ? `page ${activePageIndex + 1} of ${currentPages.length}` : ""}</div>
						<div style={{ fontSize: 10, opacity: 0.7 }}>{savedAt ? `Saved ${formatSavedAt(savedAt)}` : "Unsaved"}</div>
					</div>
					<button style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(17,24,39,0.92)", color: "white" }} onClick={undo} disabled={!history.length}>↶</button>
					<button style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(17,24,39,0.92)", color: "white" }} onClick={redo} disabled={!future.length}>↷</button>
					<button style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(17,24,39,0.92)", color: "white" }} onClick={() => setZoom((z) => clamp(z * 0.9, 0.1, 3))} disabled={!currentDoc}>−</button>
					<button style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(17,24,39,0.92)", color: "white" }} onClick={() => fitCanvas(currentDoc)} disabled={!currentDoc}>Fit</button>
					<button style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(17,24,39,0.92)", color: "white" }} onClick={() => { setZoom(1); setPan({ x: 80, y: 80 }); }} disabled={!currentDoc}>100</button>
					<button style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(17,24,39,0.92)", color: "white" }} onClick={() => setZoom((z) => clamp(z * 1.1, 0.1, 3))} disabled={!currentDoc}>+</button>
					<div style={{ minWidth: 46, textAlign: "center", opacity: 0.8 }}>{Math.round(zoom * 100)}%</div>
					<button style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(17,24,39,0.92)", color: "white" }} onClick={(e) => { e.stopPropagation(); setExportMenuOpen((v) => !v); setFileMenuOpen(false); }}>⇩</button>
					{exportMenuOpen ? (
						<div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", top: 42, right: 0, width: 170, zIndex: 40, background: "rgba(17,24,39,0.98)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 14, padding: 8, boxShadow: "0 18px 60px rgba(0,0,0,0.35)" }}>
							<div style={{ display: "grid", gap: 6 }}>
								<button style={panelButtonStyle(false)} onClick={exportPng} disabled={!currentDoc}>Export PNG</button>
								<button style={panelButtonStyle(false)} onClick={exportPdf} disabled={!currentDoc}>Export PDF</button>
							</div>
						</div>
					) : null}
				</div>
			</div>

			{studioKeyNotice ? (
				<div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 12px", borderRadius: 14, background: "rgba(127,29,29,0.22)", border: "1px solid rgba(248,113,113,0.45)" }}>
					<div style={{ fontSize: 13, lineHeight: 1.4, flex: 1, minWidth: 220 }}>{studioKeyNotice.text}</div>
					<button onClick={retryStudioRemoteHydration} style={{ padding: "8px 10px", borderRadius: 10 }}>Retry now</button>
				</div>
			) : null}
			{studioSyncMsg ? <div role="alert" aria-label="Studio save status" style={{ padding: "9px 12px", borderRadius: 12, background: "rgba(127,29,29,0.22)", border: "1px solid rgba(248,113,113,0.35)", fontSize: 13 }}>{studioSyncMsg}</div> : null}
			{studioRemoteNotice ? (
				<div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "10px 12px", borderRadius: 14, background: "rgba(17,24,39,0.92)", border: "1px solid rgba(255,255,255,0.12)" }}>
					<div style={{ fontSize: 13, lineHeight: 1.35, flex: 1, minWidth: 220 }}>{studioRemoteNotice.text}</div>
					{studioPendingRemoteRef.current ? <button onClick={applyQueuedRemoteChanges} style={{ padding: "8px 10px", borderRadius: 10 }}>Apply remote</button> : null}
					{studioPendingRemoteRef.current ? <button onClick={dismissQueuedRemoteChanges} style={{ padding: "8px 10px", borderRadius: 10 }}>Keep mine for now</button> : null}
				</div>
			) : null}

			<div style={{ position: "relative", minHeight: "calc(100vh - 170px)", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 18, overflow: "hidden" }}>
				<div style={{ position: "absolute", top: showRulers ? 40 : 12, left: showRulers ? (RULER_SIZE + 8) : 12, zIndex: 25, display: "grid", gap: 8 }}>
					<button
						title="Add"
						style={iconButtonStyle(leftPanel === "create")}
						onClick={() => setLeftPanel((v) => v === "create" ? null : "create")}
					>
						<Plus size={18} strokeWidth={2.25} />
					</button>
					<button
						title="Templates"
						style={iconButtonStyle(leftPanel === "templates")}
						onClick={() => setLeftPanel((v) => v === "templates" ? null : "templates")}
					>
						<LayoutGrid size={18} strokeWidth={2.1} />
					</button>
					<button
						title="Assets"
						style={iconButtonStyle(leftPanel === "assets")}
						onClick={() => setLeftPanel((v) => v === "assets" ? null : "assets")}
					>
						<ImageIcon size={18} strokeWidth={2.1} />
					</button>
					<button
						title="Bondfire Data"
						style={iconButtonStyle(leftPanel === "data")}
						onClick={() => setLeftPanel((v) => v === "data" ? null : "data")}
					>
						<Database size={18} strokeWidth={2.1} />
					</button>
					<button
						title="Documents"
						style={iconButtonStyle(leftPanel === "docs")}
						onClick={() => setLeftPanel((v) => v === "docs" ? null : "docs")}
					>
						<FileText size={18} strokeWidth={2.1} />
					</button>
				</div>

				{leftPanel ? (
					<div style={{ position: "absolute", top: showRulers ? 40 : 12, left: showRulers ? (RULER_SIZE + 56) : 60, bottom: 12, width: 300, zIndex: 26, background: "rgba(17,24,39,0.98)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 16, padding: 14, overflow: "auto", boxShadow: "0 18px 60px rgba(0,0,0,0.35)" }}>
						<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, gap: 10 }}>
							<div style={{ fontWeight: 800 }}>{leftPanel === "new" ? "New design" : leftPanel === "create" ? "Add" : leftPanel === "templates" ? "Templates" : leftPanel === "assets" ? "Assets" : leftPanel === "data" ? "Bondfire Data" : "Documents"}</div>
							<button style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(17,24,39,0.92)", color: "white" }} onClick={() => setLeftPanel(null)}>✕</button>
						</div>

						{leftPanel === "new" ? (
							<div style={{ display: "grid", gap: 9 }}>
								<div style={{ fontSize: 12, opacity: 0.72 }}>Create a new document. Use Add page when you want another page inside the current design.</div>
								{Object.entries(PRESETS).map(([key, preset]) => <button key={key} style={panelButtonStyle(false)} onClick={() => createDoc(key)}><div style={{ fontWeight: 800 }}>{preset.label}</div><div style={{ opacity: 0.7, fontSize: 12 }}>{preset.width} × {preset.height}</div></button>)}
								<div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: 10, display: "grid", gap: 8 }}>
									<div style={{ fontWeight: 800 }}>Blank / custom size</div>
									<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
										<label>Width<input aria-label="Custom design width" type="number" min="64" max="8192" value={customSize.width} onChange={(e) => setCustomSize((value) => ({ ...value, width: Number(e.target.value || 1080) }))} style={{ width: "100%" }} /></label>
										<label>Height<input aria-label="Custom design height" type="number" min="64" max="8192" value={customSize.height} onChange={(e) => setCustomSize((value) => ({ ...value, height: Number(e.target.value || 1080) }))} style={{ width: "100%" }} /></label>
									</div>
									<button style={panelButtonStyle(false)} onClick={createCustomDoc}>Create custom design</button>
								</div>
							</div>
						) : null}

						{leftPanel === "create" ? (
							<div style={{ display: "grid", gap: 8 }}>
								<button style={panelButtonStyle(false)} onClick={addText}>Add Text</button>
								<button style={panelButtonStyle(false)} onClick={addShape}>Add Shape</button>
								<button style={panelButtonStyle(false)} onClick={addImage}>Upload Image</button>
								<button style={panelButtonStyle(false)} onClick={addQrCode}>Add QR Code</button>
								<button style={panelButtonStyle(false)} onClick={() => addGuide("vertical")}>Add Vertical Guide</button>
								<button style={panelButtonStyle(false)} onClick={() => addGuide("horizontal")}>Add Horizontal Guide</button>
								<hr style={{ opacity: 0.15, margin: "8px 0" }} />
								<div style={{ display: "flex", gap: 8 }}>
									<button style={{ ...panelButtonStyle(tool !== "hand"), textAlign: "center" }} onClick={() => setTool("select")}>Select</button>
									<button style={{ ...panelButtonStyle(tool === "hand"), textAlign: "center" }} onClick={() => setTool("hand")}>Hand</button>
								</div>
								<div style={{ fontSize: 12, opacity: 0.65 }}>{savedAt ? `Saved locally ${formatSavedAt(savedAt)}` : ""}</div>
								
							</div>
						) : null}


						{leftPanel === "templates" ? (
							<div style={{ display: "grid", gap: 8 }}>
								{Object.entries(TEMPLATE_LIBRARY).map(([key, item]) => (
									<button key={key} style={panelButtonStyle(false)} onClick={() => createTemplateDoc(key)}>
										<div style={{ fontWeight: 700 }}>{item.label}</div>
										<div style={{ opacity: 0.7, fontSize: 12 }}>{PRESETS[item.preset]?.label || item.preset}</div>
									</button>
								))}
							</div>
						) : null}

						{leftPanel === "assets" ? (
							<div style={{ display: "grid", gap: 8 }}>
								<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
									<div style={{ fontWeight: 800 }}>Assets</div>
									<button style={panelButtonStyle(false)} onClick={addImage}>Upload</button>
								</div>
								<div style={{ display: "flex", gap: 6 }}>
									<button style={{ ...panelButtonStyle(assetTab === "builtins"), textAlign: "center" }} onClick={() => setAssetTab("builtins")}>Built-in</button>
									<button style={{ ...panelButtonStyle(assetTab === "pixabay"), textAlign: "center" }} onClick={() => setAssetTab("pixabay")}>Pixabay</button>
									<button style={{ ...panelButtonStyle(assetTab === "drive"), textAlign: "center" }} onClick={() => setAssetTab("drive")}>Drive</button>
								</div>
								<input value={assetSearch} onChange={(e) => setAssetSearch(e.target.value)} placeholder={assetTab === "pixabay" ? "Search Pixabay images" : assetTab === "drive" ? "Search Drive images" : "Search built-in assets"} style={{ width: "100%" }} />
								{assetTab === "pixabay" ? <button style={panelButtonStyle(false)} onClick={loadPixabayAssets}>{pixabayLoading ? "Searching..." : "Search Pixabay"}</button> : null}
								{assetTab === "builtins" ? (
									<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
										{filteredBuiltInAssets.map((asset) => (
											<button key={asset.id} draggable onDragStart={(e) => { const payload = { ...asset, kind: "svg" }; dragPayloadRef.current = payload; e.dataTransfer.setData("application/x-bondfire-svg", JSON.stringify(payload)); e.dataTransfer.setData("text/plain", JSON.stringify(payload)); e.dataTransfer.effectAllowed = "copy"; setAssetDragImage(e); }} onDragEnd={clearDragPayload} onClick={() => addSvgAsset(asset)} style={{ padding: 8, borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)", textAlign: "left", cursor: "grab" }}>
												<div style={{ aspectRatio: "1 / 1", display: "grid", placeItems: "center", marginBottom: 8, borderRadius: 8, background: "rgba(255,255,255,0.05)", color: brandKit.primary }}>
													<img src={svgMarkupToDataUrl(asset.svg, brandKit.primary)} alt="" draggable={false} style={{ maxWidth: "80%", maxHeight: "80%" }} />
												</div>
												<div style={{ fontSize: 11, fontWeight: 700 }}>{asset.label}</div>
												<div style={{ fontSize: 10, opacity: 0.7 }}>{asset.category}</div>
											</button>
										))}
										{!filteredBuiltInAssets.length ? <div style={{ opacity: 0.7, gridColumn: "1 / -1" }}>No built-in assets match that search.</div> : null}
									</div>
								) : null}
								{assetTab === "pixabay" ? (
									<div style={{ display: "grid", gap: 8 }}>
										{pixabayError ? <div style={{ color: "#fca5a5", fontSize: 12 }}>{pixabayError}</div> : null}
										<div style={{ display: "grid", gap: 8 }}>
											{pixabayResults.map((file) => (
												<div
													key={file.id}
													draggable
													onDragStart={(e) => {
														const payload = { kind: "image", src: file.fullUrl || file.previewUrl, name: file.name };
														dragPayloadRef.current = payload;
														e.dataTransfer.setData("application/x-bondfire-image", JSON.stringify(payload));
														e.dataTransfer.setData("text/plain", JSON.stringify(payload));
														e.dataTransfer.effectAllowed = "copy";
													}} onDragEnd={clearDragPayload}
													style={{ padding: 8, borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)", cursor: "grab" }}
												>
													<div style={{ aspectRatio: "4 / 3", background: "rgba(255,255,255,0.05)", borderRadius: 8, overflow: "hidden", marginBottom: 8 }}>
														<img src={file.previewUrl} alt="" draggable={false} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
													</div>
													<div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>{file.name}</div>
													<div style={{ display: "flex", gap: 8, alignItems: "center" }}>
														<button onClick={() => addImageFromSrc(file.fullUrl || file.previewUrl, file.name)}>Place on Canvas</button>
														<div style={{ fontSize: 10, opacity: 0.72 }}>drag onto canvas</div>
													</div>
												</div>
											))}
											{!pixabayLoading && !pixabayResults.length ? <div style={{ opacity: 0.7 }}>Search Pixabay to place photos without uploading every image.</div> : null}
										</div>
									</div>
								) : null}
								{assetTab === "drive" ? (
									<div style={{ display: "grid", gap: 8 }}>
										<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
											<div style={{ fontWeight: 800 }}>Drive Assets</div>
											<button onClick={loadDriveAssets}>Refresh</button>
										</div>
										{driveLoading ? <div style={{ opacity: 0.7 }}>Loading Drive assets...</div> : null}
										{driveError ? <div style={{ color: "#fca5a5", fontSize: 12 }}>{driveError}</div> : null}
										<div style={{ display: "grid", gap: 8 }}>
											{filteredAssets.map((file) => (
												<div key={file.id} draggable onDragStart={(e) => { const payload = { kind: "image", src: file.previewUrl, name: file.name }; dragPayloadRef.current = payload; e.dataTransfer.setData("application/x-bondfire-image", JSON.stringify(payload)); e.dataTransfer.setData("text/plain", JSON.stringify(payload)); e.dataTransfer.effectAllowed = "copy"; setAssetDragImage(e); }} onDragEnd={clearDragPayload} style={{ padding: 8, borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)", cursor: "grab" }}>
													<div style={{ aspectRatio: "4 / 3", background: "rgba(255,255,255,0.05)", borderRadius: 8, overflow: "hidden", marginBottom: 8 }}>
														<img src={file.previewUrl} alt="" draggable={false} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
													</div>
													<div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6 }}>{file.name}</div>
													<button onClick={() => addImageFromSrc(file.previewUrl, file.name)}>Place on Canvas</button>
												</div>
											))}
											{!driveLoading && !filteredAssets.length ? <div style={{ opacity: 0.7 }}>No image assets found in Drive.</div> : null}
										</div>
									</div>
								) : null}
							</div>
						) : null}

						{leftPanel === "data" ? (
							<div style={{ display: "grid", gap: 8 }}>
								<div style={{ fontSize: 12, opacity: 0.8, marginBottom: 2 }}>These tokens are live placeholders. Example: {"{{meeting.title}}"} resolves to your current Bondfire meeting title when preview is on.</div>
								<div style={{ display: "flex", gap: 8, marginBottom: 6 }}><button onClick={() => setShowBoundPreview((v) => !v)}>{showBoundPreview ? "Show Raw Tokens" : "Show Live Preview"}</button></div>
								{Object.entries(bindings).map(([key, value]) => (
									<div key={key} style={{ background: "rgba(255,255,255,0.04)", borderRadius: 10, padding: 8 }}>
										<div style={{ fontSize: 12, color: "#fca5a5" }}>{`{{${key}}}`}</div>
										<div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>{String(value || "—")}</div>
										<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 6 }}>
											<button onClick={() => addBoundText(key, key)}>Add</button>
											<button onClick={() => insertBindingToken(key)} disabled={!selected || selected.type !== "text"}>Insert</button>
										</div>
									</div>
								))}
							</div>
						) : null}

						{leftPanel === "docs" ? (
							<div style={{ display: "grid", gap: 8, maxHeight: "100%", overflow: "auto" }}>
								<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
									<div style={{ fontWeight: 800 }}>Documents</div>
									<button onClick={saveCurrentDoc} disabled={!currentDoc}>Save</button>
								</div>
								{docs.length ? docs.map((doc) => (
									<div key={doc.id} style={{ border: doc.id === currentId ? "1px solid #ef4444" : "1px solid rgba(255,255,255,0.08)", background: doc.id === currentId ? "rgba(239,68,68,0.14)" : "rgba(255,255,255,0.04)", borderRadius: 12, padding: 10 }}>
										<button onClick={() => { setCurrentId(doc.id); setActivePageIndex(0); setSelectedIds([]); setTimeout(() => fitCanvas(doc), 0); }} style={{ width: "100%", textAlign: "left", background: "transparent", border: "none", padding: 0 }}>
											<div style={{ fontWeight: 700 }}>{doc.name}</div>
											<div style={{ opacity: 0.7, fontSize: 12 }}>{doc.width} × {doc.height}</div>
										</button>
										<div style={{ display: "flex", gap: 8, marginTop: 8 }}>
											<button onClick={() => { setCurrentId(doc.id); setActivePageIndex(0); setSelectedIds([]); setTimeout(() => fitCanvas(doc), 0); }}>Open</button>
											<button onClick={() => deleteDoc(doc.id)}>Delete</button>
										</div>
									</div>
								)) : <div style={{ opacity: 0.7 }}>No Studio docs yet for this org.</div>}
							</div>
						) : null}
					</div>
				) : null}

				{selectionBounds ? (
					<div
						onMouseDown={(e) => e.stopPropagation()}
						onClick={(e) => e.stopPropagation()}
						style={{
							position: "absolute",
							left: "50%",
							top: 10,
							transform: "translateX(-50%)",
							display: "flex",
							alignItems: "center",
							gap: 6,
							padding: "3px 8px",
							borderRadius: 999,
							height: 40,
							background: "rgba(17,24,39,0.97)",
							border: "1px solid rgba(255,255,255,0.12)",
							boxShadow: "0 8px 24px rgba(0,0,0,0.24)",
							zIndex: 40,
							maxWidth: "calc(100% - 48px)",
							overflow: "visible",
							whiteSpace: "nowrap",
						}}
					>
						<button type="button" style={{ ...panelButtonStyle(false), width: "auto", padding: "2px 8px", minHeight: 26 }} onClick={(e) => { e.stopPropagation(); duplicateSelected(); }}>Duplicate</button>
						<button type="button" style={{ ...panelButtonStyle(false), width: "auto", padding: "2px 8px", minHeight: 26 }} onClick={(e) => { e.stopPropagation(); removeSelected(); }}>Delete</button>
						<button type="button" style={{ ...panelButtonStyle(false), width: "auto", padding: "2px 8px", minHeight: 26 }} onClick={(e) => { e.stopPropagation(); updateElements(selectedIds, (item) => ({ flipX: !item.flipX })); }}>Flip H</button>
						<button type="button" style={{ ...panelButtonStyle(false), width: "auto", padding: "2px 8px", minHeight: 26 }} onClick={(e) => { e.stopPropagation(); updateElements(selectedIds, (item) => ({ flipY: !item.flipY })); }}>Flip V</button>
						<div style={{ display: "flex", alignItems: "center", gap: 4, color: "white", fontSize: 11 }}>
							<span>Opacity</span>
							<div style={{ width: 140, display: "flex", alignItems: "center" }}>
								<input type="range" min="0.05" max="1" step="0.05" value={selected ? Number(selected.opacity ?? 1) : 1} onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} onChange={(e) => updateElements(selectedIds, { opacity: Number(e.target.value) })} style={{ width: "100%", margin: 0, display: "block" }} />
							</div>
						</div>
						{selected && ["text", "shape", "svg"].includes(selected.type) ? (
							<div style={{ display: "flex", alignItems: "center", gap: 4 }}>
								{["#111827", "#ffffff", brandKit.primary, brandKit.secondary, brandKit.accent, "#ef4444", "#22c55e", "#3b82f6"].map((swatch) => (
									<button type="button" key={swatch} onClick={(e) => { e.stopPropagation(); updateElement(selected.id, selected.type === "text" ? { color: swatch } : { fill: swatch }); }} style={{ width: 18, height: 18, borderRadius: 999, border: "1px solid rgba(255,255,255,0.24)", background: swatch, cursor: "pointer", flex: "0 0 auto" }} />
								))}
							</div>
						) : null}
						{selected?.qrValue ? <button type="button" style={{ ...panelButtonStyle(false), width: "auto", padding: "2px 8px", minHeight: 26 }} onClick={(e) => { e.stopPropagation(); const nextValue = window.prompt("Edit QR value", selected.qrValue || ""); if (nextValue) updateElement(selected.id, { qrValue: nextValue, src: buildQrCodeUrl(nextValue, { fg: selected.qrFg || "#000000", bg: selected.qrBg || "#ffffff" }) }); }}>Edit QR</button> : null}
						<button type="button" style={{ ...panelButtonStyle(false), width: "auto", padding: "2px 8px", minHeight: 26 }} onClick={(e) => { e.stopPropagation(); setInspectorOpen(true); }}>Inspector</button>
					</div>
				) : null}


				<div
					ref={workspaceRef}
					onMouseDown={startWorkspaceAction}
					onTouchStart={startWorkspaceAction}
					onClick={(e) => {
						if (suppressCanvasClickRef.current) {
							suppressCanvasClickRef.current = false;
							return;
						}
						if (e.target === e.currentTarget) closeMenus();
					}}
					onDrop={onWorkspaceDrop}
					onDragOver={onWorkspaceDragOver}
					onDragEnter={onWorkspaceDragEnter}
					onContextMenu={(e) => { e.preventDefault(); if (!selectedIds.length || selectedGuideId) setContextMenu({ x: e.clientX, y: e.clientY }); }}
					style={{ position: "absolute", inset: 0, overflow: "auto", cursor: panState || spacePan || tool === "hand" ? "grab" : "default", touchAction: isMobileViewport ? "manipulation" : "none" }}>
					{currentDoc ? (
						<div style={{ position: "relative", width: "100%", minHeight: pageStackHeight, paddingTop: 0 }}>
							{showRulers ? (
								<>
									<div style={{ position: "absolute", left: RULER_SIZE, top: 0, right: 0, height: RULER_SIZE, background: "rgba(17,24,39,0.95)", borderBottom: "1px solid rgba(255,255,255,0.08)", zIndex: 20 }}>
										{Array.from({ length: Math.ceil(currentDoc.width / rulerStep) + 1 }).map((_, index) => {
											const mark = index * rulerStep;
											const major = index % 2 === 0;
											return <div key={mark} style={{ position: "absolute", left: pan.x + mark * zoom, top: 0, width: 1, height: major ? 14 : 8, background: "rgba(255,255,255,0.25)" }}>{major ? <div style={{ position: "absolute", top: 2, left: 4, fontSize: 9, color: "rgba(255,255,255,0.58)" }}>{mark}</div> : null}</div>;
										})}
									</div>
									<div style={{ position: "absolute", top: RULER_SIZE, left: 0, bottom: 0, width: RULER_SIZE, background: "rgba(17,24,39,0.95)", borderRight: "1px solid rgba(255,255,255,0.08)", zIndex: 20 }}>
										{Array.from({ length: Math.ceil(currentDoc.height / rulerStep) + 1 }).map((_, index) => {
											const mark = index * rulerStep;
											const major = index % 2 === 0;
											return <div key={mark} style={{ position: "absolute", top: pan.y + mark * zoom, left: 0, height: 1, width: major ? 18 : 10, background: "rgba(255,255,255,0.25)" }}>{major ? <div style={{ position: "absolute", left: 2, top: 4, fontSize: 9, color: "rgba(255,255,255,0.58)" }}>{mark}</div> : null}</div>;
										})}
									</div>
									<div style={{ position: "absolute", top: 0, left: 0, width: RULER_SIZE, height: RULER_SIZE, background: "rgba(17,24,39,0.95)", borderRight: "1px solid rgba(255,255,255,0.08)", borderBottom: "1px solid rgba(255,255,255,0.08)", zIndex: 21 }} />
								</>
							) : null}

							{currentPages.map((page, pageIndex) => {
								const layout = pageLayouts[pageIndex];
								if (!layout) return null;
								const isActive = pageIndex === activePageIndex;
								return (
									<React.Fragment key={page.id}>
										<div style={{ position: "absolute", left: layout.left, top: layout.top - 32, width: layout.width, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, color: "rgba(255,255,255,0.96)", fontSize: 13, fontWeight: 800, zIndex: 16 }}>
											<div style={{ textShadow: "0 1px 2px rgba(0,0,0,0.45)" }}>Page {pageIndex + 1}</div>
											<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
												<button
													onClick={(e) => { e.stopPropagation(); duplicatePage(pageIndex); }}
													style={{ padding: "4px 9px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.16)", background: "rgba(17,24,39,0.92)", color: "white", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
												>
													Duplicate
												</button>
												<button
													onClick={(e) => { e.stopPropagation(); deletePage(pageIndex); }}
													disabled={currentPages.length <= 1}
													style={{ padding: "4px 9px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.16)", background: currentPages.length <= 1 ? "rgba(107,114,128,0.4)" : "rgba(17,24,39,0.92)", color: "white", fontSize: 12, fontWeight: 700, cursor: currentPages.length <= 1 ? "not-allowed" : "pointer", opacity: currentPages.length <= 1 ? 0.65 : 1 }}
												>
													Delete
												</button>
											</div>
										</div>
																				<div
											ref={(node) => { if (node) pageShellRefs.current.set(page.id, node); else pageShellRefs.current.delete(page.id); if (isActive) canvasShellRef.current = node; }}
											role="button"
							tabIndex={0}
							aria-label={`Page ${pageIndex + 1}${isActive ? ", active" : ""}`}
							onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setActivePageIndex(pageIndex); setSelectedIds([]); setTextEditId(null); setSelectedGuideId(null); } }}
							onMouseDown={(e) => { if (!isActive) { e.stopPropagation(); setActivePageIndex(pageIndex); setSelectedIds([]); setTextEditId(null); setSelectedGuideId(null); } }}
							onTouchStart={(e) => { if (!isActive) { e.stopPropagation(); setActivePageIndex(pageIndex); setSelectedIds([]); setTextEditId(null); setSelectedGuideId(null); } }}
							onClick={() => { if (suppressCanvasClickRef.current) { suppressCanvasClickRef.current = false; return; } if (!isActive) { setActivePageIndex(pageIndex); setSelectedIds([]); setTextEditId(null); setSelectedGuideId(null); } else { setSelectedIds([]); } }}
											onDrop={onWorkspaceDrop}
											onDragOver={onWorkspaceDragOver}
											onDragEnter={onWorkspaceDragEnter}
											style={{
												position: "absolute",
												left: layout.left,
												top: layout.top,
												width: layout.width,
												height: layout.height,
												background: page.background || "#ffffff",
												borderRadius: 18,
												overflow: "visible",
												boxShadow: isActive ? "0 24px 80px rgba(0,0,0,0.35)" : "0 18px 50px rgba(0,0,0,0.22)",
								outline: isActive ? "3px solid #ef4444" : "1px solid rgba(255,255,255,0.1)",
								outlineOffset: 3,
												cursor: isActive ? "default" : "pointer",
											touchAction: isMobileViewport ? "none" : "none",
											}}
										>
											<div onDrop={onWorkspaceDrop} onDragOver={onWorkspaceDragOver} style={{ position: "absolute", inset: 0, width: page.width, height: page.height, transform: `scale(${zoom})`, transformOrigin: "top left", background: page.background || "#ffffff", overflow: "hidden", borderRadius: 18 / Math.max(zoom, 1) }}>
												{isActive ? (
													<>
														{(page.guides || []).map((guide) => guide.orientation === "vertical" ? (
															<div key={guide.id} onMouseDown={(e) => { e.stopPropagation(); setSelectedGuideId(guide.id); setGuideDrag({ id: guide.id, orientation: guide.orientation }); }} onClick={(e) => { e.stopPropagation(); setSelectedGuideId(guide.id); }} onDoubleClick={() => removeGuide(guide.id)} style={{ position: "absolute", left: guide.position, top: 0, bottom: 0, width: 8, marginLeft: -4, background: guide.id === selectedGuideId ? "rgba(239,68,68,0.22)" : "transparent", borderLeft: `1px solid ${GUIDE_COLORS.vertical}`, cursor: "ew-resize", zIndex: 9 }} />
														) : (
															<div key={guide.id} onMouseDown={(e) => { e.stopPropagation(); setSelectedGuideId(guide.id); setGuideDrag({ id: guide.id, orientation: guide.orientation }); }} onClick={(e) => { e.stopPropagation(); setSelectedGuideId(guide.id); }} onDoubleClick={() => removeGuide(guide.id)} style={{ position: "absolute", top: guide.position, left: 0, right: 0, height: 8, marginTop: -4, background: guide.id === selectedGuideId ? "rgba(96,165,250,0.22)" : "transparent", borderTop: `1px solid ${GUIDE_COLORS.horizontal}`, cursor: "ns-resize", zIndex: 9 }} />
														))}
														{(page.elements || []).map((el) => {
															if (el.hidden) return null;
															const isSelected = selectedIds.includes(el.id);
															const isCanvasBackground = el.type === "shape" && Number(el.x || 0) <= 0 && Number(el.y || 0) <= 0 && Number(el.width || 0) >= (page.width || currentDoc.width) && Number(el.height || 0) >= (page.height || currentDoc.height);
															const bounds = getElementBounds(el);
													const common = { position: "absolute", left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height, opacity: el.opacity ?? 1, transform: getElementTransform(el), boxSizing: "border-box", outline: isSelected ? "2px solid #ef4444" : "none", outlineOffset: 2, userSelect: "none", cursor: el.locked ? "not-allowed" : (tool === "hand" ? "grab" : "move"), pointerEvents: isCanvasBackground ? "none" : "auto", touchAction: "none" };
															if (el.type === "text") return <div
															key={el.id}
															onMouseDown={(e) => { if (textEditId === el.id) { e.stopPropagation(); return; } startElementDrag(e, el); }} onTouchStart={(e) => { if (textEditId === el.id) { e.stopPropagation(); return; } startElementDrag(e, el); }}
															onClick={(e) => { e.stopPropagation(); if (!(e.shiftKey || e.ctrlKey || e.metaKey)) { if (selectedIds.includes(el.id)) setTextEditId(el.id); else selectElement(el, false); } closeMenus(); }}
															onContextMenu={(e) => openContextMenu(e, el)}
															contentEditable={textEditId === el.id}
															suppressContentEditableWarning
															onBlur={(e) => { updateElement(el.id, { text: e.currentTarget.innerText }); setTextEditId(null); }}
															style={{ ...common, color: el.color, fontSize: el.fontSize, fontWeight: el.fontWeight, fontFamily: el.fontFamily || FALLBACK_FONT, lineHeight: el.lineHeight, letterSpacing: `${el.letterSpacing || 0}px`, textAlign: el.align, whiteSpace: "pre-wrap", overflow: "hidden", cursor: textEditId === el.id ? "text" : common.cursor }}
														>{showBoundPreview ? applyBindings(el.text, bindings) : el.text}</div>;
															if (el.type === "shape") return <div key={el.id} onMouseDown={(e) => startElementDrag(e, el)} onTouchStart={(e) => startElementDrag(e, el)} onClick={(e) => { e.stopPropagation(); if (!(e.shiftKey || e.ctrlKey || e.metaKey)) selectElement(el, false); closeMenus(); }} onContextMenu={(e) => openContextMenu(e, el)} style={{ ...common, background: el.fill, border: `${el.strokeWidth || 0}px solid ${el.stroke || "transparent"}`, borderRadius: el.radius || 0 }} />;
															if (el.type === "svg") return <div key={el.id} onMouseDown={(e) => startElementDrag(e, el)} onTouchStart={(e) => startElementDrag(e, el)} onClick={(e) => { e.stopPropagation(); if (!(e.shiftKey || e.ctrlKey || e.metaKey)) selectElement(el, false); closeMenus(); }} onContextMenu={(e) => openContextMenu(e, el)}><StudioCroppedMedia el={el} common={common} src={svgMarkupToDataUrl(el.svg, el.fill || "#111111")} /></div>;
															return <div key={el.id} onMouseDown={(e) => startElementDrag(e, el)} onTouchStart={(e) => startElementDrag(e, el)} onClick={(e) => { e.stopPropagation(); if (!(e.shiftKey || e.ctrlKey || e.metaKey)) selectElement(el, false); closeMenus(); }} onContextMenu={(e) => openContextMenu(e, el)}><StudioCroppedMedia el={el} common={common} src={el.src} /></div>;
														})}
														{selectionBounds ? <div style={{ position: "absolute", left: selectionBounds.left, top: selectionBounds.top, width: selectionBounds.width, height: selectionBounds.height, border: "1px dashed rgba(255,255,255,0.75)", pointerEvents: "none", zIndex: 8 }} /> : null}
														{selected && !selected.locked ? (() => { const selectedBounds = getElementBounds(selected); return [
															{ key: "nw", left: Number(selectedBounds.x || 0) - (isMobileViewport ? 14 : 8), top: Number(selectedBounds.y || 0) - (isMobileViewport ? 14 : 8), cursor: "nwse-resize", mobileVisible: true, kind: "corner" },
															{ key: "n", left: Number(selectedBounds.x || 0) + Number(selectedBounds.width || 0) / 2 - (isMobileViewport ? 14 : 10), top: Number(selectedBounds.y || 0) - (isMobileViewport ? 14 : 4), cursor: "ns-resize", mobileVisible: false, kind: "side" },
															{ key: "ne", left: Number(selectedBounds.x || 0) + Number(selectedBounds.width || 0) - (isMobileViewport ? 14 : 8), top: Number(selectedBounds.y || 0) - (isMobileViewport ? 14 : 8), cursor: "nesw-resize", mobileVisible: true, kind: "corner" },
															{ key: "e", left: Number(selectedBounds.x || 0) + Number(selectedBounds.width || 0) - (isMobileViewport ? 14 : 4), top: Number(selectedBounds.y || 0) + Number(selectedBounds.height || 0) / 2 - (isMobileViewport ? 14 : 10), cursor: "ew-resize", mobileVisible: false, kind: "side" },
															{ key: "se", left: Number(selectedBounds.x || 0) + Number(selectedBounds.width || 0) - (isMobileViewport ? 14 : 8), top: Number(selectedBounds.y || 0) + Number(selectedBounds.height || 0) - (isMobileViewport ? 14 : 8), cursor: "nwse-resize", mobileVisible: true, kind: "corner" },
															{ key: "s", left: Number(selectedBounds.x || 0) + Number(selectedBounds.width || 0) / 2 - (isMobileViewport ? 14 : 10), top: Number(selectedBounds.y || 0) + Number(selectedBounds.height || 0) - (isMobileViewport ? 14 : 4), cursor: "ns-resize", mobileVisible: false, kind: "side" },
															{ key: "sw", left: Number(selectedBounds.x || 0) - (isMobileViewport ? 14 : 8), top: Number(selectedBounds.y || 0) + Number(selectedBounds.height || 0) - (isMobileViewport ? 14 : 8), cursor: "nesw-resize", mobileVisible: true, kind: "corner" },
															{ key: "w", left: Number(selectedBounds.x || 0) - (isMobileViewport ? 14 : 4), top: Number(selectedBounds.y || 0) + Number(selectedBounds.height || 0) / 2 - (isMobileViewport ? 14 : 10), cursor: "ew-resize", mobileVisible: false, kind: "side" },
														].filter((handle) => !isMobileViewport || handle.mobileVisible).map((handle) => {
															const isCorner = handle.kind === "corner";
															const width = isMobileViewport ? 28 : (isCorner ? 16 : (handle.key === "n" || handle.key === "s" ? 20 : 8));
															const height = isMobileViewport ? 28 : (isCorner ? 16 : (handle.key === "n" || handle.key === "s" ? 8 : 20));
															return <div key={handle.key} onMouseDown={(e) => startResize(e, handle.key)} onTouchStart={(e) => startResize(e, handle.key)} style={{ position: "absolute", left: handle.left, top: handle.top, width, height, borderRadius: isCorner ? 999 : 999, background: "#ef4444", border: "2px solid white", cursor: handle.cursor, zIndex: 10, touchAction: "none", boxShadow: isMobileViewport ? "0 0 0 8px rgba(239,68,68,0.18)" : "none" }} />;
														}); })() : null}
														{marquee ? <div style={{ position: "absolute", left: marquee.left, top: marquee.top, width: marquee.width, height: marquee.height, border: "1px dashed rgba(255,255,255,0.8)", background: "rgba(239,68,68,0.12)", pointerEvents: "none", zIndex: 12 }} /> : null}
													</>
												) : (
													(page.elements || []).map((el) => {
														if (el.hidden) return null;
														const bounds = getElementBounds(el);
													const common = { position: "absolute", left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height, opacity: el.opacity ?? 1, transform: getElementTransform(el), boxSizing: "border-box", pointerEvents: "none" };
														if (el.type === "text") return <div key={el.id} style={{ ...common, color: el.color, fontSize: el.fontSize, fontWeight: el.fontWeight, fontFamily: el.fontFamily || FALLBACK_FONT, lineHeight: el.lineHeight, letterSpacing: `${el.letterSpacing || 0}px`, textAlign: el.align, whiteSpace: "pre-wrap", overflow: "hidden" }}>{showBoundPreview ? applyBindings(el.text, bindings) : el.text}</div>;
														if (el.type === "shape") return <div key={el.id} style={{ ...common, background: el.fill, border: `${el.strokeWidth || 0}px solid ${el.stroke || "transparent"}`, borderRadius: el.radius || 0 }} />;
														if (el.type === "svg") return <StudioCroppedMedia key={el.id} el={el} common={common} src={svgMarkupToDataUrl(el.svg, el.fill || "#111111")} />;
													return <StudioCroppedMedia key={el.id} el={el} common={common} src={el.src} />;
													})
												)}
											</div>
										</div>
									</React.Fragment>
								);
							})}
							{pageLayouts.length ? (
								<button onClick={(e) => { e.stopPropagation(); addPage(); }} style={{ position: "absolute", left: (pageLayouts[pageLayouts.length - 1]?.left || 0) + ((pageLayouts[pageLayouts.length - 1]?.width || 0) / 2) - 76, top: (pageLayouts[pageLayouts.length - 1]?.top || 0) + (pageLayouts[pageLayouts.length - 1]?.height || 0) + 24, width: 152, padding: "10px 14px", borderRadius: 999, border: "1px dashed rgba(255,255,255,0.24)", background: "rgba(17,24,39,0.96)", color: "white", fontWeight: 700, zIndex: 18, cursor: "pointer" }}>
									+ Add Page
								</button>
							) : null}
						</div>
					) : <div style={{ minHeight: 600, display: "grid", placeItems: "center", opacity: 0.7 }}>Create a document to start.</div>}
				</div>

				{contextMenu ? (
					<div onClick={(e) => e.stopPropagation()} style={{ position: "fixed", left: Math.min(contextMenu.x, window.innerWidth - 210), top: Math.min(contextMenu.y, window.innerHeight - 220), width: 190, zIndex: 80, background: "rgba(17,24,39,0.98)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 14, padding: 8, boxShadow: "0 18px 60px rgba(0,0,0,0.35)" }}>
						<div style={{ display: "grid", gap: 6 }}>
							<button style={panelButtonStyle(false)} onClick={() => { copySelected(); setContextMenu(null); }} disabled={!selectedIds.length}>Copy</button>
							<button style={panelButtonStyle(false)} onClick={() => { cutSelected(); setContextMenu(null); }} disabled={!selectedIds.length}>Cut</button>
							<button style={panelButtonStyle(false)} onClick={() => { pasteClipboard(); setContextMenu(null); }} disabled={!clipboard.length}>Paste</button>
							<button style={panelButtonStyle(false)} onClick={() => { duplicateSelected(); setContextMenu(null); }} disabled={!selectedIds.length}>Duplicate</button>
							<button style={panelButtonStyle(false)} onClick={() => { removeSelected(); setContextMenu(null); }} disabled={!selectedIds.length}>Delete</button>
							<button
								style={panelButtonStyle(false)}
								onClick={() => {
									const ids = contextMenu?.targetIds?.length
										? [...new Set([...(selectedIds || []), ...(contextMenu.targetIds || [])])]
										: selectedIds;
									groupSpecificIds(ids);
									setContextMenu(null);
								}}
								disabled={((contextMenu?.targetIds?.length ? [...new Set([...(selectedIds || []), ...(contextMenu.targetIds || [])])] : selectedIds).length) < 2}
							>Group</button>
							<button
								style={panelButtonStyle(false)}
								onClick={() => {
									const ids = contextMenu?.targetIds?.length
										? [...new Set([...(selectedIds || []), ...(contextMenu.targetIds || [])])]
										: selectedIds;
									ungroupSpecificIds(ids);
									setContextMenu(null);
								}}
								disabled={!selectedElements.some((el) => el.groupId) && !contextMenu?.groupId}
							>Ungroup</button>
							<button style={panelButtonStyle(false)} onClick={() => { setInspectorOpen(true); setContextMenu(null); }} disabled={!selectedIds.length}>Open Inspector</button>
						</div>
					</div>
				) : null}
				{inspectorOpen ? (
					<div style={{ position: "absolute", top: 12, right: 12, bottom: 12, width: 340, zIndex: 26, background: "rgba(17,24,39,0.98)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 16, padding: 14, overflow: "auto", boxShadow: "0 18px 60px rgba(0,0,0,0.35)" }}>
						<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10 }}>
							<div style={{ fontWeight: 800 }}>Inspector</div>
							<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
								<div style={{ fontSize: 12, opacity: 0.7 }}>{currentPage ? `${currentPage.width} × ${currentPage.height}` : currentDoc ? `${currentDoc.width} × ${currentDoc.height}` : "No canvas"}</div>
								<button onClick={() => setInspectorOpen(false)} style={{ padding: "4px 8px", borderRadius: 8 }}>✕</button>
							</div>
						</div>
						<div style={{ fontSize: 12, opacity: 0.72, marginBottom: 12 }}>{savedAt ? `Saved locally ${formatSavedAt(savedAt)}` : ""}</div>
						<div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
							<button onClick={duplicateSelected} disabled={!selectedIds.length}>Duplicate</button>
							<button onClick={removeSelected} disabled={!selectedIds.length}>Delete</button>
							<button onClick={() => moveLayer("down")} disabled={!selectedIds.length}>Send Back</button>
							<button onClick={() => moveLayer("up")} disabled={!selectedIds.length}>Bring Forward</button>
							<button onClick={groupSelection} disabled={selectedIds.length < 2}>Group Selected</button>
							<button onClick={ungroupSelection} disabled={!selectedElements.some((el) => el.groupId)}>Ungroup</button>
							<button onClick={() => toggleSelectedFlag("locked")} disabled={!selectedIds.length}>{selectedElements.every((el) => el.locked) ? "Unlock" : "Lock"}</button>
							<button onClick={() => toggleSelectedFlag("hidden")} disabled={!selectedIds.length}>{selectedElements.every((el) => el.hidden) ? "Show" : "Hide"}</button>
						</div>
						{multiSelection ? (
							<div style={{ display: "grid", gap: 10 }}>
								<div style={{ fontWeight: 700 }}>{selectedIds.length} layers selected</div>
								<div style={{ fontSize: 12, opacity: 0.75 }}>Shift click to add or remove layers. Grouping lets them move together.</div>
							</div>
						) : selected ? (
							<div style={{ display: "grid", gap: 10 }}>
								<label>Layer name<input value={selected.name || ""} onChange={(e) => updateElement(selected.id, { name: e.target.value })} style={{ width: "100%" }} /></label>
								<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
									<label>X<input type="number" value={Math.round(selected.x)} onChange={(e) => updateElement(selected.id, { x: Number(e.target.value || 0) })} style={{ width: "100%" }} /></label>
									<label>Y<input type="number" value={Math.round(selected.y)} onChange={(e) => updateElement(selected.id, { y: Number(e.target.value || 0) })} style={{ width: "100%" }} /></label>
									<label>Width<input type="number" value={Math.round(selected.width)} onChange={(e) => updateElement(selected.id, { width: Number(e.target.value || 1) })} style={{ width: "100%" }} /></label>
									<label>Height<input type="number" value={Math.round(selected.height)} onChange={(e) => updateElement(selected.id, { height: Number(e.target.value || 1) })} style={{ width: "100%" }} /></label>
									<label>Rotation<input type="number" value={selected.rotation || 0} onChange={(e) => updateElement(selected.id, { rotation: Number(e.target.value || 0) })} style={{ width: "100%" }} /></label>
									<label>Opacity<input type="number" min="0" max="1" step="0.05" value={selected.opacity ?? 1} onChange={(e) => updateElement(selected.id, { opacity: Number(e.target.value || 1) })} style={{ width: "100%" }} /></label>
								</div>
								{selected.type === "text" ? (<>
									<label>Text<textarea value={selected.text} onChange={(e) => updateElement(selected.id, { text: e.target.value })} rows={5} style={{ width: "100%" }} /></label>
									<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
										<label>Font size<input type="number" value={selected.fontSize} onChange={(e) => updateElement(selected.id, { fontSize: Number(e.target.value || 12) })} style={{ width: "100%" }} /></label>
										<label>Weight<input type="number" value={selected.fontWeight || 700} onChange={(e) => updateElement(selected.id, { fontWeight: Number(e.target.value || 400) })} style={{ width: "100%" }} /></label>
										<label>Line height<input type="number" step="0.05" value={selected.lineHeight || 1.1} onChange={(e) => updateElement(selected.id, { lineHeight: Number(e.target.value || 1.1) })} style={{ width: "100%" }} /></label>
										<label>Letter spacing<input type="number" value={selected.letterSpacing || 0} onChange={(e) => updateElement(selected.id, { letterSpacing: Number(e.target.value || 0) })} style={{ width: "100%" }} /></label>
									</div>
									<div style={{ display: "grid", gap: 8 }}>
										<label>Font search<input value={fontSearch} onChange={(e) => setFontSearch(e.target.value)} placeholder="Search Google or uploaded fonts" style={{ width: "100%" }} /></label>
										<label>Font family<select value={selected.fontFamily || FALLBACK_FONT} onChange={(e) => { const nextFont = e.target.value; updateElement(selected.id, { fontFamily: nextFont }); ensureFontLoaded(nextFont); markFontRecent(nextFont); }} style={{ width: "100%" }}>
											<optgroup label="Recent">
												{recentFonts.map((font) => <option key={`recent_${font.family}`} value={font.family}>{font.family}</option>)}
											</optgroup>
											<optgroup label="Uploaded">
												{uploadedFonts.map((font) => <option key={`uploaded_${font.id}`} value={font.family}>{font.family}</option>)}
											</optgroup>
											<optgroup label="Google Fonts">
												{availableFonts.map((font) => <option key={font.family} value={font.family}>{font.family}</option>)}
											</optgroup>
										</select></label>
										<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
											<button type="button" onClick={() => fontUploadRef.current?.click()}>Upload font</button>
											<div style={{ fontSize: 12, opacity: 0.72 }}>{fontStatus}</div>
										</div>
									</div>
									<label>Alignment<select value={selected.align || "left"} onChange={(e) => updateElement(selected.id, { align: e.target.value })} style={{ width: "100%" }}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label>
									<label>Text color<input type="color" value={selected.color || "#000000"} onChange={(e) => updateElement(selected.id, { color: e.target.value })} style={{ width: "100%" }} /></label>
								</>) : null}
								{selected.type === "shape" ? (<>
									<label>Fill<input type="color" value={selected.fill || "#ef4444"} onChange={(e) => updateElement(selected.id, { fill: e.target.value })} style={{ width: "100%" }} /></label>
									<label>Stroke<input type="color" value={selected.stroke || "#ffffff"} onChange={(e) => updateElement(selected.id, { stroke: e.target.value })} style={{ width: "100%" }} /></label>
									<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
										<label>Stroke width<input type="number" value={selected.strokeWidth || 0} onChange={(e) => updateElement(selected.id, { strokeWidth: Number(e.target.value || 0) })} style={{ width: "100%" }} /></label>
										<label>Radius<input type="number" value={selected.radius || 0} onChange={(e) => updateElement(selected.id, { radius: Number(e.target.value || 0) })} style={{ width: "100%" }} /></label>
									</div>
								</>) : null}
								{selected.type === "image" ? (
									<>
										<label>Fit<select value={selected.fit || "cover"} onChange={(e) => updateElement(selected.id, { fit: e.target.value })} style={{ width: "100%" }}><option value="cover">Cover</option><option value="contain">Contain</option><option value="fill">Fill</option></select></label>
										{selected.qrValue ? (
											<>
												<label>QR value<textarea value={selected.qrValue || ""} onChange={(e) => updateElement(selected.id, { qrValue: e.target.value, src: buildQrCodeUrl(e.target.value, { fg: selected.qrFg || "#000000", bg: selected.qrBg || "#ffffff" }) })} rows={4} style={{ width: "100%" }} /></label>
												<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
													<label>QR foreground<input type="color" value={selected.qrFg || "#000000"} onChange={(e) => updateElement(selected.id, { qrFg: e.target.value, src: buildQrCodeUrl(selected.qrValue || "", { fg: e.target.value, bg: selected.qrBg || "#ffffff" }) })} style={{ width: "100%" }} /></label>
													<label>QR background<input type="color" value={selected.qrBg || "#ffffff"} onChange={(e) => updateElement(selected.id, { qrBg: e.target.value, src: buildQrCodeUrl(selected.qrValue || "", { fg: selected.qrFg || "#000000", bg: e.target.value }) })} style={{ width: "100%" }} /></label>
												</div>
												<button type="button" onClick={() => updateElement(selected.id, { src: buildQrCodeUrl(selected.qrValue || "", { fg: selected.qrFg || "#000000", bg: selected.qrBg || "#ffffff" }) })}>Regenerate QR</button>
											</>
										) : null}
									</>
								) : null}
							</div>
						) : <div style={{ display: "grid", gap: 10 }}>
							<label>Canvas background<input type="color" value={currentPage?.background || "#ffffff"} onChange={(e) => currentPage && updatePage({ background: e.target.value })} style={{ width: "100%" }} /></label>
							<div style={{ opacity: 0.7 }}>Select a layer to edit it.</div>
						</div>}
						<div style={{ marginTop: 14 }}>
							<div style={{ fontWeight: 700, marginBottom: 8 }}>Layers</div>
							<div style={{ display: "grid", gap: 6, maxHeight: 320, overflow: "auto" }}>
								{orderedLayers.length ? orderedLayers.map((el) => (
									<button key={el.id} onClick={(e) => selectElement(el, e.shiftKey || e.ctrlKey || e.metaKey)} style={{ textAlign: "left", border: selectedIds.includes(el.id) ? "1px solid #ef4444" : "1px solid rgba(255,255,255,0.08)", background: selectedIds.includes(el.id) ? "rgba(239,68,68,0.15)" : "rgba(255,255,255,0.04)", borderRadius: 10, padding: 8 }}>
										<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}><div style={{ fontWeight: 700 }}>{el.name || el.type}</div><div style={{ fontSize: 10, opacity: 0.7 }}>#{el._order}</div></div>
										<div style={{ fontSize: 12, opacity: 0.72 }}>{el.type}{el.groupId ? ` • ${el.groupName || "grouped"}` : ""}{el.locked ? " • locked" : ""}{el.hidden ? " • hidden" : ""}</div>
									</button>
								)) : <div style={{ opacity: 0.7 }}>No layers yet.</div>}
							</div>
						</div>
					</div>
				) : null}
			</div>
		</div>
	);

}
