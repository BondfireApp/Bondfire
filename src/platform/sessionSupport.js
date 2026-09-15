/**
 * Read-only, non-critical session boundary for platform decisions.
 *
 * This helper intentionally does not mutate auth state or read/write any
 * sensitive auth/token internals.
 */
export function createSessionSupportSnapshot({ authed, user }) {
	const snapshot = {
		hasSession: Boolean(authed && user),
		userId: user?.id ?? null,
		userEmail: user?.email ?? null,
		isDemoUser: Boolean(user?.demo),
	};

	return Object.freeze(snapshot);
}
