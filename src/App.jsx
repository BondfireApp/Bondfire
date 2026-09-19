import React from "react";
import {
	HashRouter,
	Routes,
	Route,
	Navigate,
	useLocation,
	useParams,
} from "react-router-dom";

// PAGES
import OrgPublicPreview from "./pages/OrgPublicPreview.jsx";
import PublicPage from "./pages/PublicPage.jsx";
import PublicStart from "./pages/PublicStart.jsx";
import PublicCapture from "./pages/PublicCapture.jsx";
import Overview from "./pages/Overview.jsx";
import OrgDash from "./pages/OrgDash.jsx";
import InnerSanctum from "./pages/InnerSanctum.jsx";
import People from "./pages/People.jsx";
import Inventory from "./pages/Inventory.jsx";
import Meetings from "./pages/Meetings.jsx";
import MeetingDetail from "./pages/MeetingDetail.jsx";
import Needs from "./pages/Needs.jsx";
import Settings from "./pages/Settings.jsx";
import BondfireChat from "./pages/BondfireChat.jsx";
import SignIn from "./pages/SignIn.jsx";
import Security from "./pages/Security.jsx";
import Support from "./pages/Support.jsx";
import Drive from "./pages/Drive.jsx";
import Studio from "./pages/Studio.jsx";
import Customize from "./pages/Customize.jsx";
import Colophon from "./pages/Colophon.jsx";
import BuildModules from "./components/BuildModules.jsx";

// COMPONENTS
import AppHeader from "./components/AppHeader.jsx";
import OrgSecretGuard from "./components/OrgSecretGuard.jsx";
import HelpWidget from "./help/HelpWidget.jsx";
import DemoBanner from "./demo/DemoBanner.jsx";
import DemoSpotlightTour from "./demo/DemoSpotlightTour.jsx";
import DemoBoot from "./pages/DemoBoot.jsx";
import { isDemoMode, disableDemoMode } from "./demo/demoMode.js";
import { createSessionSupportSnapshot } from "./platform/sessionSupport.js";
import { getPlatformOrgChildRoutes } from "./platform/routeComposer.jsx";

import Events from "./pages/modules/Events.jsx";
import EventDetail from "./pages/modules/EventDetail.jsx";
import WitnessArchive from "./pages/modules/WitnessArchive.jsx";
import ModuleChat from "./pages/modules/Chat.jsx";
/* -------------------------------- Error Boundary ------------------------------- */
class ErrorBoundary extends React.Component {
	constructor(props) {
		super(props);
		this.state = { error: null };
	}
	static getDerivedStateFromError(error) {
		return { error };
	}
	componentDidCatch(error, info) {
		console.error("App error boundary:", error);
		console.error("App error boundary stack:", error?.stack);
		console.error("App error boundary component stack:", info?.componentStack);
	}
	render() {
		if (this.state.error) {
			return (
				<div style={{ padding: 16 }}>
					<h2 style={{ color: "crimson" }}>Something broke.</h2>
					<pre style={{ whiteSpace: "pre-wrap" }}>{String(this.state.error)}</pre>
				</div>
			);
		}
		return this.props.children;
	}
}

/* ------------------------------ Auth Context ------------------------------ */
const AuthCtx = React.createContext({
	authed: false,
	loading: true,
	user: null,
	refresh: async () => ({ ok: false }),
	logout: async () => {},
});

