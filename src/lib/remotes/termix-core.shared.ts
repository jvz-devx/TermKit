import { getRequestEvent } from '$app/server';
import { ServiceUnauthorizedError, ServiceValidationError } from '$lib/server/services/errors';
import type { RdpGatewayBootstrap } from '$lib/server/rdp/gateway';
import type { VncLaunchCredentials } from '$lib/server/protocols/vnc';
import type { RdpLaunchCredentials } from '$lib/server/protocols/rdp-credentials';
import { settingsService } from '$lib/server/services/settings';
import { sshLiveSessionService } from '$lib/server/services/ssh-live-sessions';
import {
	publicSshTunnelPath,
	type SshTunnelProfileRecord,
	type SshTunnelSessionRecord
} from '$lib/server/services/ssh-tunnels';
import {
	getSshHostKeyTrustSummary,
	type SshHostKeyTrustSummary
} from '$lib/server/protocols/ssh-host-key-enrollment';
import type {
	ConnectionHistoryRecord,
	ConnectionProtocol,
	ConnectionSessionStatus,
	CredentialKind,
	HostProtocol,
	HostRecord,
	SshLiveSessionRecord
} from '$lib/server/services/types';
import {
	normalizeHostMetadata,
	type FtpsHostMetadata,
	type SshJumpHostMetadata,
	type TerminalPreferences
} from '$lib/termix/host-metadata';
import { isSessionLayoutKind } from '$lib/components/termix/session/layout/workspace-layout';

export type { RdpLaunchCredentials };
export type { SshHostKeyTrustSummary };

export type HostSummary = {
	id: string;
	name: string;
	protocol: HostProtocol;
	hostname: string;
	port: number;
	username: string | null;
	credentialId: string | null;
	credentialName: string | null;
	folder: string | null;
	tags: string[];
	notes: string | null;
	metadata: Record<string, unknown>;
	terminalPreferences: TerminalPreferences;
	sshJumpHost: SshJumpHostMetadata;
	ftps: FtpsHostMetadata;
	hostKeyTrust: SshHostKeyTrustSummary | null;
	createdAt: string;
	updatedAt: string;
};

export type CredentialSummary = {
	id: string;
	name: string;
	kind: CredentialKind;
	username: string | null;
	usedBy: number;
	createdAt: string;
	updatedAt: string;
};

export type HostMutationInput = {
	id?: string;
	name?: unknown;
	protocol?: unknown;
	hostname?: unknown;
	port?: unknown;
	username?: unknown;
	credentialId?: unknown;
	folder?: unknown;
	tags?: unknown;
	notes?: unknown;
	metadata?: unknown;
};

export type CredentialMutationInput = {
	id?: string;
	name?: unknown;
	kind?: unknown;
	username?: unknown;
	secret?: unknown;
};

export type LaunchProtocol = HostProtocol | 'sftp';

export type SessionLaunch = {
	hostId: string;
	protocol: LaunchProtocol;
	ticket: string | null;
	websocketPath: string | null;
	expiresAt: string | null;
	connectionSessionId: string | null;
	rdp: RdpGatewayBootstrap | null;
	rdpCredentials: RdpLaunchCredentials | null;
	vncCredentials: VncLaunchCredentials | null;
};

export type LiveSshSessionSummary = {
	id: string;
	hostId: string;
	hostName: string;
	hostname: string;
	username: string | null;
	title: string;
	status: 'starting' | 'attached' | 'detached' | 'ended' | 'failed' | 'stale';
	startedAt: string;
	lastAttachedAt: string | null;
	detachedAt: string | null;
	expiresAt: string | null;
	endedAt: string | null;
	errorCode: string | null;
	errorMessage: string | null;
	terminalCols: number;
	terminalRows: number;
	updatedAt: string;
};

export type LiveSshAttach = {
	session: LiveSshSessionSummary;
	liveTicket: string;
	liveWebsocketPath: string;
	expiresAt: string;
};

export type SshTunnelProfileSummary = {
	id: string;
	hostId: string;
	name: string;
	targetHost: string;
	targetPort: number;
	createdAt: string;
	updatedAt: string;
};

