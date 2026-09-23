/**
 * Bondfire V3 module registry.
 *
 * Core is always present. The selectable modules below are the canonical
 * initial Bondfire slate. The on-deck list is deliberately separate: those
 * ideas are visible as future work, but cannot be selected or silently appear
 * in a build until they have a real surface behind them.
 */

const CORE_MODULE_IDS = Object.freeze(["public-site"]);

const CORE_MODULES = [
  {
    id: "public-site",
    label: "Public site",
    name: "Public page",
    mark: "PB",
    description: "Choose what the outside world can see while the private room stays private.",
    routeBase: "public",
    tier: "core",
    available: true,
    builderVisible: false,
    defaultEnabled: true,
  },
];

const LIVE_MODULES = [
  {'id': 'tasks', 'label': 'Tasks', 'name': 'Tasks', 'mark': 'TA', 'description': 'Track assignments, due dates, checklists and follow-through.', 'routeBase': 'tasks', 'tier': 'live', 'available': true, 'defaultEnabled': false},
  {'id': 'working-groups', 'label': 'Working Groups', 'name': 'Working Groups', 'mark': 'WG', 'description': 'Connect the work of subgroups within this organization.', 'routeBase': 'working-groups', 'tier': 'live', 'available': true, 'defaultEnabled': false},
  {'id': 'decisions', 'label': 'Decisions', 'name': 'Decisions', 'mark': 'DE', 'description': 'Record decisions, their process and implementation.', 'routeBase': 'decisions', 'tier': 'live', 'available': true, 'defaultEnabled': false},
  {'id': 'cases', 'label': 'Cases', 'name': 'Cases', 'mark': 'CA', 'description': 'Follow through on selected requests from Public Inbox.', 'routeBase': 'cases', 'tier': 'live', 'available': true, 'defaultEnabled': false},
  {'id': 'treasury', 'label': 'Treasury', 'name': 'Treasury', 'mark': 'TR', 'description': 'Manage collective funds, spending and optional public transparency.', 'routeBase': 'treasury', 'tier': 'live', 'available': true, 'defaultEnabled': false},
  {
    id: "people",
    label: "People",
    name: "People directory",
    mark: "PE",
    description: "Keep the organization’s real-world roster close. People can be listed here without creating a Bondfire account.",
    routeBase: "people",
    tier: "live",
    available: true,
    defaultEnabled: true,
  },
  {
    id: "newsletter",
    label: "Newsletter",
    name: "Newsletter",
    mark: "NL",
    description: "Manage website signups, sender details, and newsletter delivery for this organization.",
    routeBase: "settings?tab=newsletter",
    tier: "live",
    available: true,
    defaultEnabled: true,
  },
  {
    id: "needs",
    label: "Needs",
    name: "Needs",
    mark: "ND",
    description: "Turn requests into visible work without losing the context, care, or follow-through around them.",
    routeBase: "needs",
    tier: "live",
    available: true,
    defaultEnabled: true,
  },
  {
    id: "pledges",
    label: "Pledges",
    name: "Pledges",
    mark: "PL",
    description: "Track concrete offers of time, money, supplies, rides, and other forms of support.",
    routeBase: "pledges",
    tier: "live",
    available: true,
    defaultEnabled: true,
  },
  {
    id: "inventory",
    label: "Inventory",
    name: "Inventory",
    mark: "IV",
    description: "Know what is on hand, what is moving, and what the collective can share right now.",
    routeBase: "inventory",
    tier: "live",
    available: true,
    defaultEnabled: true,
  },
  {
    id: "meetings",
    label: "Meetings",
    name: "Meetings",
    mark: "MT",
    description: "Give decisions a home and let the group keep its own cadence instead of chasing productivity theater.",
    routeBase: "meetings",
    tier: "live",
    available: true,
    defaultEnabled: true,
  },
  {
    id: "drive",
    label: "Drive",
    name: "Drive / documents",
    mark: "DR",
    description: "Keep working documents, notes, templates, forms, and files somewhere the whole crew can find them.",
    routeBase: "drive",
    tier: "live",
    available: true,
    defaultEnabled: true,
  },
  {
    id: "events",
    label: "Events",
    name: "Events",
    mark: "EV",
    description: "Coordinate public moments, gatherings, and the details that make showing up possible.",
    routeBase: "events",
    tier: "live",
    available: true,
    defaultEnabled: true,
  },
  {
    id: "witness-archive",
    label: "REC",
    name: "REC",
    mark: "RC",
    description: "Capture encrypted video and preserve recordings off-device for later retrieval.",
    routeBase: "witness",
    tier: "live",
    available: true,
    defaultEnabled: true,
  },
  {
    id: "bondfire-chat",
    label: "FireChat",
    name: "FireChat",
    mark: "FC",
    description: "Keep the quick talk close to the work, in a room that belongs to the organization.",
    routeBase: "chat",
    tier: "live",
    available: true,
    defaultEnabled: true,
  },
  {
    id: "intake",
    label: "Intake",
    name: "Public intake",
    mark: "IT",
    description: "Receive requests, offers, volunteer interest, and meeting responses through the public front door.",
    routeBase: "intake",
    tier: "live",
    available: true,
    defaultEnabled: true,
  },
  {
    id: "studio",
    label: "Studio",
    name: "Studio",
    mark: "ST",
    description: "Make the public-facing pieces without handing the voice of the work to a growth funnel.",
    routeBase: "studio",
    tier: "live",
    available: true,
    defaultEnabled: true,
  },
  {
    id: "publishing-colophon",
    label: "Colophon",
    name: "Colophon publishing",
    mark: "CO",
    description: "Run the full Colophon publishing workspace inside the current Bondfire organization.",
    routeBase: "colophon",
    tier: "live",
    available: true,
    defaultEnabled: true,
    status: "available-native",
    featureFlag: "platform.colophon_native",
    enabledByDefault: true,
    getRoutes: () => [
      { path: "colophon/*", kind: "colophon-native", moduleId: "publishing-colophon" },
    ],
  },
];

