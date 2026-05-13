export {
	AuthError,
	authenticateUser,
	clearSessionCookie,
	createFirstRunAdmin,
	createSessionForUser,
	getSessionFromEvent,
	getSessionFromToken,
	hasAnyUser,
	hashSessionToken,
	loginWithPassword,
	logout,
	revokeSessionToken,
	sessionCookieName,
	setSessionCookie,
	type AuthSession,
	type AuthUser
} from './auth/session';
export { hashPassword, verifyPassword } from './auth/password';

export const auth = {
	api: {
		signInEmail: async (_options?: unknown) => {
			throw new Error(
				'Better Auth demo endpoints were replaced by TermixKit local auth primitives'
			);
		},
		signUpEmail: async (_options?: unknown) => {
			throw new Error(
				'Better Auth demo endpoints were replaced by TermixKit local auth primitives'
			);
		},
		signOut: async (_options?: unknown) => {
			throw new Error(
				'Better Auth demo endpoints were replaced by TermixKit local auth primitives'
			);
		}
	}
};