export type SshTunnelSessionSummary = {
	id: string;
	profileId: string | null;
	hostId: string;
	targetHost: string;
	targetPort: number;
	status: 'active' | 'idle' | 'ended' | 'failed';
	failureCode: string | null;
	publicPath: string;
	websocketPath: string;
	startedAt: string;
	lastUsedAt: string | null;
	endedAt: string | null;
	updatedAt: string;
};

export type SshTunnelProfileMutationInput = {
	id?: unknown;
	hostId?: unknown;
	name?: unknown;
	targetHost?: unknown;
	targetPort?: unknown;
};

export type StartSshTunnelInput = {
	profileId?: unknown;
	hostId?: unknown;
	name?: unknown;
	targetHost?: unknown;
	targetPort?: unknown;
};

export type SessionWorkspaceLayoutMetadata = {
	layout: string;
	panes: Record<string, unknown>[];
	updatedAt?: string;
};

export type ConnectionHistorySummary = {
	id: string;
	userId: string;
	user: string;
	workspaceId: string | null;
	workspace: string;
	hostId: string | null;
	host: string;
	hostname: string;
	hostUser: string | null;
	protocol: ConnectionProtocol;
	startedAt: string;
	endedAt: string | null;
	durationMs: number | null;
	status: ConnectionSessionStatus;
	errorReason: string | null;
	errorCode: string | null;
	errorMessage: string | null;
};

export function requireRemoteUser(): string {
	const userId = getRequestEvent().locals.user?.id;
	if (!userId) throw new ServiceUnauthorizedError();
	return userId;
}

export function toConnectionHistorySummary(
	record: ConnectionHistoryRecord
): ConnectionHistorySummary {
	return {
		id: record.id,
		userId: record.userId,
		user: record.username ?? 'Unknown user',
		workspaceId: record.workspaceId,
		workspace: record.workspaceName ?? 'Personal workspace',
		hostId: record.hostId,
		host: record.hostName ?? 'Deleted host',
		hostname: record.hostname ?? 'Unknown host',
		hostUser: record.hostUsername,
		protocol: record.protocol,
		startedAt: record.startedAt.toISOString(),
		endedAt: record.endedAt?.toISOString() ?? null,
		durationMs: record.durationMs,
		status: record.status,
		errorReason: record.errorReason,
		errorCode: record.errorCode,
		errorMessage: record.errorMessage
	};
}

export async function safeSshHostKeyTrustSummary(
	userId: string,
	hostId: string
): Promise<SshHostKeyTrustSummary | null> {
	try {
		return await getSshHostKeyTrustSummary(userId, hostId);
	} catch {
		return null;
	}
}

export async function assertSshHostKeyLaunchAllowed(userId: string, hostId: string): Promise<void> {
	const trust = await getSshHostKeyTrustSummary(userId, hostId);
	if (trust.status === 'unknown' && !trust.trustOnFirstUse) {
		throw new ServiceValidationError([
			'SSH host key is not enrolled. Enroll the host key before opening this SSH session.'
		]);
	}
}

export function toHostSummary(
	host: HostRecord,
	credentialName: string | null | undefined,
	hostKeyTrust: SshHostKeyTrustSummary | null = null
): HostSummary {
	const metadata = normalizeHostMetadata(host.metadata);
	return {
		id: host.id,
		name: host.name,
		protocol: host.protocol,
		hostname: host.hostname,
		port: host.port,
		username: host.username,
		credentialId: host.credentialId,
		credentialName: host.credentialId ? (credentialName ?? null) : null,
		folder: host.folder,
		tags: host.tags,
		notes: host.notes,
		metadata,
		terminalPreferences: metadata.terminalPreferences,
		sshJumpHost: metadata.sshJumpHost,
		ftps: metadata.ftps,
		hostKeyTrust,
		createdAt: host.createdAt.toISOString(),
		updatedAt: host.updatedAt.toISOString()
	};
}

