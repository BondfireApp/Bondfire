import React, { useEffect, useRef, useState } from 'react';
import { eraseImageColor, loadStudioImage } from './studioMedia.js';
import './studioImageEditor.css';

export default function StudioImageEditor({ image, onApply, onClose }) {
  const canvasRef = useRef(null), original = useRef(null), past = useRef([]), future = useRef([]), drawing = useRef(null);
  const dialogRef = useRef(null);
  const [ready, setReady] = useState(false), [error, setError] = useState('');
  const [tool, setTool] = useState('color'), [tolerance, setTolerance] = useState(28), [connected, setConnected] = useState(true);
  const [size, setSize] = useState(24), [backdrop, setBackdrop] = useState('checker'), [revision, setRevision] = useState(0);
  const [hasAlpha, setHasAlpha] = useState(false);
  const bump = () => setRevision(n => n + 1);
  useEffect(() => {
    const previous = document.activeElement;
    dialogRef.current?.focus();
    let cancelled = false;
    loadStudioImage(image.src).then(img => {
      if (cancelled) return;
      if (img.naturalWidth * img.naturalHeight > 16000000) throw new Error('Resize this image below 16 megapixels before cleaning it.');
      const canvas = canvasRef.current;
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      original.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
      setHasAlpha(original.current.data.some((v, i) => i % 4 === 3 && v < 255));
      setReady(true);
    }).catch(err => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; previous?.focus?.(); };
  }, [image.src]);
  const current = () => canvasRef.current.getContext('2d').getImageData(0, 0, canvasRef.current.width, canvasRef.current.height);
  const checkpoint = () => {
    // At most 64 MB of pixel history, with an upper limit of 20 actions.
    const count = Math.max(1, Math.min(20, Math.floor(64 * 1024 * 1024 / original.current.data.length)));
    past.current = [...past.current, current()].slice(-count); future.current = []; bump();
  };
  const moveHistory = redo => {
    const from = redo ? future.current : past.current, to = redo ? past.current : future.current;
    if (!from.length) return;
    to.push(current()); canvasRef.current.getContext('2d').putImageData(from.pop(), 0, 0); bump();
  };
  const point = e => {
    const c = canvasRef.current, rect = c.getBoundingClientRect();
    return { x: Math.floor((e.clientX - rect.left) * c.width / rect.width), y: Math.floor((e.clientY - rect.top) * c.height / rect.height) };
  };
  const paint = (from, to) => {
    const canvas = canvasRef.current, ctx = canvas.getContext('2d');
    const pixels = current(), source = original.current.data;
    const radius = size / 2, steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / Math.max(1, radius / 2)));
    for (let step = 0; step <= steps; step++) {
      const cx = from.x + (to.x - from.x) * step / steps, cy = from.y + (to.y - from.y) * step / steps;
      for (let y = Math.max(0, Math.floor(cy - radius)); y < Math.min(canvas.height, cy + radius); y++) {
        for (let x = Math.max(0, Math.floor(cx - radius)); x < Math.min(canvas.width, cx + radius); x++) {
          if ((x - cx) ** 2 + (y - cy) ** 2 > radius ** 2) continue;
          const i = (y * canvas.width + x) * 4;
          if (tool === 'restore') pixels.data.set(source.subarray(i, i + 4), i);
          else pixels.data[i + 3] = 0;
        }
      }
    }
    ctx.putImageData(pixels, 0, 0);
  };
  const onKeyDown = e => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    if ((e.ctrlKey || e.metaKey) && ['z', 'y'].includes(e.key.toLowerCase())) { e.preventDefault(); moveHistory(e.shiftKey || e.key.toLowerCase() === 'y'); }
    if (e.key === 'Tab') {
      const nodes = [...dialogRef.current.querySelectorAll('button:not(:disabled), input, select, canvas')];
      const first = nodes[0], last = nodes.at(-1);
      if (e.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
  };
  return <div className="studioImageBackdrop" onMouseDown={e => e.stopPropagation()}>
    <section ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Edit image transparency" className="studioImageDialog" onKeyDown={onKeyDown}>
      <header><h2>Edit image transparency</h2><button onClick={onClose}>Cancel</button></header>
      <p>{hasAlpha ? 'This image already contains transparent pixels.' : 'This image has no transparent pixels. Any checkerboard you see is part of the picture.'} Remove a color or erase by hand; restore brings back the original pixels.</p>
      <div className="studioImageControls">
        <label>Tool<select value={tool} onChange={e => setTool(e.target.value)}><option value="color">Remove color</option><option value="erase">Erase brush</option><option value="restore">Restore brush</option></select></label>
        {tool === 'color' ? <><label>Tolerance: {tolerance}<input type="range" min="0" max="150" value={tolerance} onChange={e => setTolerance(Number(e.target.value))} /></label><label><input type="checkbox" checked={connected} onChange={e => setConnected(e.target.checked)} /> Connected area only</label></> : <label>Brush size: {size}px<input type="range" min="2" max="200" value={size} onChange={e => setSize(Number(e.target.value))} /></label>}
        <label>Preview background<select value={backdrop} onChange={e => setBackdrop(e.target.value)}><option value="checker">Checkerboard</option><option value="dark">Dark</option><option value="light">Light</option></select></label>
        <button disabled={!past.current.length} onClick={() => moveHistory(false)}>Undo</button><button disabled={!future.current.length} onClick={() => moveHistory(true)}>Redo</button>
      </div>
      <p>Click a background color to remove it. For a baked-in checkerboard, turn off “Connected area only” and click each gray and white color. This also removes matching colors inside the artwork; use Restore to recover them.</p>
      {error && <p role="alert">{error}</p>}
      <div className={`studioImagePreview ${backdrop}`}>
        <canvas ref={canvasRef} tabIndex={0} aria-label="Image cleanup preview; click to remove a color or drag to brush" onPointerDown={e => {
          if (!ready) return;
          e.preventDefault(); const p = point(e); checkpoint();
          if (tool === 'color') { const data = current(); eraseImageColor(data.data, data.width, data.height, p.x, p.y, tolerance, connected); canvasRef.current.getContext('2d').putImageData(data, 0, 0); }
          else { drawing.current = p; canvasRef.current.setPointerCapture(e.pointerId); paint(p, p); }
        }} onPointerMove={e => { if (drawing.current) { const p = point(e); paint(drawing.current, p); drawing.current = p; } }} onPointerUp={() => { drawing.current = null; }} onPointerCancel={() => { drawing.current = null; }} />
      </div>
      <footer><button disabled={!ready || !revision} onClick={() => { checkpoint(); canvasRef.current.getContext('2d').putImageData(original.current, 0, 0); }}>Reset image</button><button disabled={!ready} onClick={() => onApply(canvasRef.current.toDataURL('image/png'))}>Apply transparent PNG</button></footer>
    </section>
  </div>;
}
