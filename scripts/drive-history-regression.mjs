import assert from 'node:assert/strict';
import { createDriveHistory, driveHistoryShortcut } from '../src/lib/driveHistory.js';

const state = content => ({ title: 'Document', content });
const history = createDriveHistory();
history.record('org:note:a', state(''), state('a'), 'typing', 0);
history.record('org:note:a', state('a'), state('ab'), 'typing', 100);
assert.deepEqual(history.move('org:note:a', state('ab'), 'undo'), state(''), 'continuous typing is one step');
assert.deepEqual(history.move('org:note:a', state(''), 'redo'), state('ab'));
history.record('org:note:a', state('ab'), state('**ab**'), null, 150);
assert.deepEqual(history.move('org:note:a', state('**ab**'), 'undo'), state('ab'), 'formatting is separate from typing');
assert.equal(history.move('other-org:note:a', state('ab'), 'undo'), null, 'org history is isolated');
assert.equal(history.move('org:file:a', state('ab'), 'undo'), null, 'file and note history are isolated');
assert.deepEqual(history.move('org:note:a', state('ab'), 'redo'), state('**ab**'), 'switching documents preserves history');
history.move('org:note:a', state('**ab**'), 'undo');
history.record('org:note:a', state('ab'), state('new edit'));
assert.equal(history.move('org:note:a', state('new edit'), 'redo'), null, 'new edit clears redo');
assert.equal(history.move('org:note:a', state('external update'), 'undo'), null, 'external replacement invalidates old history');
const small = createDriveHistory({ limit: 2 });
for (let i = 0; i < 5; i++) small.record('a', state(String(i)), state(String(i + 1)));
assert.deepEqual(small.move('a', state('5'), 'undo'), state('4'));
assert.deepEqual(small.move('a', state('4'), 'undo'), state('3'));
assert.equal(small.move('a', state('3'), 'undo'), null, 'history is bounded');
for (const modifier of ['ctrlKey', 'metaKey']) {
  assert.equal(driveHistoryShortcut({ key: 'z', [modifier]: true }), 'undo');
  assert.equal(driveHistoryShortcut({ key: 'y', [modifier]: true }), 'redo');
  assert.equal(driveHistoryShortcut({ key: 'Z', shiftKey: true, [modifier]: true }), 'redo');
}
assert.equal(driveHistoryShortcut({ key: 'z', ctrlKey: true, isComposing: true }), null);
assert.equal(driveHistoryShortcut({ key: 'z', ctrlKey: true, defaultPrevented: true }), null);
console.log('PASS: Drive typing groups, separate formatting, isolated bounded history, redo invalidation, and keyboard modifiers');