export function validateSessionWorkspaceLayoutMetadata(
	value: unknown
): SessionWorkspaceLayoutMetadata {
	if (!isRecord(value)) throw new ServiceValidationError(['metadata is required']);
	const layout = typeof value.layout === 'string' ? value.layout : '';
	const panes = Array.isArray(value.panes) ? value.panes.filter(isRecord) : [];
	if (!isSessionLayoutKind(layout)) {
		throw new ServiceValidationError(['layout is invalid']);
	}
	if (panes.length < 1 || panes.length > 4) {
		throw new ServiceValidationError(['panes must contain between 1 and 4 entries']);
	}

	return {
		layout,
		panes,
		updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : undefined
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function rdpLaunchErrorCode(error: unknown): string {
	if (error instanceof Error && error.name) return sanitizeRdpErrorCode(`rdp_${error.name}`);
	return 'rdp_launch_failed';
}

export function sanitizeRdpErrorCode(value: unknown): string {
	return sanitizeConnectionErrorCode(value, 'rdp_client');
}

export function sanitizeConnectionErrorCode(value: unknown, fallbackPrefix: string): string {
	const fallback = `${fallbackPrefix}_failed`;
	const raw = typeof value === 'string' && value.trim() ? value.trim() : fallback;
	const sanitized = raw.toLowerCase().replace(/[^a-z0-9_:-]+/g, '_');
	return sanitized.slice(0, 120) || fallback;
}

export async function createLiveSshAttach(
	userId: string,
	session: LiveSshSessionSummary
): Promise<LiveSshAttach> {
	const settings = await settingsService.getBasicAppSettings();
	const ttlMs = settings.ticketTtlSeconds * 1000;
	const liveTicket = await sshLiveSessionService.createAttachTicket(
		userId,
		session.id,
		new Date(),
		ttlMs
	);

	return {
		session,
		liveTicket: liveTicket.ticket,
		liveWebsocketPath: `/ws/ssh/live/${encodeURIComponent(liveTicket.ticket)}`,
		expiresAt: liveTicket.record.expiresAt.toISOString()
	};
}

export function toLiveSshSessionSummary(
	session: SshLiveSessionRecord,
	host: HostRecord | undefined
): LiveSshSessionSummary {
	return {
		id: session.id,
		hostId: session.hostId,
		hostName: host?.name ?? 'Deleted host',
		hostname: host?.hostname ?? 'Unknown host',
		username: host?.username ?? null,
		title: session.title,
		status: session.status,
		startedAt: session.startedAt.toISOString(),
		lastAttachedAt: session.lastAttachedAt?.toISOString() ?? null,
		detachedAt: session.detachedAt?.toISOString() ?? null,
		expiresAt: session.expiresAt?.toISOString() ?? null,
		endedAt: session.endedAt?.toISOString() ?? null,
		errorCode: session.errorCode,
		errorMessage: session.errorMessage,
		terminalCols: session.terminalCols,
		terminalRows: session.terminalRows,
		updatedAt: session.updatedAt.toISOString()
	};
}

export function toSshTunnelProfileSummary(
	profile: SshTunnelProfileRecord
): SshTunnelProfileSummary {
	return {
		id: profile.id,
		hostId: profile.hostId,
		name: profile.name,
		targetHost: profile.targetHost,
		targetPort: profile.targetPort,
		createdAt: profile.createdAt.toISOString(),
		updatedAt: profile.updatedAt.toISOString()
	};
}

export function toSshTunnelSessionSummary(
	session: SshTunnelSessionRecord
): SshTunnelSessionSummary {
	return {
		id: session.id,
		profileId: session.profileId,
		hostId: session.hostId,
		targetHost: session.targetHost,
		targetPort: session.targetPort,
		status: session.status,
		failureCode: session.failureCode,
		publicPath: publicSshTunnelPath(session.id),
		websocketPath: `/ws/tunnel/${encodeURIComponent(session.id)}`,
		startedAt: session.startedAt.toISOString(),
		lastUsedAt: session.lastUsedAt?.toISOString() ?? null,
		endedAt: session.endedAt?.toISOString() ?? null,
		updatedAt: session.updatedAt.toISOString()
	};
}
