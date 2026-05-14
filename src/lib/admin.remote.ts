import { command, getRequestEvent, query } from '$app/server';
import { error } from '@sveltejs/kit';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { hashPassword } from '$lib/server/auth/password';
import {
	authIdentities,
	connectionSessions,
	credentials,
	hosts,
	sessions,
	sshLiveSessions,
	users,
	workspaces,
	workspaceMemberships
} from '$lib/server/db/schema';
import { settingsService } from '$lib/server/services/settings';
import { ServiceValidationError } from '$lib/server/services/errors';
import { sshLiveSessionService } from '$lib/server/services/ssh-live-sessions';
import { liveSshManager } from '$lib/server/ssh-live/manager';
import type { BasicAppSettings } from '$lib/server/services/settings';
import type { HostProtocol } from '$lib/server/services/types';

export type AdminUserSummary = {
	id: string;
	username: string;
	isAdmin: boolean;
	disabled: boolean;
	disabledSupported: true;
	disabledAt: string | null;
	createdAt: string;
	updatedAt: string;
	identityEmails: string[];
	activeAppSessions: number;
	hostCount: number;
	credentialCount: number;
	liveSshSessionCount: number;
	lastSeenAt: string | null;
};

export type AdminWorkspaceSummary = {
	id: string;
	ownerId: string;
	ownerUsername: string;
	name: string;
	source: 'workspace';
	memberCount: number;
	hostCount: number;
	sshHosts: number;
	rdpHosts: number;
	vncHosts: number;
	telnetHosts: number;
	credentialCount: number;
	activeLiveSshSessions: number;
	updatedAt: string;
};

export type AdminLiveSshSessionSummary = {
	id: string;
	userId: string;
	username: string;
	hostId: string;
	hostName: string;
	hostname: string;
	title: string;
	status: 'starting' | 'attached' | 'detached' | 'ended' | 'failed' | 'stale';
	startedAt: string;
	lastAttachedAt: string | null;
	detachedAt: string | null;
	expiresAt: string | null;
	endedAt: string | null;
	updatedAt: string;
	canTerminate: boolean;
};

export type AdminConnectionHistoryEntry = {
	id: string;
	userId: string;
	username: string;
	hostName: string | null;
	hostname: string | null;
	protocol: HostProtocol;
	status: 'starting' | 'active' | 'ended' | 'failed';
	startedAt: string;
	endedAt: string | null;
	errorCode: string | null;
	updatedAt: string;
};

export type AdminOverview = {
	users: AdminUserSummary[];
	workspaces: AdminWorkspaceSummary[];
	liveSshSessions: AdminLiveSshSessionSummary[];
	connectionHistory: AdminConnectionHistoryEntry[];
	settings: BasicAppSettings;
	capabilities: {
		createUsers: true;
		disableUsers: true;
		promoteUsers: true;
		terminateLiveSshSessions: true;
		workspacesSource: 'workspace';
	};
};

const openLiveSshStatuses = ['starting', 'attached', 'detached'] as const;

export type AdminCreateUserInput = {
	username?: unknown;
	password?: unknown;
	isAdmin?: unknown;
};

