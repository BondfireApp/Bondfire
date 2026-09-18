import React from "react";
import Colophon from "../pages/Colophon.jsx";
import { getPlatformModules } from "./moduleRegistry.js";
import { isFeatureEnabled } from "./featureFlags.js";

function PlatformRoutePlaceholder({ moduleId }) {
	return (
		<div style={{ padding: 16 }} className="helper">
			{moduleId} is not active yet.
		</div>
	);
}

function renderRouteElement(route) {
	if (route.kind === "colophon-native") {
		return <Colophon />;
	}

	if (route.kind === "placeholder") {
		return <PlatformRoutePlaceholder moduleId={route.moduleId} />;
	}

	return null;
}

export function getPlatformOrgChildRoutes(context = {}) {
	const { sessionSupport = null, featureFlagContext = {} } = context;

	const modules = getPlatformModules()
		.filter((moduleDef) => {
			if (!moduleDef?.featureFlag) return false;
			if (!isFeatureEnabled(moduleDef.featureFlag, featureFlagContext)) return false;
			if (!sessionSupport?.hasSession) return false;
			return true;
		})
		.sort((a, b) => a.id.localeCompare(b.id));

	return modules.flatMap((moduleDef) => {
		const routes = moduleDef.getRoutes?.(context) ?? [];
		return routes.map((route) => ({
			...route,
			moduleId: moduleDef.id,
			element: renderRouteElement(route),
		}));
	});
}
