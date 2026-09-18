const PENDING_BUILD_KEY = "bf_pending_module_build_v1";
const PENDING_BUILD_NAME_KEY = "bf_pending_build_name_v1";

export function readPendingBuild() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PENDING_BUILD_KEY) || "[]");
    return Array.isArray(parsed)
      ? parsed.map((id) => String(id || "").trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

export function writePendingBuild(ids) {
  try {
    const safe = Array.from(
      new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || "").trim()).filter(Boolean))
    );
    localStorage.setItem(PENDING_BUILD_KEY, JSON.stringify(safe));
  } catch {}
}

export function readPendingBuildName() {
  try {
    return String(localStorage.getItem(PENDING_BUILD_NAME_KEY) || "").trim();
  } catch {
    return "";
  }
}

export function writePendingBuildName(name) {
  try {
    const safe = String(name || "").trim();
    if (safe) localStorage.setItem(PENDING_BUILD_NAME_KEY, safe);
    else localStorage.removeItem(PENDING_BUILD_NAME_KEY);
  } catch {}
}

export function clearPendingBuild() {
  try {
    localStorage.removeItem(PENDING_BUILD_KEY);
    localStorage.removeItem(PENDING_BUILD_NAME_KEY);
  } catch {}
}
