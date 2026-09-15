// src/utils/store.js
import { useSyncExternalStore } from "react";

// ---------- persistence ----------
const LS_KEY = "bf_store";

function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    // basic shape guard
    return {
      people: Array.isArray(obj.people) ? obj.people : [],
      inventory: Array.isArray(obj.inventory) ? obj.inventory : [],
      needs: Array.isArray(obj.needs) ? obj.needs : [],
      meetings: Array.isArray(obj.meetings) ? obj.meetings : [],
    };
  } catch {
    return null;
  }
}

function save(state) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch {}
}

// ---------- store core (no external libs) ----------
let _state =
  load() || { people: [], inventory: [], needs: [], meetings: [] };

const listeners = new Set();

function getState() {
  return _state;
}

function setState(patchOrUpdater) {
  const next =
    typeof patchOrUpdater === "function"
      ? patchOrUpdater(_state)
      : { ..._state, ...patchOrUpdater };

  // if updater returned full state, accept it; else merge
  _state = Array.isArray(next.people) ||
    Array.isArray(next.inventory) ||
    Array.isArray(next.needs) ||
    Array.isArray(next.meetings)
    ? next
    : { ..._state, ...next };

  save(_state);
  listeners.forEach((fn) => fn());
  return _state;
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// React hook
function useStore(selector = (s) => s) {
  return useSyncExternalStore(
    subscribe,
    () => selector(getState()),
    () => selector(getState())
  );
}

// ---------- helpers ----------
const ensureId = (obj) => obj.id ?? crypto.randomUUID();

// Inventory
function addItem(item) {
  const it = { id: ensureId(item), ...item };
  setState((s) => ({ ...s, inventory: [...s.inventory, it] }));
}
function updateItem(id, patch) {
  setState((s) => ({
    ...s,
    inventory: s.inventory.map((x) => (x.id === id ? { ...x, ...patch } : x)),
  }));
}
function deleteItem(id) {
  setState((s) => ({
    ...s,
    inventory: s.inventory.filter((x) => x.id !== id),
  }));
}

// People
function addPerson(person) {
  const p = { id: ensureId(person), ...person };
  setState((s) => ({ ...s, people: [...s.people, p] }));
}
function updatePerson(id, patch) {
  setState((s) => ({
    ...s,
    people: s.people.map((x) => (x.id === id ? { ...x, ...patch } : x)),
  }));
}
function deletePerson(id) {
  setState((s) => ({ ...s, people: s.people.filter((x) => x.id !== id) }));
}

// Needs
function addNeed(need) {
  const n = {
    id: ensureId(need),
    created: need.created ?? Date.now(),
    status: need.status ?? "open",
    ...need,
  };
  setState((s) => ({ ...s, needs: [...s.needs, n] }));
}
function updateNeed(id, patch) {
  setState((s) => ({
    ...s,
    needs: s.needs.map((x) => (x.id === id ? { ...x, ...patch } : x)),
  }));
}
function deleteNeed(id) {
  setState((s) => ({ ...s, needs: s.needs.filter((x) => x.id !== id) }));
}

// Meetings
function addMeeting(meeting) {
  const m = {
    id: ensureId(meeting),
    when: meeting.when ?? "",
    notes: meeting.notes ?? "",
    files: Array.isArray(meeting.files) ? meeting.files : [],
    ...meeting,
  };
  setState((s) => ({ ...s, meetings: [...s.meetings, m] }));
}
function updateMeeting(id, patch) {
  setState((s) => ({
    ...s,
    meetings: s.meetings.map((x) => (x.id === id ? { ...x, ...patch } : x)),
  }));
}
function deleteMeeting(id) {
  setState((s) => ({
    ...s,
    meetings: s.meetings.filter((x) => x.id !== id),
  }));
}
function addMeetingFile(meetingId, fileObj) {
  setState((s) => ({
    ...s,
    meetings: s.meetings.map((m) =>
      m.id === meetingId
        ? { ...m, files: [...(m.files || []), { id: ensureId(fileObj), ...fileObj }] }
        : m
    ),
  }));
}
function deleteMeetingFile(meetingId, fileId) {
  setState((s) => ({
    ...s,
    meetings: s.meetings.map((m) =>
      m.id === meetingId
        ? { ...m, files: (m.files || []).filter((f) => f.id !== fileId) }
        : m
    ),
  }));
}

// ---------- single export block (no duplicates) ----------
export {
  // hook
  useStore,

  // inventory
  addItem,
  updateItem,
  deleteItem,

  // people
  addPerson,
  updatePerson,
  deletePerson,
  // needs
  addNeed,
  updateNeed,
  deleteNeed,
  // meetings
  addMeeting,
  updateMeeting,
  deleteMeeting,
  addMeetingFile,
  deleteMeetingFile,
  // low-level (optional)
  getState,
  setState,
};