const LEGACY_MODULES = [
  {
    id: "module-chat",
    label: "Module chat",
    name: "Module chat",
    mark: "MC",
    description: "Legacy focused conversation surface retained for existing organizations.",
    routeBase: "chat-module",
    tier: "legacy",
    available: true,
    builderVisible: false,
    defaultEnabled: false,
    status: "legacy",
  },
];

const ON_DECK_MODULES = [
  {
    id: "mutual-aid",
    label: "Mutual aid",
    name: "Mutual aid board",
    mark: "MA",
    description: "Match needs, offers, and practical support without turning solidarity into a marketplace.",
    tier: "on-deck",
    available: false,
    defaultEnabled: false,
    status: "planned",
  },
  {
    id: "feedback",
    label: "Feedback",
    name: "Feedback loops",
    mark: "FB",
    description: "Make room for reflection, consent, and repair as part of the work itself.",
    tier: "on-deck",
    available: false,
    defaultEnabled: false,
    status: "planned",
  },
  {
    id: "campaign-coordination",
    label: "Campaigns",
    name: "Campaign coordination",
    mark: "CA",
    description: "Bring a campaign from intention to action with shared tasks, signals, and accountability.",
    tier: "on-deck",
    available: false,
    defaultEnabled: false,
    status: "planned",
  },
  {
    id: "org-ops-lab",
    label: "Operations Lab",
    name: "Operations Lab",
    mark: "OP",
    description: "A future space for deeper operational views and collective infrastructure experiments.",
    featureFlag: "platform.org_ops_lab",
    routeBase: "ops",
    tier: "on-deck",
    available: false,
    defaultEnabled: false,
    status: "planned",
    getRoutes: () => [
      { path: "ops", kind: "placeholder", moduleId: "org-ops-lab" },
    ],
  },
  {
    id: "org-automation-lab",
    label: "Automation Lab",
    name: "Automation Lab",
    mark: "AU",
    description: "A future space for carefully bounded automations that serve the group instead of surveilling it.",
    featureFlag: "platform.org_automation_lab",
    routeBase: "automation",
    tier: "on-deck",
    available: false,
    defaultEnabled: false,
    status: "planned",
    getRoutes: () => [
      { path: "automation", kind: "placeholder", moduleId: "org-automation-lab" },
    ],
  },
];

export const platformModuleRegistry = [
  ...CORE_MODULES,
  ...LIVE_MODULES,
  ...LEGACY_MODULES,
  ...ON_DECK_MODULES,
];

export const DEFAULT_ENABLED_MODULE_IDS = Object.freeze(
  platformModuleRegistry
    .filter((moduleDef) => moduleDef.available && moduleDef.defaultEnabled)
    .map((moduleDef) => moduleDef.id)
);

function withCore(modules) {
  return [...new Set([...CORE_MODULE_IDS, ...(Array.isArray(modules) ? modules : [])])];
}

export const STARTER_PACKS = Object.freeze([
  {
    id: "full-house",
    label: "Full house",
    description: "Every current Bondfire module, including the native Colophon publishing workspace.",
    modules: DEFAULT_ENABLED_MODULE_IDS,
  },
  {
    id: "organizing",
    label: "Organizing cell",
    description: "Needs, pledges, inventory, meetings, events, and the shared room.",
    modules: withCore(["needs", "pledges", "inventory", "meetings", "events", "bondfire-chat", "drive", "intake"]),
  },
  {
    id: "community",
    label: "Community desk",
    description: "The public front door plus the practical basics.",
    modules: withCore(["needs", "inventory", "events", "intake", "bondfire-chat"]),
  },
  {
    id: "publishing",
    label: "Publishing room",
    description: "REC, Drive, Studio, Intake, and the native Colophon workspace.",
    modules: withCore(["witness-archive", "drive", "studio", "intake", "publishing-colophon"]),
  },
]);

export function getPlatformModules() {
  return platformModuleRegistry.map((moduleDef) => ({ ...moduleDef }));
}

export function getAvailablePlatformModules() {
  return getPlatformModules().filter(
    (moduleDef) =>
      moduleDef.available &&
      moduleDef.builderVisible !== false &&
      moduleDef.tier !== "core"
  );
}

export function getModuleById(id) {
  const wanted = String(id || "").trim();
  return getPlatformModules().find((moduleDef) => moduleDef.id === wanted) || null;
}

export function getDefaultEnabledModuleIds() {
  return [...DEFAULT_ENABLED_MODULE_IDS];
}

export function getStarterPacks() {
  return STARTER_PACKS.map((pack) => ({ ...pack, modules: [...pack.modules] }));
}

export function normalizeSelectedModuleIds(value) {
  const requested = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  const wanted = new Set(
    [...CORE_MODULE_IDS, ...requested]
      .map((id) => String(id || "").trim())
      .filter(Boolean)
  );
  return getPlatformModules()
    .filter((moduleDef) => moduleDef.available && wanted.has(moduleDef.id))
    .map((moduleDef) => moduleDef.id);
}