async function fetchMe() {
	if (isDemoMode()) {
		return { ok: true, user: { id: "demo", name: "Demo User", email: "demo@bondfire.local", demo: true } };
	}
	// Try /me first. If access cookie expired but refresh cookie is still valid,
	// attempt a silent refresh and retry once before declaring the session dead.
	const doMe = async () => {
		const res = await fetch("/api/auth/me", {
			method: "GET",
			credentials: "include",
			headers: { Accept: "application/json" },
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok || !data?.ok) return { ok: false, status: res.status, data };
		return { ok: true, user: data.user };
	};

	let me = await doMe();
	if (me.ok) return me;

	// Only retry on auth-ish failures.
	if (me.status === 401 || me.status === 403) {
		try {
			const rr = await fetch("/api/auth/refresh", {
				method: "POST",
				credentials: "include",
				headers: { Accept: "application/json" },
			});
			// ignore body, just see if it worked
			if (rr.ok) {
				me = await doMe();
				if (me.ok) return me;
			}
		} catch {
			// ignore
		}
	}

	return me;
}

function RequireAuth({ children }) {
	const { authed, loading } = React.useContext(AuthCtx);
	if (loading && !authed) {
		return <div style={{ padding: 16 }} className="helper">Checking session…</div>;
	}
	if (!authed) return <Navigate to="/signin" replace />;
	return children;
}

function ModuleRouteGate({ moduleId, children }) {
	const { orgId } = useParams();
	const [state, setState] = React.useState({ loading: true, enabled: true });

	React.useEffect(() => {
		let alive = true;

		const load = async () => {
			if (!orgId || isDemoMode()) {
				if (alive) setState({ loading: false, enabled: true });
				return;
			}

			try {
				const response = await fetch(`/api/orgs/${encodeURIComponent(orgId)}/modules`, {
					credentials: "include",
					headers: { Accept: "application/json" },
				});
				const payload = await response.json().catch(() => ({}));
				if (!alive) return;

				// If this new endpoint is unavailable during a rollout, keep the
				// existing route reachable rather than breaking an otherwise healthy app.
				if (!response.ok || !Array.isArray(payload?.enabled_modules)) {
					setState({ loading: false, enabled: true });
					return;
				}

				setState({
					loading: false,
					enabled: payload.enabled_modules.map(String).includes(String(moduleId)),
				});
			} catch {
				if (alive) setState({ loading: false, enabled: true });
			}
		};

		load();
		return () => {
			alive = false;
		};
	}, [moduleId, orgId]);

	if (state.loading) {
		return <div style={{ padding: 16 }} className="helper">Checking module access…</div>;
	}
	if (!state.enabled) {
		return <Navigate to={`/org/${encodeURIComponent(orgId)}/overview`} replace />;
	}
	return children;
}

/* ---------------------------------- Shell ---------------------------------- */
function Shell() {
	const loc = useLocation();
	const path = loc.pathname || "/";

	const [state, setState] = React.useState({
		authed: false,
		loading: true,
		user: null,
	});

	const refresh = React.useCallback(async (options = {}) => {
		const { background = false } = options;

		if (!background) {
			setState((s) => ({ ...s, loading: true }));
		}

		try {
			const me = await fetchMe();
			if (!me.ok) {
				setState({ authed: false, loading: false, user: null });
				return { ok: false };
			}
			setState({ authed: true, loading: false, user: me.user });
			return { ok: true, user: me.user };
		} catch (e) {
			console.error("auth/me check failed", e);
			setState({ authed: false, loading: false, user: null });
			return { ok: false };
		}
	}, []);

	const logout = React.useCallback(async () => {
		try {
			await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
		} catch {}
		try {
			localStorage.removeItem("demo_user");
			localStorage.removeItem("bf-demo-user");
			disableDemoMode();
		} catch {}
		setState({ authed: false, loading: false, user: null });
		window.location.hash = "#/signin";
		window.location.reload();
	}, []);

	React.useEffect(() => {
		refresh();
		const onAuthChanged = () => refresh();
		window.addEventListener("bf-auth-changed", onAuthChanged);
		return () => window.removeEventListener("bf-auth-changed", onAuthChanged);
	}, [refresh]);

	// Keep the session alive while the app is open without flashing auth UI.
	React.useEffect(() => {
		if (!state.authed) return;

		const ping = async () => {
			if (document.visibilityState !== "visible") return;
			try {
				await refresh({ background: true });
			} catch {
				// ignore
			}
		};

		const t0 = setTimeout(ping, 30_000);
		const iv = setInterval(ping, 5 * 60_000);
		return () => {
			clearTimeout(t0);
			clearInterval(iv);
		};
	}, [state.authed, refresh]);

	const ctxValue = React.useMemo(() => ({
		authed: state.authed,
		loading: state.loading,
		user: state.user,
		refresh,
		logout,
	}), [state, refresh, logout]);

	const HomeRoute = () => {
		if (state.loading) return <div style={{ padding: 16 }} className="helper">Checking session…</div>;
		return state.authed ? <Navigate to="/orgs" replace /> : <PublicStart />;
	};

	const SignInRoute = () => {
		if (state.loading) return <div style={{ padding: 16 }} className="helper">Checking session…</div>;
		if (!state.authed) return <SignIn />;

		const params = new URLSearchParams(loc.search || "");
		const requestedOrg = String(params.get("org") || "").trim();
		const validOrgId = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(requestedOrg);
		return (
			<Navigate
				to={validOrgId ? `/org/${encodeURIComponent(requestedOrg)}/overview` : "/orgs"}
				replace
			/>
		);
	};

	const sessionSupport = React.useMemo(
		() => createSessionSupportSnapshot({ authed: state.authed, user: state.user }),
		[state.authed, state.user],
	);

	const platformOrgRoutes = React.useMemo(
		() => getPlatformOrgChildRoutes({ sessionSupport }),
		[sessionSupport],
	);

	// Hide the header on public routes
	const hideHeader = path === "/" || path === "/capture" || path === "/build" || path.startsWith("/public/") || path.startsWith("/p/") || path.startsWith("/site/") || path === "/signin" || path === "/demo" || path === "/customize" || /\/org\/[^/]+\/colophon(?:\/|$)/.test(path);

	return (
		<AuthCtx.Provider value={ctxValue}>
			{!hideHeader && (
				<AppHeader
					showLogout={state.authed}
					onLogout={logout}
				/>
			)}

			<Routes>
				{/* PUBLIC */}
				<Route path="/public/:slug" element={<PublicPage />} />
				<Route path="/p/:slug" element={<PublicPage />} />
				<Route path="/site/:slug" element={<PublicPage />} />
				<Route path="/public/*" element={<PublicPage />} />
				<Route path="/p/*" element={<PublicPage />} />
				<Route path="/signin" element={<SignInRoute />} />
				<Route path="/capture" element={<PublicCapture authed={state.authed} />} />
				<Route path="/demo" element={<DemoBoot />} />
				<Route path="/customize" element={<Customize />} />

				{/* Landing */}
				<Route path="/" element={<HomeRoute />} />

				{/* Public builder; save hands anonymous users to auth, while ?new=1 serves signed-in creation */}
				<Route path="/build" element={<BuildModules />} />

				{/* Orgs list */}
				<Route
					path="/orgs"
					element={
						<RequireAuth>
							<OrgDash />
						</RequireAuth>
					}
				/>

				{/* User security */}
				<Route
					path="/security"
					element={
						<RequireAuth>
							<Security />
						</RequireAuth>
					}
				/>

				{/* Account support */}
				<Route
					path="/support"
					element={
						<RequireAuth>
							<Support />
						</RequireAuth>
					}
				/>

				{/* ORG SPACE */}
				<Route
					path="/org/:orgId/*"
					element={
						<RequireAuth>
							<InnerSanctum />
						</RequireAuth>
					}
				>
					<Route path="build" element={<BuildModules />} />
					<Route path="pledges" element={<ModuleRouteGate moduleId="pledges"><Navigate to="../settings?tab=pledges" replace /></ModuleRouteGate>} />
					<Route path="intake" element={<ModuleRouteGate moduleId="intake"><Navigate to="../settings?tab=public-inbox" replace /></ModuleRouteGate>} />
					<Route index element={<Overview />} />
					<Route path="overview" element={<Overview />} />
					<Route path="people" element={<ModuleRouteGate moduleId="people"><People /></ModuleRouteGate>} />
					<Route path="inventory" element={<ModuleRouteGate moduleId="inventory"><Inventory /></ModuleRouteGate>} />
					<Route path="needs" element={<ModuleRouteGate moduleId="needs"><Needs /></ModuleRouteGate>} />
					<Route path="meetings" element={<ModuleRouteGate moduleId="meetings"><Meetings /></ModuleRouteGate>} />
					<Route path="meetings/:meetingId" element={<ModuleRouteGate moduleId="meetings"><MeetingDetail /></ModuleRouteGate>} />
					<Route path="settings" element={<Settings />} />
					<Route path="support" element={<Support />} />
					<Route path="drive" element={<ModuleRouteGate moduleId="drive"><Drive /></ModuleRouteGate>} />
					<Route path="studio" element={<ModuleRouteGate moduleId="studio"><Studio /></ModuleRouteGate>} />
					<Route path="public" element={<ModuleRouteGate moduleId="public-site"><OrgPublicPreview /></ModuleRouteGate>} />

					<Route path="events" element={<ModuleRouteGate moduleId="events"><Events /></ModuleRouteGate>} />
					<Route path="events/:eventId" element={<ModuleRouteGate moduleId="events"><EventDetail /></ModuleRouteGate>} />
					<Route path="witness" element={<ModuleRouteGate moduleId="witness-archive"><WitnessArchive /></ModuleRouteGate>} />
					<Route path="witness/capture" element={<ModuleRouteGate moduleId="witness-archive"><PublicCapture authed={state.authed} embedded /></ModuleRouteGate>} />
					<Route path="chat-module" element={<ModuleRouteGate moduleId="module-chat"><ModuleChat /></ModuleRouteGate>} />
					<Route path="chat" element={<ModuleRouteGate moduleId="bondfire-chat"><BondfireChat /></ModuleRouteGate>} />
					<Route path="guard/*" element={<OrgSecretGuard />} />
					{platformOrgRoutes.map((route) => (
						<Route
							key={`platform-${route.moduleId}-${route.path}`}
							path={route.path}
							element={route.element}
						/>
					))}
				</Route>

				<Route path="*" element={<Navigate to="/" replace />} />
			</Routes>
			<HelpWidget />
			<DemoBanner />
			<DemoSpotlightTour />
		</AuthCtx.Provider>
	);
}

/* ---------------------------------- App ---------------------------------- */
export default function App() {
	return (
		<HashRouter>
			<ErrorBoundary>
				<Shell />
			</ErrorBoundary>
		</HashRouter>
	);
}