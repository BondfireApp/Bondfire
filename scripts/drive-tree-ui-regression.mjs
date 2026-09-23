import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const { Window } = await import(process.env.HAPPY_DOM_MODULE || 'happy-dom');
const win = new Window({ url: 'http://localhost:5174/#/org/qa/drive' });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Event', 'MouseEvent', 'localStorage', 'sessionStorage']) Object.defineProperty(globalThis, name, { value: name === 'window' ? win : win[name], configurable: true });
globalThis.requestAnimationFrame = win.requestAnimationFrame.bind(win);
globalThis.cancelAnimationFrame = win.cancelAnimationFrame.bind(win);
const rows = { folders: [{ id: 'closed', name: 'Closed folder', parentId: null }], notes: [], files: [], templates: [] };
let saves = 0;
globalThis.driveTestApi = async (path, opts = {}) => {
  if (path.endsWith('/drive')) return structuredClone(rows);
  if (path.includes('/shares')) return { items: [] };
  if (path.endsWith('/drive/notes') && opts.method === 'POST') {
    const note = { id: 'new-note', ...JSON.parse(opts.body) }; rows.notes.push(note); return { note };
  }
  if (path.endsWith('/drive/notes/new-note') && opts.method === 'PATCH') {
    const note = { ...rows.notes[0], ...JSON.parse(opts.body) }; rows.notes[0] = note; saves++; return { note };
  }
  if (path.endsWith('/drive/files') && opts.method === 'POST') {
    const file = { id: rows.files.length ? `file-${rows.files.length}` : 'new-sheet', ...JSON.parse(opts.body) }; rows.files.push(file); return { file };
  }
  if (path.includes('/drive/files/') && opts.method === 'PATCH') {
    const index = rows.files.findIndex(file => file.id === path.split('/').pop());
    const file = { ...rows.files[index], ...JSON.parse(opts.body) }; rows.files[index] = file; saves++; return { file };
  }
  if (path.includes('/drive/files/') && !opts.method) return { file: rows.files.find(file => file.id === path.split('/').pop()) };
  return {};
};
const { createServer } = await import('vite');
const vite = await createServer({ root, configFile: false, plugins: [{ name: 'drive-test-api', enforce: 'pre', transform(code, id) { if (id.endsWith('/src/utils/api.js')) return 'export const api=(...args)=>globalThis.driveTestApi(...args);'; return code.replaceAll('import.meta?.env?.', 'import.meta.env.'); } }], server: { middlewareMode: true }, appType: 'custom' });
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { HashRouter, Routes, Route } = await import('react-router-dom');
const { default: Drive } = await vite.ssrLoadModule('/src/pages/Drive.jsx');
const container = document.createElement('div'); document.body.append(container);
const app = createRoot(container), el = React.createElement;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function wait(fn, label) { for (let i = 0; i < 150; i++) { if (fn()) return; await pause(20); } throw new Error(`Timed out: ${label}\n${document.body.textContent.slice(-3000)}`); }
function button(name) { return [...document.querySelectorAll('button')].find(node => node.textContent.trim() === name || node.getAttribute('aria-label') === name) || [...document.querySelectorAll('button')].find(node => [...node.children].some(child => child.textContent === name)); }
function edit(input, value) { input.focus(); const setter = Object.getOwnPropertyDescriptor(input.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype, 'value').set; setter.call(input, value); input.dispatchEvent(new win.Event('input', { bubbles: true })); }
function shortcut(node, key, extra = {}) { const event = new win.KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true, ...extra }); node.dispatchEvent(event); return event; }
try {
  app.render(el(HashRouter, null, el(Routes, null, el(Route, { path: '/org/:orgId/drive', element: el(Drive) }))));
  await wait(() => document.querySelector('[data-drive-tree-row]'), 'tree load');
  const folder = [...document.querySelectorAll('[data-drive-tree-row]')].find(node => node.textContent.includes('Closed folder'));
  folder.querySelector('.bf-drive-treeMain').click();
  await pause(30);
  // A search that excludes the new item must not keep it hidden after creation.
  edit(document.querySelector('input[placeholder="Search Drive"]'), 'unmatched');
  button('New').click();
  await wait(() => button('Rich note'), 'create note picker');
  button('Rich note').click();
  await wait(() => document.querySelector('.bf-drive-tree')?.textContent.includes('untitled'), 'new note revealed inside closed folder');
  assert.equal(document.querySelector('input[placeholder="Search Drive"]').value, '');
  edit(document.querySelector('input[placeholder="Untitled"]'), 'Saved without refreshing');
  await wait(() => saves > 0 && document.querySelector('.bf-drive-tree')?.textContent.includes('Saved without refreshing'), 'saved note updates tree');
  const noteInput = document.querySelector('#bf-drive-editor-zone textarea');
  edit(noteInput, 'Text to undo');
  await wait(() => rows.notes[0].body === 'Text to undo', 'note autosave');
  assert.equal(shortcut(noteInput, 'z').defaultPrevented, true);
  await wait(() => noteInput.value === '' && rows.notes[0].body === '', 'undo after autosave also saves');
  shortcut(noteInput, 'y');
  await wait(() => noteInput.value === 'Text to undo', 'Ctrl+Y redo');
  shortcut(noteInput, 'z'); await pause(20);
  shortcut(noteInput, 'z', { shiftKey: true });
  await wait(() => noteInput.value === 'Text to undo', 'Ctrl+Shift+Z redo');
  noteInput.setSelectionRange(0, 4);
  button('B').click();
  await wait(() => noteInput.value.includes('**Text**'), 'formatting edit');
  shortcut(noteInput, 'z');
  await wait(() => noteInput.value === 'Text to undo', 'formatting undo');
  await wait(() => rows.notes[0].body === 'Text to undo', 'formatting undo autosave');
  const searchInput = document.querySelector('input[placeholder="Search Drive"]');
  assert.equal(shortcut(searchInput, 'z').defaultPrevented, false, 'search keeps native editing shortcuts');
  // Switching documents must not apply a different document's history.
  button('New').click();
  await wait(() => button('Sheet'), 'create sheet picker');
  button('Sheet').click();
  await wait(() => rows.files.length && document.querySelector('.bf-drive-tree')?.textContent.includes(rows.files[0].name), 'new sheet appears');
  edit(document.querySelector('input[placeholder="Untitled"]'), 'Renamed.bfsheet');
  await wait(() => document.querySelector('.bf-drive-tree')?.textContent.includes('Renamed.bfsheet'), 'saved sheet updates tree');
  const cell = document.querySelector('.bf-sheet-cellInput');
  edit(cell, '42');
  await wait(() => JSON.parse(rows.files[0].textContent).sheets?.[0]?.cells.A1?.input === '42', 'cell autosave');
  shortcut(cell, 'z');
  await wait(() => cell.value === '', 'cell undo');
  shortcut(cell, 'y');
  await wait(() => cell.value === '42', 'cell redo');
  const formula = document.querySelector('.bf-sheet-formulaInput');
  edit(formula, '=1+2'); await pause(20);
  shortcut(formula, 'z');
  await wait(() => formula.value === '42', 'unblurred formula undo');
  shortcut(formula, 'y');
  await wait(() => formula.value === '=1+2', 'formula redo');
  button('＋ Sheet').click();
  await wait(() => document.querySelectorAll('.bf-sheet-tab').length === 2, 'add sheet');
  shortcut(document.querySelector('.bf-sheet-cellInput'), 'z');
  await wait(() => document.querySelectorAll('.bf-sheet-tab').length === 1, 'undo sheet structure');
  shortcut(document.querySelector('.bf-sheet-cellInput'), 'y');
  await wait(() => document.querySelectorAll('.bf-sheet-tab').length === 2, 'redo sheet structure');
  const noteRow = [...document.querySelectorAll('[data-drive-tree-row]')].find(node => node.textContent.includes('Saved without refreshing'));
  noteRow.querySelector('.bf-drive-treeMain').click();
  await wait(() => document.querySelector('#bf-drive-editor-zone textarea'), 'return to note');
  const reopened = document.querySelector('#bf-drive-editor-zone textarea');
  assert.equal(reopened.value, 'Text to undo');
  shortcut(reopened, 'y');
  await wait(() => reopened.value === '**Text** to undo', 'note redo survives switching and autosave');
  button('New').click(); await wait(() => button('Form'), 'form picker'); button('Form').click();
  await wait(() => document.querySelector('input[placeholder="Form title"]'), 'form editor');
  const formTitle = document.querySelector('input[placeholder="Form title"]');
  const originalFormTitle = formTitle.value;
  edit(formTitle, 'New form heading'); await pause(20);
  shortcut(formTitle, 'z'); await wait(() => formTitle.value === originalFormTitle, 'form undo');
  shortcut(formTitle, 'y'); await wait(() => formTitle.value === 'New form heading', 'form redo');
  assert.equal(win.location.reloadCount || 0, 0);
  console.log('PASS: Drive tree updates; undo/redo for autosaved notes, formatting, cells, formulas, sheet structure and forms; isolated per-document history');
} finally { app.unmount(); await vite.close(); await win.happyDOM.abort(); }
