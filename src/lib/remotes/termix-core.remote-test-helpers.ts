export function hostRecord(overrides: Record<string, unknown> = {}) {
	return {
		id: 'host-1',
		userId: 'user-1',
		workspaceId: null,
		name: 'SSH Host',
		protocol: 'ssh',
		hostname: 'ssh.internal',
		port: 22,
		username: 'deploy',
		credentialId: null,
		folder: null,
		tags: [],
		notes: null,
		metadata: {},
		createdAt: new Date('2026-05-15T10:00:00.000Z'),
		updatedAt: new Date('2026-05-15T10:00:00.000Z'),
		...overrides
	};
}

export function sshHostKeyTrustSummary(overrides: Record<string, unknown> = {}) {
	return {
		hostId: 'host-1',
		hostname: 'shell.internal',
		port: 22,
		status: 'pinned',
		fingerprint: 'SHA256:test',
		firstSeenAt: '2026-05-15T10:00:00.000Z',
		lastSeenAt: '2026-05-15T10:00:00.000Z',
		trust: 'pinned',
		trustOnFirstUse: true,
		productionTofuBlocked: false,
		message: 'SSH host key is pinned for this host.',
		...overrides
	};
}

export function credentialRecord(overrides: Record<string, unknown> = {}) {
	return {
		id: 'cred-1',
		userId: 'user-1',
		workspaceId: null,
		name: 'SSH key',
		kind: 'password',
		username: 'deploy',
		encryptedSecret: 'encrypted',
		encryption: { algorithm: 'aes-256-gcm' },
		metadata: {},
		createdAt: new Date('2026-05-15T10:00:00.000Z'),
		updatedAt: new Date('2026-05-15T10:00:00.000Z'),
		...overrides
	};
}

export function liveSshSessionRecord(overrides: Record<string, unknown> = {}) {
	return {
		id: 'live-1',
		userId: 'user-1',
		hostId: 'host-1',
		title: 'Primary shell',
		status: 'attached',
		startedAt: new Date('2026-05-15T10:00:00.000Z'),
		lastAttachedAt: new Date('2026-05-15T10:00:00.000Z'),
		detachedAt: null,
		expiresAt: new Date('2026-05-15T11:00:00.000Z'),
		endedAt: null,
		errorCode: null,
		errorMessage: null,
		terminalCols: 120,
		terminalRows: 34,
		createdAt: new Date('2026-05-15T10:00:00.000Z'),
		updatedAt: new Date('2026-05-15T10:00:00.000Z'),
		...overrides
	};
}
