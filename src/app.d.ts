import type { AuthSession, AuthUser } from '$lib/server/auth';

declare global {
	namespace App {
		interface Locals {
			user?: AuthUser;
			session?: AuthSession;
		}
	}
}

export {};
