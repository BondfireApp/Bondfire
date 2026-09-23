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
    const file = { id: 'new-sheet', ...JSON.parse(opts.body) }; rows.files.push(file); return { file };
  }
  if (path.endsWith('/drive/files/new-sheet') && opts.method === 'PATCH') {
    const file = { ...rows.files[0], ...JSON.parse(opts.body) }; rows.files[0] = file; saves++; return { file };
  }
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
function edit(input, value) { const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value').set; setter.call(input, value); input.dispatchEvent(new win.Event('input', { bubbles: true })); }
try {
  app.render(el(HashRouter, null, el(Routes, null, el(Route, { path: '/org/:orgId/drive', element: el(Drive) }))));
  await wait(() => document.querySelector('[data-drive-tree-row]'), 'tree load');
  const folder = [...document.querySelectorAll('[data-drive-tree-row]')].find(node => node.textContent.includes('Closed folder'));
  folder.click();
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
  button('New').click();
  await wait(() => button('Sheet'), 'create sheet picker');
  button('Sheet').click();
  await wait(() => rows.files.length && document.querySelector('.bf-drive-tree')?.textContent.includes(rows.files[0].name), 'new sheet appears');
  edit(document.querySelector('input[placeholder="Untitled"]'), 'Renamed.bfsheet');
  await wait(() => document.querySelector('.bf-drive-tree')?.textContent.includes('Renamed.bfsheet'), 'saved sheet updates tree');
  assert.equal(win.location.reloadCount || 0, 0);
  console.log('PASS: create and edit notes/sheets in a closed folder with a search filter; tree updates without reload');
} finally { app.unmount(); await vite.close(); await win.happyDOM.abort(); }
