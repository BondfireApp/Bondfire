import { getPlatformModules } from "./moduleRegistry.js";

function parseFlagValue(value) {
	if (typeof value === "boolean") return value;
	if (typeof value !== "string") return false;

	switch (value.trim().toLowerCase()) {
		case "1":
		case "true":
		case "yes":
		case "on":
		case "enabled":
			return true;
		default:
			return false;
	}
}

function buildKnownFlagMap() {
	const modules = getPlatformModules();
	return modules.reduce((map, mod) => {
		if (!mod?.featureFlag) return map;
		map[mod.featureFlag] = Boolean(mod.enabledByDefault);
		return map;
	}, {});
}

const KNOWN_PLATFORM_FLAGS = buildKnownFlagMap();

export function getKnownPlatformFlags() {
	return { ...KNOWN_PLATFORM_FLAGS };
}

export function isFeatureEnabled(flagName, context = {}) {
	if (!flagName || !(flagName in KNOWN_PLATFORM_FLAGS)) {
		return false; // fail closed for unknown flags
	}

	const { env = import.meta?.env ?? {}, overrides = {} } = context;
	if (flagName in overrides) return parseFlagValue(overrides[flagName]);

	const envKey = `VITE_FF_${flagName.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()}`;
	if (envKey in env) return parseFlagValue(env[envKey]);

	return KNOWN_PLATFORM_FLAGS[flagName] ?? false;
}
