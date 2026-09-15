const DEMO_KEY = "bf_demo_state_v1";

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function uid(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function now() {
  return Date.now();
}

function tsPlus(days, hour = 18, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}


function buildDemoStarterSheet() {
  return JSON.stringify({
    type: "bondfire-sheet",
    version: 3,
    sheets: [
      {
        id: "sheet_1",
        name: "Sheet1",
        rowCount: 25,
        columnCount: 8,
        rowHeights: {},
        columnWidths: {},
        cells: {
          A1: { input: "Item" },
          B1: { input: "Qty" },
          C1: { input: "Status" },
          A2: { input: "Water cases" },
          B2: { input: "48" },
          C2: { input: "staged" },
          A3: { input: "Blankets" },
          B3: { input: "26" },
          C3: { input: "sorted" }
        }
      }
    ]
  }, null, 2);
}

function buildDemoStarterForm() {
  return JSON.stringify({
    type: "bondfire-form",
    version: 2,
    title: "Volunteer interest form",
    description: "Quick demo form for incoming volunteers.",
    fields: [
      { id: "field_1", type: "text", label: "Your name", required: true, options: [] },
      { id: "field_2", type: "choice", label: "Preferred shift", required: false, options: ["Morning", "Afternoon", "Evening"] },
      { id: "field_3", type: "paragraph", label: "Anything we should know?", required: false, options: [] }
    ],
    responses: [
      { id: "resp_1", submittedAt: Date.now() - 7200000, values: { field_1: "Rin", field_2: "Morning", field_3: "Can help with setup." } }
    ],
    publicShare: { enabled: false, token: "" }
  }, null, 2);
}

function buildDriveSeed(t) {
  return {
    folders: [
      { id: "df_1", parentId: null, name: "Operations", createdAt: t - 86400000, updatedAt: t - 3600000 },
      { id: "df_2", parentId: null, name: "Outreach", createdAt: t - 86400000, updatedAt: t - 1800000 }
    ],
    notes: [
      { id: "dn_1", parentId: "df_1", title: "distribution checklist", body: "# distribution checklist\n\n- [ ] stage tables\n- [ ] set out water\n- [ ] count blankets", tags: ["ops"], createdAt: t - 86000000, updatedAt: t - 2400000 }
    ],
    files: [
      { id: "dfile_1", parentId: "df_1", name: "supply tracker.bfsheet", mime: "application/vnd.bondfire.sheet+json", size: 0, textContent: buildDemoStarterSheet(), dataUrl: "", createdAt: t - 84000000, updatedAt: t - 1500000 },
      { id: "dfile_2", parentId: "df_2", name: "volunteer form.bfform", mime: "application/vnd.bondfire.form+json", size: 0, textContent: buildDemoStarterForm(), dataUrl: "", createdAt: t - 82000000, updatedAt: t - 1200000 }
    ],
    templates: [
      { id: "dtpl_1", name: "meeting notes", title: "meeting notes", body: "# meeting notes\n\n## agenda\n- [ ] \n\n## discussion\n\n## action items\n- [ ] ", createdAt: t - 81000000, updatedAt: t - 1100000 }
    ]
  };
}

function ensureDriveShape(state) {
  if (!state.drive) state.drive = buildDriveSeed(now());
  state.drive.folders = Array.isArray(state.drive.folders) ? state.drive.folders : [];
  state.drive.notes = Array.isArray(state.drive.notes) ? state.drive.notes : [];
  state.drive.files = Array.isArray(state.drive.files) ? state.drive.files : [];
  state.drive.templates = Array.isArray(state.drive.templates) ? state.drive.templates : [];
  return state.drive;
}

function stripFile(file, includeData = false) {
  const out = {
    id: file.id,
    parentId: file.parentId ?? null,
    name: file.name || "file",
    mime: file.mime || "application/octet-stream",
    size: Number(file.size || 0),
    createdAt: Number(file.createdAt || 0),
    updatedAt: Number(file.updatedAt || 0),
  };
  if (includeData) {
    out.textContent = String(file.textContent || "");
    out.dataUrl = String(file.dataUrl || "");
  }
  return out;
}

function buildSeed() {
  const t = now();
  return {
    org: { id: "demo-org", name: "Rainbridge Mutual Aid", role: "owner", slug: "rainbridge-demo" },
    invites: [
      { code: "DEMOHELP", role: "member", uses: 0, max_uses: 5, expires_at: tsPlus(14), created_at: t - 86400000 },
      { code: "FIELDKIT", role: "member", uses: 1, max_uses: 3, expires_at: tsPlus(7), created_at: t - 43200000 },
    ],
    members: [
      { user_id: "u1", email: "ash@rainbridge.local", role: "owner", name: "Ash Rivera" },
      { user_id: "u2", email: "noe@rainbridge.local", role: "admin", name: "Noe Patel" },
      { user_id: "u3", email: "kit@rainbridge.local", role: "member", name: "Kit Morales" },
      { user_id: "u4", email: "tuna@rainbridge.local", role: "member", name: "Tuna Fisher" },
    ],
    people: [
      { id: "p1", name: "Ash Rivera", role: "Coordinator", phone: "555-0101", skills: "logistics, outreach", notes: "Keeps the distro calendar sane." },
      { id: "p2", name: "Noe Patel", role: "Volunteer Lead", phone: "555-0102", skills: "intake, scheduling", notes: "Handles new volunteers and signups." },
      { id: "p3", name: "Kit Morales", role: "Medic", phone: "555-0103", skills: "triage, harm reduction", notes: "Stocks first aid and wellness kits." },
      { id: "p4", name: "Tuna Fisher", role: "Kitchen", phone: "555-0104", skills: "bulk cooking, inventory", notes: "Runs meal prep and pantry counts." },
    ],
    inventory: [
      { id: "i1", name: "Blankets", qty: 22, unit: "ea", category: "shelter", location: "Closet A", notes: "Winter stock", is_public: true },
      { id: "i2", name: "Canned Beans", qty: 76, unit: "cans", category: "food", location: "Pantry Shelf 2", notes: "Good through summer", is_public: true },
      { id: "i3", name: "First Aid Kits", qty: 7, unit: "kits", category: "medical", location: "Medic bin", notes: "Below par", is_public: false },
      { id: "i4", name: "Bus Passes", qty: 11, unit: "passes", category: "transport", location: "Desk drawer", notes: "Usually go fast", is_public: false },
      { id: "i5", name: "Water Bottles", qty: 92, unit: "bottles", category: "hydration", location: "Back rack", notes: "For outdoor outreach", is_public: true },
    ],
    parMap: { i1: 15, i2: 40, i3: 10, i4: 20, i5: 50 },
    needs: [
      { id: "n1", title: "Winter coats for teens", description: "Need 12 warm coats before Friday outreach.", urgency: "high", priority: 8, status: "open", is_public: true, created_at: t - 172800000 },
      { id: "n2", title: "Rides to clinic appointments", description: "Need three volunteer drivers this week.", urgency: "urgent", priority: 10, status: "open", is_public: true, created_at: t - 86400000 },
      { id: "n3", title: "Shelf stable snacks", description: "Restock snacks for night meetings and youth drop in.", urgency: "medium", priority: 4, status: "open", is_public: false, created_at: t - 28800000 },
      { id: "n4", title: "Zines for know your rights table", description: "Printing help welcome too.", urgency: "low", priority: 2, status: "closed", is_public: true, created_at: t - 604800000 },
    ],
    meetings: [
      { id: "m1", title: "Weekly Coordination", starts_at: tsPlus(1, 18, 30), ends_at: tsPlus(1, 20, 0), location: "Community Center", agenda: "Needs review, distro plan, volunteer handoff", is_public: true, my_rsvp: null },
      { id: "m2", title: "Food Distro Prep", starts_at: tsPlus(3, 17, 0), ends_at: tsPlus(3, 18, 30), location: "Kitchen", agenda: "Pack pantry kits and sort produce", is_public: false, my_rsvp: "yes" },
      { id: "m3", title: "New Volunteer Orientation", starts_at: tsPlus(5, 19, 0), ends_at: tsPlus(5, 20, 0), location: "Zoom", agenda: "Intro to roles, safety, and communication", is_public: true, my_rsvp: null },
    ],
    pledges: [
      { id: "pl1", pledger_name: "Ari", pledger_email: "ari@example.org", type: "supplies", amount: 10, unit: "coats", note: "Can drop off Thursday", status: "offered", need_id: "n1", is_public: true, created_at: t - 6500000 },
      { id: "pl2", pledger_name: "Maya", pledger_email: "maya@example.org", type: "transport", amount: 2, unit: "rides", note: "Available after work", status: "accepted", need_id: "n2", is_public: false, created_at: t - 3500000 },
      { id: "pl3", pledger_name: "Jules", pledger_email: "jules@example.org", type: "food", amount: 30, unit: "snacks", note: "Bringing a case of bars", status: "offered", need_id: "n3", is_public: true, created_at: t - 1900000 },
    ],
    newsletter: { enabled: true, list_address: "rainbridge-news@lists.riseup.net", blurb: "Monthly mutual aid updates, distro dates, and urgent asks." },
    subscribers: [
      { id: "s1", email: "demo1@example.org", created_at: t - 8200000 },
      { id: "s2", email: "demo2@example.org", created_at: t - 4200000 },
      { id: "s3", email: "demo3@example.org", created_at: t - 2200000 },
      { id: "s4", email: "demo4@example.org", created_at: t - 1200000 },
    ],
    publicConfig: {
      enabled: true,
      newsletter_enabled: true,
      pledges_enabled: true,
      show_action_strip: true,
      show_needs: true,
      show_meetings: true,
      show_what_we_do: true,
      show_get_involved: true,
      show_newsletter_card: true,
      show_website_button: false,
      slug: "rainbridge-demo",
      title: "Rainbridge Mutual Aid",
      location_line: "Aberdeen, WA",
      about: "A neighborhood mutual aid network sharing food, rides, supplies, and coordination.",
      accent_color: "#6d5efc",
      theme_mode: "light",
      website_label: "Website",
      website_url: "",
      meeting_rsvp_url: "",
      what_we_do: "food distro\nride coordination\nharm reduction\ncommunity defense",
      primary_actions: [
        { label: "Get Help", url: "modal:get_help" },
        { label: "Offer Help", url: "modal:offer_resources" },
        { label: "Stay Connected", url: "#newsletter" },
      ],
      get_involved_links: [
        { label: "Volunteer", url: "modal:volunteer" },
        { label: "Donate Funds", url: "https://example.org/donate" },
        { label: "Offer Resources", url: "modal:offer_resources" },
        { label: "Request Assistance", url: "modal:get_help" },
      ],
    },
    drive: buildDriveSeed(t),
    publicInbox: [
      { id: "pi1", type: "intake", kind: "get_help", name: "Sam", contact: "sam@example.org", details: "Need diapers and pantry staples.", status: "new", review_status: "new", created_at: t - 6200000 },
      { id: "pi2", type: "intake", kind: "offer_resources", name: "Jules", contact: "jules@example.org", details: "Can donate blankets and socks.", status: "new", review_status: "reviewed", created_at: t - 4200000 },
      { id: "pi3", type: "rsvp", kind: "volunteer", name: "Rin", contact: "555-4444", details: "Available Saturdays for setup.", status: "new", review_status: "new", created_at: t - 1800000 },
    ],
  };
}

export function readDemoState() {
  try {
    const raw = localStorage.getItem(DEMO_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  const seed = buildSeed();
  writeDemoState(seed);
  return seed;
}

export function writeDemoState(state) {
  try { localStorage.setItem(DEMO_KEY, JSON.stringify(state)); } catch {}
}

export function ensureDemoOrgList() {
  const state = readDemoState();
  try { localStorage.setItem("bf_orgs", JSON.stringify([state.org])); } catch {}
  try { localStorage.setItem(`bf_inv_par_${state.org.id}`, JSON.stringify(state.parMap || {})); } catch {}
  try { localStorage.setItem(`bf_org_settings_${state.org.id}`, JSON.stringify({ name: state.org.name })); } catch {}
  return state.org;
}

export function resetDemoState() {
  const seed = buildSeed();
  writeDemoState(seed);
  ensureDemoOrgList();
  return seed;
}

function parseBody(body) {
  if (!body) return {};
  if (typeof body === "string") {
    try { return JSON.parse(body); } catch { return {}; }
  }
  return body;
}

function removeById(rows, id, key = "id") {
  return rows.filter((x) => String(x?.[key]) !== String(id));
}

function upsert(rows, patch, key = "id") {
  const idx = rows.findIndex((x) => String(x?.[key]) === String(patch?.[key]));
  if (idx === -1) return [patch, ...rows];
  const next = rows.slice();
  next[idx] = { ...next[idx], ...patch };
  return next;
}

function dashboard(state) {
  const needsOpen = (state.needs || []).filter((n) => String(n?.status || "").toLowerCase() === "open");
  const upcoming = (state.meetings || []).filter((m) => Number(m?.starts_at || 0) > Date.now() - 86400000);
  return {
    counts: {
      people: state.people.length,
      inventory: state.inventory.length,
      needsOpen: needsOpen.length,
      meetingsUpcoming: upcoming.length,
      pledgesActive: state.pledges.length,
      publicInbox: state.publicInbox.length,
      subscribers: state.subscribers.length,
      subsTotal: state.subscribers.length,
    },
    people: clone(state.people),
    inventory: clone(state.inventory),
    needs: clone(state.needs),
    meetings: clone(state.meetings),
  };
}

function makeCsv(rows) {
  const lines = ['"email","created_at"'];
  for (const r of rows) {
    lines.push([String(r.email || ""), String(r.created_at || "")].map((v) => `"${v.replace(/"/g, '""')}"`).join(","));
  }
  return lines.join("\n");
}

export function getDemoSubscribersCsv() {
  return makeCsv(readDemoState().subscribers || []);
}

export function demoHandle(path, opts = {}) {
  const method = String(opts.method || "GET").toUpperCase();
  const url = new URL(path, "https://demo.local");
  const parts = url.pathname.split("/").filter(Boolean);
  const body = parseBody(opts.body);
  const state = readDemoState();

  if (url.pathname === "/api/orgs") {
    if (method === "GET") return { ok: true, orgs: [clone(state.org)] };
  }
  if (url.pathname === "/api/orgs/create") return { ok: true, org: clone(state.org) };
  if (url.pathname === "/api/invites/redeem") return { ok: true, org: clone(state.org) };

  if (parts[0] !== "api" || parts[1] !== "orgs") return null;
  const orgId = decodeURIComponent(parts[2] || "");
  if (orgId !== state.org.id) return { ok: false, error: "Demo org not found" };
  if (parts.length === 3 && method === "DELETE") return { ok: true };
  if (parts[3] === "dashboard" && method === "GET") return dashboard(state);

  if (parts[3] === "people") {
    if (method === "GET") return { ok: true, people: clone(state.people) };
    if (method === "POST") { const row = { id: uid("p"), ...body }; state.people = [row, ...state.people]; writeDemoState(state); return { ok: true, id: row.id, person: clone(row) }; }
    if (method === "PUT") { state.people = upsert(state.people, body); writeDemoState(state); return { ok: true }; }
    if (method === "DELETE") { const id = url.searchParams.get("id") || body.id; state.people = removeById(state.people, id); writeDemoState(state); return { ok: true }; }
  }

  if (parts[3] === "inventory") {
    if (method === "GET") return { ok: true, items: clone(state.inventory) };
    if (method === "POST") { const row = { id: uid("i"), qty: 0, ...body }; state.inventory = [row, ...state.inventory]; writeDemoState(state); return { ok: true, item: clone(row), id: row.id }; }
    if (method === "PUT") { state.inventory = upsert(state.inventory, body); writeDemoState(state); return { ok: true }; }
    if (method === "DELETE") { const id = url.searchParams.get("id") || body.id; state.inventory = removeById(state.inventory, id); writeDemoState(state); return { ok: true }; }
  }

  if (parts[3] === "needs") {
    if (method === "GET") return { ok: true, needs: clone(state.needs) };
    if (method === "POST") { const row = { id: uid("n"), status: "open", created_at: now(), ...body }; state.needs = [row, ...state.needs]; writeDemoState(state); return { ok: true, need: clone(row), id: row.id }; }
    if (method === "PUT") { state.needs = upsert(state.needs, body); writeDemoState(state); return { ok: true }; }
    if (method === "DELETE") { const id = url.searchParams.get("id") || body.id; state.needs = removeById(state.needs, id); writeDemoState(state); return { ok: true }; }
  }

  if (parts[3] === "meetings" && parts[5] === "rsvp") {
    const meetingId = decodeURIComponent(parts[4] || "");
    const idx = state.meetings.findIndex((m) => String(m.id) === String(meetingId));
    if (idx === -1) return { ok: false, error: "Meeting not found" };
    if (method === "GET") return { ok: true, my_rsvp: state.meetings[idx].my_rsvp ? { status: state.meetings[idx].my_rsvp } : null };
    if (method === "POST") { state.meetings[idx] = { ...state.meetings[idx], my_rsvp: String(body.status || "yes") }; writeDemoState(state); return { ok: true, my_rsvp: { status: state.meetings[idx].my_rsvp } }; }
  }

  if (parts[3] === "meetings" && parts[4] && method === "GET") {
    const meeting = state.meetings.find((m) => String(m.id) === String(parts[4]));
    if (!meeting) return { ok: false, error: "Meeting not found" };
    return { ok: true, meeting: { ...clone(meeting), rsvp_counts: { member: { yes: 2, maybe: 1, no: 0, total: 3 }, public: { yes: 1, maybe: 0, no: 0, total: 1 }, combined: { yes: 3, maybe: 1, no: 0, total: 4 } } } };
  }

  if (parts[3] === "meetings") {
    if (method === "GET") return { ok: true, meetings: clone(state.meetings) };
    if (method === "POST") { const row = { id: uid("m"), created_at: now(), ...body }; state.meetings = [row, ...state.meetings]; writeDemoState(state); return { ok: true, meeting: clone(row), id: row.id }; }
    if (method === "PUT") { state.meetings = upsert(state.meetings, body); writeDemoState(state); return { ok: true }; }
    if (method === "DELETE") { const id = url.searchParams.get("id") || body.id; state.meetings = removeById(state.meetings, id); writeDemoState(state); return { ok: true }; }
  }

  if (parts[3] === "pledges") {
    if (method === "GET") return { ok: true, pledges: clone(state.pledges) };
    if (method === "POST") { const row = { id: uid("pl"), created_at: now(), ...body }; state.pledges = [row, ...state.pledges]; writeDemoState(state); return { ok: true, pledge: clone(row), id: row.id }; }
    if (method === "PUT") { state.pledges = upsert(state.pledges, body); writeDemoState(state); return { ok: true }; }
    if (method === "DELETE") { const id = url.searchParams.get("id") || body.id; state.pledges = removeById(state.pledges, id); writeDemoState(state); return { ok: true }; }
  }

  if (parts[3] === "drive") {
    const drive = ensureDriveShape(state);
    const drivePart = parts[4] || "";
    const driveId = decodeURIComponent(parts[5] || "");

    if (!drivePart && method === "GET") {
      return { ok: true, folders: clone(drive.folders), notes: clone(drive.notes), files: drive.files.map((f) => stripFile(f, false)), templates: clone(drive.templates) };
    }
    if (drivePart === "import" && method === "POST") {
      if (Array.isArray(body.folders)) drive.folders = clone(body.folders);
      if (Array.isArray(body.notes)) drive.notes = clone(body.notes);
      if (Array.isArray(body.files)) drive.files = clone(body.files);
      if (Array.isArray(body.templates)) drive.templates = clone(body.templates);
      writeDemoState(state);
      return { ok: true };
    }
    if (drivePart === "folders") {
      if (method === "GET") return { ok: true, folders: clone(drive.folders) };
      if (method === "POST") { const t = now(); const row = { id: uid("df"), parentId: body.parentId ?? null, name: String(body.name || "untitled folder"), createdAt: t, updatedAt: t }; drive.folders = [...drive.folders, row]; writeDemoState(state); return { ok: true, folder: clone(row) }; }
      if (driveId && method === "PATCH") { const idx = drive.folders.findIndex((f) => String(f.id) === String(driveId)); if (idx === -1) return { ok: false, error: "NOT_FOUND" }; drive.folders[idx] = { ...drive.folders[idx], ...(Object.prototype.hasOwnProperty.call(body, "parentId") ? { parentId: body.parentId ?? null } : {}), ...(body.name !== undefined ? { name: String(body.name || "untitled folder") } : {}), updatedAt: now() }; writeDemoState(state); return { ok: true, folder: clone(drive.folders[idx]) }; }
      if (driveId && method === "DELETE") { const folder = drive.folders.find((f) => String(f.id) === String(driveId)); if (!folder) return { ok: false, error: "NOT_FOUND" }; const parent = folder.parentId ?? null; drive.folders = drive.folders.filter((f) => String(f.id) !== String(driveId)); drive.notes = drive.notes.map((n) => String(n.parentId) === String(driveId) ? { ...n, parentId: parent, updatedAt: now() } : n); drive.files = drive.files.map((f) => String(f.parentId) === String(driveId) ? { ...f, parentId: parent, updatedAt: now() } : f); writeDemoState(state); return { ok: true, deleted: true, id: driveId }; }
    }
    if (drivePart === "notes") {
      if (method === "GET") return { ok: true, notes: clone(drive.notes) };
      if (method === "POST") { const t = now(); const row = { id: uid("dn"), parentId: body.parentId ?? null, title: String(body.title || "untitled"), body: String(body.body || body.content || ""), tags: Array.isArray(body.tags) ? body.tags : [], createdAt: t, updatedAt: t }; drive.notes = [row, ...drive.notes]; writeDemoState(state); return { ok: true, note: clone(row) }; }
      if (driveId && method === "GET") { const row = drive.notes.find((n) => String(n.id) === String(driveId)); return row ? { ok: true, note: clone(row) } : { ok: false, error: "NOT_FOUND" }; }
      if (driveId && method === "PATCH") { const idx = drive.notes.findIndex((n) => String(n.id) === String(driveId)); if (idx === -1) return { ok: false, error: "NOT_FOUND" }; drive.notes[idx] = { ...drive.notes[idx], ...(Object.prototype.hasOwnProperty.call(body, "parentId") ? { parentId: body.parentId ?? null } : {}), ...(body.title !== undefined ? { title: String(body.title || "untitled") } : {}), ...(body.body !== undefined || body.content !== undefined ? { body: String(body.body ?? body.content ?? "") } : {}), ...(body.tags !== undefined ? { tags: Array.isArray(body.tags) ? body.tags : [] } : {}), updatedAt: now() }; writeDemoState(state); return { ok: true, note: clone(drive.notes[idx]) }; }
      if (driveId && method === "DELETE") { drive.notes = drive.notes.filter((n) => String(n.id) !== String(driveId)); writeDemoState(state); return { ok: true, deleted: true, id: driveId }; }
    }
    if (drivePart === "files") {
      if (method === "GET") return { ok: true, files: drive.files.map((f) => stripFile(f, false)) };
      if (method === "POST") { const t = now(); const textContent = String(body.textContent || ""); const dataUrl = String(body.dataUrl || ""); const mime = String(body.mime || "application/octet-stream"); const row = { id: uid("dfile"), parentId: body.parentId ?? null, name: String(body.name || "file"), mime, size: Number(body.size || dataUrl.length || textContent.length || 0), textContent, dataUrl, createdAt: t, updatedAt: t }; drive.files = [row, ...drive.files]; writeDemoState(state); return { ok: true, file: stripFile(row, false) }; }
      if (driveId && method === "GET") { const row = drive.files.find((f) => String(f.id) === String(driveId)); return row ? { ok: true, file: stripFile(row, true) } : { ok: false, error: "NOT_FOUND" }; }
      if (driveId && method === "PATCH") { const idx = drive.files.findIndex((f) => String(f.id) === String(driveId)); if (idx === -1) return { ok: false, error: "NOT_FOUND" }; const existing = drive.files[idx]; const next = { ...existing, ...(Object.prototype.hasOwnProperty.call(body, "parentId") ? { parentId: body.parentId ?? null } : {}), ...(body.name !== undefined ? { name: String(body.name || "file") } : {}), ...(body.mime !== undefined ? { mime: String(body.mime || existing.mime || "application/octet-stream") } : {}), ...(body.textContent !== undefined ? { textContent: String(body.textContent || "") } : {}), ...(body.dataUrl !== undefined ? { dataUrl: String(body.dataUrl || "") } : {}), ...(body.size !== undefined ? { size: Number(body.size || 0) } : {}), updatedAt: now() }; drive.files[idx] = next; writeDemoState(state); return { ok: true, file: stripFile(next, true) }; }
      if (driveId && method === "DELETE") { drive.files = drive.files.filter((f) => String(f.id) !== String(driveId)); writeDemoState(state); return { ok: true, deleted: true, id: driveId }; }
    }
    if (drivePart === "templates") {
      if (method === "GET") return { ok: true, templates: clone(drive.templates) };
      if (method === "POST") { const t = now(); const row = { id: uid("dtpl"), name: String(body.name || "template"), title: String(body.title || "untitled"), body: String(body.body || body.content || ""), createdAt: t, updatedAt: t }; drive.templates = [row, ...drive.templates]; writeDemoState(state); return { ok: true, template: clone(row) }; }
      if (driveId && method === "PATCH") { const idx = drive.templates.findIndex((n) => String(n.id) === String(driveId)); if (idx === -1) return { ok: false, error: "NOT_FOUND" }; drive.templates[idx] = { ...drive.templates[idx], ...(body.name !== undefined ? { name: String(body.name || "template") } : {}), ...(body.title !== undefined ? { title: String(body.title || "untitled") } : {}), ...(body.body !== undefined || body.content !== undefined ? { body: String(body.body ?? body.content ?? "") } : {}), updatedAt: now() }; writeDemoState(state); return { ok: true, template: clone(drive.templates[idx]) }; }
      if (driveId && method === "DELETE") { drive.templates = drive.templates.filter((n) => String(n.id) !== String(driveId)); writeDemoState(state); return { ok: true, deleted: true, id: driveId }; }
    }
  }

  if (parts[3] === "newsletter") {
    if (parts[4] === "subscribers" && method === "GET") return { ok: true, subscribers: clone(state.subscribers) };
    if (method === "GET") return { ok: true, newsletter: clone(state.newsletter) };
    if (method === "PUT") { state.newsletter = { ...state.newsletter, ...body }; writeDemoState(state); return { ok: true }; }
  }

  if (parts[3] === "public") {
    if (parts[4] === "get" && method === "GET") return { ok: true, public_page: clone(state.publicConfig) };
    if (parts[4] === "save" && method === "POST") { state.publicConfig = { ...state.publicConfig, ...body }; writeDemoState(state); return { ok: true, public_page: clone(state.publicConfig) }; }
    if (parts[4] === "inbox") {
      if (method === "GET") return { ok: true, items: clone(state.publicInbox) };
      if (method === "PUT") { state.publicInbox = upsert(state.publicInbox, body); writeDemoState(state); return { ok: true }; }
    }
  }

  if (parts[3] === "invites") {
    if (method === "GET") return { ok: true, invites: clone(state.invites) };
    if (method === "POST") { const invite = { code: uid("INV").replace("_", "").toUpperCase(), role: body.role || "member", uses: 0, max_uses: body.maxUses || 1, expires_at: tsPlus(body.expiresInDays || 14), created_at: now() }; state.invites = [invite, ...state.invites]; writeDemoState(state); return { ok: true, invite }; }
    if (method === "DELETE") { const code = String(body.code || "").trim().toUpperCase(); state.invites = state.invites.filter((x) => String(x.code || "").trim().toUpperCase() !== code); writeDemoState(state); return { ok: true }; }
  }

  if (parts[3] === "members") {
    if (method === "GET") return { ok: true, members: clone(state.members) };
    if (method === "PUT") { const userId = body.userId || body.user_id; state.members = state.members.map((m) => String(m.user_id) === String(userId) ? { ...m, role: body.role || m.role } : m); writeDemoState(state); return { ok: true }; }
    if (method === "DELETE") { const userId = body.userId || body.user_id; state.members = state.members.filter((m) => String(m.user_id) !== String(userId)); writeDemoState(state); return { ok: true }; }
  }

  return null;
}
