// Image operations stay on this device and preserve source alpha.
export function imagePlacement(width, height, pageWidth, pageHeight, point) {
  const scale = Math.min(1, pageWidth * 0.65 / width, pageHeight * 0.65 / height);
  const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale));
  const x = Math.max(0, (point?.x ?? pageWidth / 2) - w / 2);
  const y = Math.max(0, (point?.y ?? pageHeight / 2) - h / 2);
  return { x, y, width: w, height: h, mediaX: x, mediaY: y, mediaWidth: w, mediaHeight: h };
}

export function imageDrawRect(iw, ih, x, y, width, height, fit = 'cover') {
  if (fit === 'fill') return [x, y, width, height];
  const scale = (fit === 'contain' ? Math.min : Math.max)(width / iw, height / ih);
  const w = iw * scale, h = ih * scale;
  return [x + (width - w) / 2, y + (height - h) / 2, w, h];
}

export function eraseImageColor(data, width, height, x, y, tolerance = 24, connected = true) {
  const start = (Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))) * 4;
  const color = data.slice(start, start + 3);
  const matches = i => data[i + 3] > 0 && Math.max(...color.map((c, j) => Math.abs(c - data[i + j]))) <= tolerance;
  if (!connected) {
    for (let i = 0; i < data.length; i += 4) if (matches(i)) data[i + 3] = 0;
    return;
  }
  const visited = new Uint8Array(width * height), queue = [start / 4];
  visited[start / 4] = 1;
  for (let q = 0; q < queue.length; q++) {
    const p = queue[q];
    if (!matches(p * 4)) continue;
    data[p * 4 + 3] = 0;
    for (const n of [p % width ? p - 1 : -1, p % width < width - 1 ? p + 1 : -1, p - width, p + width]) {
      if (n >= 0 && n < visited.length && !visited[n]) { visited[n] = 1; queue.push(n); }
    }
  }
}

export async function loadStudioImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('This image could not be loaded. Upload the original PNG, WebP, SVG or JPG file.'));
    img.src = src;
  });
}

export function readImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) return reject(new Error('Choose an image file.'));
    if (file.size > 20 * 1024 * 1024) return reject(new Error('This image is over 20 MB. Resize it before uploading.'));
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read this image. Try uploading it again.'));
    reader.readAsDataURL(file);
  });
}

export function positionStudioElements(elements, ids, action, page) {
  const chosen = elements.filter(el => ids.includes(el.id) && !el.locked && !el.hidden);
  if (!chosen.length) return elements;
  const groups = new Map();
  for (const el of chosen) {
    const key = el.groupId || el.id;
    groups.set(key, [...(groups.get(key) || []), el]);
  }
  const units = [...groups.values()].map(items => {
    const left = Math.min(...items.map(el => el.x)), top = Math.min(...items.map(el => el.y));
    return { items, x: left, y: top, width: Math.max(...items.map(el => el.x + el.width)) - left, height: Math.max(...items.map(el => el.y + el.height)) - top };
  });
  const deltas = new Map();
  const apply = (unit, dx, dy) => unit.items.forEach(el => deltas.set(el.id, { dx, dy }));
  if (action.startsWith('space-')) {
    if (units.length < 3) return elements;
    const axis = action === 'space-x' ? 'x' : 'y', dimension = axis === 'x' ? 'width' : 'height';
    units.sort((a, b) => a[axis] - b[axis]);
    const span = units.at(-1)[axis] + units.at(-1)[dimension] - units[0][axis];
    const gap = (span - units.reduce((sum, u) => sum + u[dimension], 0)) / (units.length - 1);
    let cursor = units[0][axis];
    units.forEach(unit => { apply(unit, axis === 'x' ? cursor - unit.x : 0, axis === 'y' ? cursor - unit.y : 0); cursor += unit[dimension] + gap; });
  } else {
    units.forEach(unit => apply(unit,
      action === 'left' ? -unit.x : action === 'center' ? (page.width - unit.width) / 2 - unit.x : action === 'right' ? page.width - unit.width - unit.x : 0,
      action === 'top' ? -unit.y : action === 'middle' ? (page.height - unit.height) / 2 - unit.y : action === 'bottom' ? page.height - unit.height - unit.y : 0));
  }
  return elements.map(el => {
    const d = deltas.get(el.id);
    return d ? { ...el, x: el.x + d.dx, y: el.y + d.dy, ...(el.mediaX !== undefined ? { mediaX: el.mediaX + d.dx, mediaY: el.mediaY + d.dy } : {}) } : el;
  });
}