export const getAdminOverview = query(async (): Promise<AdminOverview> => {
	requireAdmin();

	const [
		userRows,
		identityRows,
		appSessionRows,
		hostRows,
		credentialRows,
		workspaceRows,
		workspaceMembershipRows,
		liveSshRows,
		connectionRows,
		settings
	] = await Promise.all([
		db.select().from(users).orderBy(users.username),
		db.select().from(authIdentities),
		db.select().from(sessions),
		db.select().from(hosts),
		db.select().from(credentials),
		db.select().from(workspaces),
		db.select().from(workspaceMemberships),
		db.select().from(sshLiveSessions).orderBy(desc(sshLiveSessions.updatedAt)),
		db.select().from(connectionSessions).orderBy(desc(connectionSessions.startedAt)).limit(50),
		settingsService.getBasicAppSettings()
	]);

	const usersById = new Map(userRows.map((user) => [user.id, user]));
	const hostsById = new Map(hostRows.map((host) => [host.id, host]));
	const now = new Date();

	return {
		users: userRows.map((user) => {
			const userSessions = appSessionRows.filter(
				(session) => session.userId === user.id && session.expiresAt > now
			);

			return {
				id: user.id,
				username: user.username,
				isAdmin: user.isAdmin,
				disabled: Boolean(user.disabledAt),
				disabledSupported: true,
				disabledAt: user.disabledAt?.toISOString() ?? null,
				createdAt: user.createdAt.toISOString(),
				updatedAt: user.updatedAt.toISOString(),
				identityEmails: identityRows
					.filter((identity) => identity.userId === user.id && identity.email)
					.map((identity) => identity.email!)
					.sort((left, right) => left.localeCompare(right)),
				activeAppSessions: userSessions.length,
				hostCount: hostRows.filter((host) => host.userId === user.id).length,
				credentialCount: credentialRows.filter((credential) => credential.userId === user.id)
					.length,
				liveSshSessionCount: liveSshRows.filter(
					(session) =>
						session.userId === user.id &&
						openLiveSshStatuses.includes(session.status as (typeof openLiveSshStatuses)[number])
				).length,
				lastSeenAt:
					userSessions
						.map((session) => session.lastSeenAt)
						.sort((left, right) => right.getTime() - left.getTime())[0]
						?.toISOString() ?? null
			};
		}),
		workspaces: toWorkspaceSummaries(
			userRows,
			hostRows,
			credentialRows,
			workspaceRows,
			workspaceMembershipRows,
			liveSshRows
		),
		liveSshSessions: liveSshRows.map((session) => {
			const owner = usersById.get(session.userId);
			const host = hostsById.get(session.hostId);

			return {
				id: session.id,
				userId: session.userId,
				username: owner?.username ?? 'Unknown user',
				hostId: session.hostId,
				hostName: host?.name ?? 'Unknown host',
				hostname: host?.hostname ?? '',
				title: session.title,
				status: session.status,
				startedAt: session.startedAt.toISOString(),
				lastAttachedAt: session.lastAttachedAt?.toISOString() ?? null,
				detachedAt: session.detachedAt?.toISOString() ?? null,
				expiresAt: session.expiresAt?.toISOString() ?? null,
				endedAt: session.endedAt?.toISOString() ?? null,
				updatedAt: session.updatedAt.toISOString(),
				canTerminate: openLiveSshStatuses.includes(
					session.status as (typeof openLiveSshStatuses)[number]
				)
			};
		}),
		connectionHistory: connectionRows.map((session) => {
			const owner = usersById.get(session.userId);
			const host = session.hostId ? hostsById.get(session.hostId) : null;

			return {
				id: session.id,
				userId: session.userId,
				username: owner?.username ?? 'Unknown user',
				hostName: host?.name ?? null,
				hostname: host?.hostname ?? null,
				protocol: session.protocol,
				status: session.status,
				startedAt: session.startedAt.toISOString(),
				endedAt: session.endedAt?.toISOString() ?? null,
				errorCode: session.errorCode,
				updatedAt: session.updatedAt.toISOString()
			};
		}),
		settings,
		capabilities: {
			createUsers: true,
			disableUsers: true,
			promoteUsers: true,
			terminateLiveSshSessions: true,
			workspacesSource: 'workspace'
		}
	};
});

export const createAdminUser = command<AdminCreateUserInput, void>('unchecked', async (input) => {
	requireAdmin();
	const username = typeof input.username === 'string' ? input.username.trim() : '';
	const password = typeof input.password === 'string' ? input.password : '';
	const isAdmin = input.isAdmin === true;

	const issues: string[] = [];
	if (!username) issues.push('username is required');
	if (password.length < 8) issues.push('password must be at least 8 characters');
	if (issues.length > 0) throw new ServiceValidationError(issues);

	await db.insert(users).values({
		username,
		passwordHash: await hashPassword(password),
		isAdmin
	});
	void getAdminOverview().refresh();
});

export const promoteAdminUser = command<string, void>('unchecked', async (userId) => {
	requireAdmin();
	if (typeof userId !== 'string' || !userId) {
		throw new ServiceValidationError(['userId is required']);
	}

	await db.update(users).set({ isAdmin: true, updatedAt: new Date() }).where(eq(users.id, userId));
	void getAdminOverview().refresh();
});

