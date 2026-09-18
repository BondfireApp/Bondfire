import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/pages/Drive.jsx', import.meta.url), 'utf8');
const sidebar = fs.readFileSync(new URL('../src/components/drive/DriveSidebar.jsx', import.meta.url), 'utf8');

assert.doesNotMatch(source, /STARTER_TEMPLATES/);
assert.doesNotMatch(source, /LEGACY_STORAGE_KEY/);
assert.doesNotMatch(source, /bf_drive_imported_/);
assert.doesNotMatch(source, /bf_drive_v14/);
assert.doesNotMatch(source, /weekly relationship accountability check-in/i);
assert.match(source, /const nextTemplates = Array\.isArray\(data\?\.templates\) \? data\.templates : \[\];/);

assert.match(sidebar, /\+ New Template/);
assert.match(sidebar, /function openTemplateEditor\(/);
assert.match(sidebar, /onClick=\{\(\) => openTemplateEditor\(tpl\)\}/);
assert.match(sidebar, /Insert into current note/);
assert.match(sidebar, /New note from template/);
assert.doesNotMatch(sidebar, /onClick=\{\(\) => onApplyTemplate\?\.\(tpl\)\}/);

console.log('PASS: Drive starts empty and templates are explicitly created, edited, and applied');
