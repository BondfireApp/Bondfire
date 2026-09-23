const same = (a, b) => a?.title === b?.title && a?.content === b?.content;
const size = value => 2 * (value.title.length + value.content.length);

// Session-only history: neither saving nor reselecting a document is an edit.
export function createDriveHistory({ limit = 100, maxBytes = 20 * 1024 * 1024 } = {}) {
  const documents = new Map();
  function get(key, current) {
    let history = documents.get(key);
    if (!history || !same(history.present, current)) {
      history = { past: [], present: current, future: [], group: null, time: 0 };
      documents.set(key, history);
    }
    documents.delete(key);
    documents.set(key, history);
    while (documents.size > 20) documents.delete(documents.keys().next().value);
    return history;
  }
  function trim() {
    for (const history of documents.values()) {
      while (history.past.length > limit) history.past.shift();
    }
    let bytes = [...documents.values()].reduce((total, h) => total + [...h.past, h.present, ...h.future].reduce((n, value) => n + size(value), 0), 0);
    for (const [key, history] of documents) {
      while (bytes > maxBytes && history.past.length) bytes -= size(history.past.shift());
      while (bytes > maxBytes && history.future.length) bytes -= size(history.future.shift());
      if (bytes > maxBytes && documents.size > 1) { bytes -= size(history.present); documents.delete(key); }
    }
  }
  return {
    record(key, current, next, group = null, now = Date.now()) {
      const history = get(key, current);
      if (same(current, next)) return;
      if (!group || history.group !== group || now - history.time > 750 || history.future.length) history.past.push(current);
      history.present = next;
      history.future = [];
      history.group = group;
      history.time = now;
      trim();
    },
    move(key, current, direction) {
      const history = get(key, current);
      const from = direction === 'undo' ? history.past : history.future;
      const to = direction === 'undo' ? history.future : history.past;
      if (!from.length) return null;
      to.push(history.present);
      history.present = from.pop();
      history.group = null;
      return history.present;
    },
  };
}

export function driveHistoryShortcut(event) {
  if (event.defaultPrevented || event.isComposing || event.altKey || !(event.ctrlKey || event.metaKey)) return null;
  const key = String(event.key || '').toLowerCase();
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  return key === 'y' ? 'redo' : null;
}
