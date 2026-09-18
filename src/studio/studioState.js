function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function fallbackPageFromDocument(document) {
  return {
    id: `legacy-${String(document?.id || "studio")}-page-1`,
    width: Number(document?.width || 1080),
    height: Number(document?.height || 1350),
    background: document?.background || "#ffffff",
    elements: Array.isArray(document?.elements) ? cloneValue(document.elements) : [],
    guides: Array.isArray(document?.guides) ? cloneValue(document.guides) : [],
  };
}

export function getStudioPages(document) {
  if (Array.isArray(document?.pages) && document.pages.length) return document.pages;
  return [fallbackPageFromDocument(document || {})];
}

export function syncStudioLegacyRoot(document) {
  const pages = getStudioPages(document);
  const firstPage = pages[0] || fallbackPageFromDocument(document || {});
  return {
    ...document,
    pages,
    width: Number(firstPage.width || 1080),
    height: Number(firstPage.height || 1350),
    background: firstPage.background || "#ffffff",
    elements: Array.isArray(firstPage.elements) ? firstPage.elements : [],
    guides: Array.isArray(firstPage.guides) ? firstPage.guides : [],
  };
}

export function updateStudioDocument(document, patchOrUpdater, now = Date.now()) {
  if (!document) return document;
  const patch = typeof patchOrUpdater === "function"
    ? patchOrUpdater(document)
    : patchOrUpdater;
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return document;
  const next = {
    ...document,
    ...patch,
    pages: getStudioPages(document),
    updatedAt: now,
  };
  return syncStudioLegacyRoot(next);
}

export function updateStudioPage(document, pageIndex, patchOrUpdater, now = Date.now()) {
  if (!document) return document;
  const pages = getStudioPages(document).map((page) => ({
    ...page,
    elements: Array.isArray(page?.elements) ? page.elements : [],
    guides: Array.isArray(page?.guides) ? page.guides : [],
  }));
  const index = Math.max(0, Math.min(Number(pageIndex || 0), pages.length - 1));
  const currentPage = pages[index];
  const patch = typeof patchOrUpdater === "function"
    ? patchOrUpdater(currentPage)
    : patchOrUpdater;
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return document;
  pages[index] = {
    ...currentPage,
    ...patch,
    elements: Array.isArray(patch.elements) ? patch.elements : currentPage.elements,
    guides: Array.isArray(patch.guides) ? patch.guides : currentPage.guides,
  };
  return syncStudioLegacyRoot({ ...document, pages, updatedAt: now });
}

function defaultIdFactory() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function shiftCoordinate(value, offset) {
  return Number(value || 0) + offset;
}

function cloneStudioElement(element, id, offset) {
  const next = { ...cloneValue(element), id };
  next.x = shiftCoordinate(element?.x, offset);
  next.y = shiftCoordinate(element?.y, offset);
  if (Number.isFinite(Number(element?.mediaX))) next.mediaX = shiftCoordinate(element.mediaX, offset);
  if (Number.isFinite(Number(element?.mediaY))) next.mediaY = shiftCoordinate(element.mediaY, offset);
  return next;
}

export function cloneStudioElements(elements, { offset = 24, idFactory = defaultIdFactory } = {}) {
  const source = (Array.isArray(elements) ? elements : []).filter((element) => element && typeof element === "object" && !Array.isArray(element));
  if (!source.length) return [];

  const elementIdMap = new Map();
  const groupIdMap = new Map();
  for (const element of source) {
    elementIdMap.set(String(element.id || ""), idFactory());
    if (element.groupId && !groupIdMap.has(String(element.groupId))) {
      groupIdMap.set(String(element.groupId), idFactory());
    }
  }

  return source.map((element) => {
    const next = cloneStudioElement(element, elementIdMap.get(String(element.id || "")), Number(offset || 0));
    if (element.groupId) next.groupId = groupIdMap.get(String(element.groupId));
    if (element.parentId && elementIdMap.has(String(element.parentId))) {
      next.parentId = elementIdMap.get(String(element.parentId));
    }
    return next;
  });
}

export function pasteStudioElements(document, pageIndex, clipboard, options = {}) {
  const pasted = cloneStudioElements(clipboard, options);
  if (!pasted.length) return { document, elements: [] };
  const nextDocument = updateStudioPage(document, pageIndex, (page) => ({
    elements: [...(Array.isArray(page.elements) ? page.elements : []), ...pasted],
  }), options.now);
  return { document: nextDocument, elements: pasted };
}

function translatedElement(element, deltaX, deltaY) {
  const next = { ...element };
  next.x = Number(element?.x || 0) + Number(deltaX || 0);
  next.y = Number(element?.y || 0) + Number(deltaY || 0);
  if (Number.isFinite(Number(element?.mediaX))) next.mediaX = Number(element.mediaX) + Number(deltaX || 0);
  if (Number.isFinite(Number(element?.mediaY))) next.mediaY = Number(element.mediaY) + Number(deltaY || 0);
  return next;
}

export function moveStudioElementsBetweenPages(document, sourcePageIndex, targetPageIndex, elementIds, { deltaX = 0, deltaY = 0, now = Date.now() } = {}) {
  if (!document) return { document, elements: [] };
  const pages = getStudioPages(document).map((page) => ({
    ...page,
    elements: Array.isArray(page?.elements) ? page.elements.slice() : [],
    guides: Array.isArray(page?.guides) ? page.guides : [],
  }));
  const sourceIndex = Number(sourcePageIndex);
  const targetIndex = Number(targetPageIndex);
  if (!Number.isInteger(sourceIndex) || !Number.isInteger(targetIndex) || sourceIndex < 0 || targetIndex < 0 || sourceIndex >= pages.length || targetIndex >= pages.length) {
    return { document, elements: [] };
  }
  const wanted = new Set((Array.isArray(elementIds) ? elementIds : []).map(String));
  if (!wanted.size) return { document, elements: [] };

  const sourceElements = pages[sourceIndex].elements;
  const selected = sourceElements.filter((element) => wanted.has(String(element?.id)));
  if (!selected.length) return { document, elements: [] };
  const moved = selected.map((element) => translatedElement(element, deltaX, deltaY));

  if (sourceIndex === targetIndex) {
    const movedById = new Map(moved.map((element) => [String(element.id), element]));
    pages[sourceIndex] = {
      ...pages[sourceIndex],
      elements: sourceElements.map((element) => movedById.get(String(element?.id)) || element),
    };
  } else {
    pages[sourceIndex] = {
      ...pages[sourceIndex],
      elements: sourceElements.filter((element) => !wanted.has(String(element?.id))),
    };
    pages[targetIndex] = {
      ...pages[targetIndex],
      elements: [...pages[targetIndex].elements, ...moved],
    };
  }

  return {
    document: syncStudioLegacyRoot({ ...document, pages, updatedAt: now }),
    elements: moved,
  };
}

export function canApplyStudioRemoteSnapshot({
  requestLocalRevision = 0,
  currentLocalRevision = 0,
  syncedLocalRevision = 0,
  hasActiveInteraction = false,
} = {}) {
  if (Number(currentLocalRevision || 0) > Number(requestLocalRevision || 0)) return false;
  if (Number(currentLocalRevision || 0) > Number(syncedLocalRevision || 0)) return false;
  if (hasActiveInteraction) return false;
  return true;
}

export function normalizeStudioSyncMeta(value) {
  return {
    localRevision: Math.max(0, Number(value?.localRevision || 0)),
    syncedLocalRevision: Math.max(0, Number(value?.syncedLocalRevision || 0)),
  };
}
