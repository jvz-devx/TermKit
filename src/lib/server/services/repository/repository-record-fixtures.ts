import type {
	ConnectionSessionRecord,
	CredentialRecord,
	HostRecord,
	SessionTicketRecord,
	SshAttachTicketRecord,
	SshLiveSessionRecord,
	SshTunnelProfileRecord,
	SshTunnelSessionRecord,
	WorkspaceMembershipRecord,
	WorkspaceRecord
} from '../types';

export function workspaceRecord(patch: Partial<WorkspaceRecord> = {}): WorkspaceRecord {
	const now = new Date('2026-05-14T10:00:00.000Z');
	return {
		id: 'workspace-1',
		name: 'Workspace',
		metadata: {},
		createdAt: now,
		updatedAt: now,
		...patch
	};
}

export function workspaceMembership(
	patch: Partial<WorkspaceMembershipRecord> = {}
): WorkspaceMembershipRecord {
	const now = new Date('2026-05-14T10:00:00.000Z');
	return {
		id: 'membership-1',
		workspaceId: 'workspace-1',
		userId: 'member-1',
		role: 'member',
		createdAt: now,
		updatedAt: now,
		...patch
	};
}

export function hostRecord(patch: Partial<HostRecord> = {}): HostRecord {
	const now = new Date('2026-05-14T10:00:00.000Z');
	return {
		id: 'host-1',
		userId: 'owner-1',
		workspaceId: null,
		name: 'Shell',
		protocol: 'ssh',
		hostname: 'shell.example.test',
		port: 22,
		username: null,
		credentialId: null,
		folder: null,
		tags: [],
		notes: null,
		metadata: {},
		createdAt: now,
		updatedAt: now,
		...patch
	};
}

export function credentialRecord(patch: Partial<CredentialRecord> = {}): CredentialRecord {
	const now = new Date('2026-05-14T10:00:00.000Z');
	return {
		id: 'credential-1',
		userId: 'owner-1',
		workspaceId: null,
		name: 'Credential',
		kind: 'password',
		username: 'ops',
		encryptedSecret: 'encrypted-secret',
		encryption: {
			algorithm: 'aes-256-gcm',
			keyVersion: 1,
			iv: 'iv',
			authTag: 'auth-tag',
			salt: 'salt'
		},
		metadata: {},
		createdAt: now,
		updatedAt: now,
		...patch
	};
}

export function connectionSession(
	patch: Partial<ConnectionSessionRecord> = {}
): ConnectionSessionRecord {
	const now = new Date('2026-05-14T10:00:00.000Z');
	return {
		id: 'connection-1',
		userId: 'user-1',
		workspaceId: null,
		hostId: null,
		protocol: 'ssh',
		status: 'starting',
		startedAt: now,
		endedAt: null,
		errorCode: null,
		errorMessage: null,
		errorDetails: null,
		updatedAt: now,
		...patch
	};
}

export function sshTunnelProfile(
	patch: Partial<SshTunnelProfileRecord> = {}
): SshTunnelProfileRecord {
	const now = new Date('2026-05-14T10:00:00.000Z');
	return {
		id: 'profile-1',
		userId: 'owner-1',
		workspaceId: null,
		sshHostId: 'host-1',
		name: 'Private service',
		targetHost: 'service.internal',
		targetPort: 443,
		description: null,
		createdAt: now,
		updatedAt: now,
		...patch
	};
}

export function sshTunnelSession(
	patch: Partial<SshTunnelSessionRecord> = {}
): SshTunnelSessionRecord {
	const now = new Date('2026-05-14T10:00:00.000Z');
	return {
		id: 'tunnel-session-1',
		profileId: 'profile-1',
		userId: 'owner-1',
		workspaceId: null,
		sshHostId: 'host-1',
		targetHost: 'service.internal',
		targetPort: 443,
		publicPath: '/tunnels/tunnel-session-1',
		status: 'active',
		startedAt: now,
		endedAt: null,
		lastSeenAt: now,
		errorCode: null,
		errorMessage: null,
		...patch
	};
}

export function sessionTicket(patch: Partial<SessionTicketRecord> = {}): SessionTicketRecord {
	const now = new Date('2026-05-14T10:00:00.000Z');
	return {
		id: 'ticket-1',
		ticketHash: 'ticket-hash-1',
		userId: 'owner-1',
		hostId: 'host-1',
		protocol: 'ssh',
		target: 'ssh:shell.example.test:22',
		expiresAt: new Date('2026-05-14T10:05:00.000Z'),
		usedAt: null,
		createdAt: now,
		...patch
	};
}

export function sshLiveSession(patch: Partial<SshLiveSessionRecord> = {}): SshLiveSessionRecord {
	const now = new Date('2026-05-14T10:00:00.000Z');
	return {
		id: 'live-session-1',
		userId: 'owner-1',
		hostId: 'host-1',
		title: 'Shell',
		status: 'attached',
		startedAt: now,
		lastAttachedAt: now,
		detachedAt: null,
		expiresAt: null,
		endedAt: null,
		errorCode: null,
		errorMessage: null,
		terminalCols: 120,
		terminalRows: 40,
		createdAt: now,
		updatedAt: now,
		...patch
	};
}

export function sshAttachTicket(patch: Partial<SshAttachTicketRecord> = {}): SshAttachTicketRecord {
	const now = new Date('2026-05-14T10:00:00.000Z');
	return {
		id: 'attach-ticket-1',
		userId: 'owner-1',
		sshLiveSessionId: 'live-session-1',
		ticketHash: 'attach-ticket-hash-1',
		expiresAt: new Date('2026-05-14T10:01:00.000Z'),
		consumedAt: null,
		createdAt: now,
		...patch
	};
}