export const disableAdminUser = command<string, void>('unchecked', async (userId) => {
	const adminUserId = requireAdmin();
	if (typeof userId !== 'string' || !userId) {
		throw new ServiceValidationError(['userId is required']);
	}
	if (userId === adminUserId) {
		throw new ServiceValidationError(['admins cannot disable their own account']);
	}

	const now = new Date();
	await db.update(users).set({ disabledAt: now, updatedAt: now }).where(eq(users.id, userId));
	await db.delete(sessions).where(eq(sessions.userId, userId));
	void getAdminOverview().refresh();
});

export const terminateAdminLiveSshSession = command<string, void>(
	'unchecked',
	async (sessionId) => {
		requireAdmin();
		if (typeof sessionId !== 'string' || !sessionId) {
			throw new ServiceValidationError(['sessionId is required']);
		}

		const [session] = await db
			.select({ id: sshLiveSessions.id, userId: sshLiveSessions.userId })
			.from(sshLiveSessions)
			.where(
				and(
					eq(sshLiveSessions.id, sessionId),
					inArray(sshLiveSessions.status, [...openLiveSshStatuses])
				)
			)
			.limit(1);

		if (!session) {
			throw new ServiceValidationError(['SSH live session is not active']);
		}

		await sshLiveSessionService.close(session.userId, session.id);
		liveSshManager.close(session.id);
		void getAdminOverview().refresh();
	}
);

function requireAdmin(): string {
	const user = getRequestEvent().locals.user;
	if (!user) error(401, 'Unauthenticated');
	if (!user.isAdmin) error(403, 'Admin access required');
	return user.id;
}

function toWorkspaceSummaries(
	userRows: (typeof users.$inferSelect)[],
	hostRows: (typeof hosts.$inferSelect)[],
	credentialRows: (typeof credentials.$inferSelect)[],
	workspaceRows: (typeof workspaces.$inferSelect)[],
	workspaceMembershipRows: (typeof workspaceMemberships.$inferSelect)[],
	liveSshRows: (typeof sshLiveSessions.$inferSelect)[]
): AdminWorkspaceSummary[] {
	const usersById = new Map(userRows.map((user) => [user.id, user]));
	return workspaceRows
		.map((workspace): AdminWorkspaceSummary => {
			const memberships = workspaceMembershipRows.filter(
				(membership) => membership.workspaceId === workspace.id
			);
			const ownerMembership =
				memberships.find((membership) => membership.role === 'owner') ?? memberships[0];
			const owner = ownerMembership ? usersById.get(ownerMembership.userId) : null;
			const workspaceHosts = hostRows.filter((host) => host.workspaceId === workspace.id);
			const workspaceCredentials = credentialRows.filter(
				(credential) => credential.workspaceId === workspace.id
			);
			const activeLiveSshSessions = liveSshRows.filter(
				(session) =>
					openLiveSshStatuses.includes(session.status as (typeof openLiveSshStatuses)[number]) &&
					workspaceHosts.some((host) => host.id === session.hostId)
			).length;
			const updatedAt = [
				workspace.updatedAt,
				...workspaceHosts.map((host) => host.updatedAt),
				...workspaceCredentials.map((credential) => credential.updatedAt),
				...memberships.map((membership) => membership.updatedAt)
			].sort((left, right) => right.getTime() - left.getTime())[0];

			return {
				id: workspace.id,
				ownerId: ownerMembership?.userId ?? '',
				ownerUsername: owner?.username ?? 'Unknown owner',
				name: workspace.name,
				source: 'workspace',
				memberCount: memberships.length,
				hostCount: workspaceHosts.length,
				sshHosts: workspaceHosts.filter((host) => host.protocol === 'ssh').length,
				rdpHosts: workspaceHosts.filter((host) => host.protocol === 'rdp').length,
				vncHosts: workspaceHosts.filter((host) => host.protocol === 'vnc').length,
				telnetHosts: workspaceHosts.filter((host) => host.protocol === 'telnet').length,
				credentialCount: workspaceCredentials.length,
				activeLiveSshSessions,
				updatedAt: updatedAt.toISOString()
			};
		})
		.sort((left, right) =>
			`${left.ownerUsername}:${left.name}`.localeCompare(`${right.ownerUsername}:${right.name}`)
		);
}
