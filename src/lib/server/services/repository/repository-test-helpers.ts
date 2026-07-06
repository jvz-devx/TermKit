import { vi } from 'vitest';
import type { TermixDb } from '../../db';
import type {
	ConnectionSessionPatch,
	ConnectionSessionRecord,
	CredentialRecord,
	HostRecord,
	SessionTicketRecord,
	SshAttachTicketRecord,
	SshLiveSessionRecord,
	SshTunnelProfileRecord,
	SshTunnelSessionRecord,
	WorkspaceLayoutRecord,
	WorkspaceMembershipRecord,
	WorkspaceRecord
} from '../types';
import type { TerminalRecordingRecord } from '../v5-resources';

export function workspace(patch: Partial<WorkspaceRecord> = {}): WorkspaceRecord {
	const now = new Date('2026-05-15T10:00:00.000Z');
	return {
		id: 'workspace-1',
		name: 'Workspace',
		metadata: {},
		createdAt: now,
		updatedAt: now,
		...patch
	};
}

export function membership(
	patch: Partial<WorkspaceMembershipRecord> = {}
): WorkspaceMembershipRecord {
	const now = new Date('2026-05-15T10:00:00.000Z');
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

export function host(patch: Partial<HostRecord> = {}): HostRecord {
	const now = new Date('2026-05-15T10:00:00.000Z');
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

export function credential(patch: Partial<CredentialRecord> = {}): CredentialRecord {
	const now = new Date('2026-05-15T10:00:00.000Z');
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

export function session(patch: Partial<ConnectionSessionRecord> = {}): ConnectionSessionRecord {
	const now = new Date('2026-05-15T10:00:00.000Z');
	return {
		id: 'connection-session-1',
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

export function connectionSessionPatch(patch: ConnectionSessionPatch = {}): ConnectionSessionPatch {
	return patch;
}

export function ticket(patch: Partial<SessionTicketRecord> = {}): SessionTicketRecord {
	const now = new Date('2026-05-15T10:00:00.000Z');
	return {
		id: 'ticket-1',
		ticketHash: 'ticket-hash-1',
		userId: 'owner-1',
		hostId: 'host-1',
		protocol: 'ssh',
		target: 'ssh:shell.example.test:22',
		expiresAt: new Date('2026-05-15T10:05:00.000Z'),
		usedAt: null,
		createdAt: now,
		...patch
	};
}

export function sshTunnelProfile(
	patch: Partial<SshTunnelProfileRecord> = {}
): SshTunnelProfileRecord {
	const now = new Date('2026-05-15T10:00:00.000Z');
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
	const now = new Date('2026-05-15T10:00:00.000Z');
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

export function sshLiveSession(patch: Partial<SshLiveSessionRecord> = {}): SshLiveSessionRecord {
	const now = new Date('2026-05-15T10:00:00.000Z');
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
	const now = new Date('2026-05-15T10:00:00.000Z');
	return {
		id: 'attach-ticket-1',
		userId: 'owner-1',
		sshLiveSessionId: 'live-session-1',
		ticketHash: 'attach-ticket-hash-1',
		expiresAt: new Date('2026-05-15T10:01:00.000Z'),
		consumedAt: null,
		createdAt: now,
		...patch
	};
}

export function workspaceLayout(patch: Partial<WorkspaceLayoutRecord> = {}): WorkspaceLayoutRecord {
	const now = new Date('2026-05-15T10:00:00.000Z');
	return {
		id: 'layout-1',
		userId: 'member-1',
		workspaceId: null,
		layoutKind: 'split',
		panes: [],
		createdAt: now,
		updatedAt: now,
		...patch
	};
}

type DrizzleOperation = 'select' | 'insert' | 'update' | 'delete';

interface DrizzleMockCall {
	operation: DrizzleOperation;
	table: unknown;
	values?: unknown;
	where?: unknown;
	limit?: number;
	returning?: unknown;
}

export interface DrizzleDbMockOptions {
	selectRows?: Map<unknown, unknown[]>;
	insertRows?: Map<unknown, unknown[][]>;
	updateRows?: Map<unknown, unknown[][]>;
	deleteRows?: Map<unknown, unknown[]>;
}

export function createDrizzleDbMock(options: DrizzleDbMockOptions = {}): {
	database: TermixDb;
	calls: DrizzleMockCall[];
} {
	const calls: DrizzleMockCall[] = [];
	const insertRows = cloneRowQueues(options.insertRows);
	const updateRows = cloneRowQueues(options.updateRows);

	const database = {
		select: vi.fn(() => ({
			from: vi.fn((table: unknown) => {
				const call: DrizzleMockCall = { operation: 'select', table };
				calls.push(call);
				return {
					where: vi.fn((condition: unknown) => {
						call.where = condition;
						return awaitableRows(options.selectRows?.get(table) ?? [], call);
					})
				};
			})
		})),
		insert: vi.fn((table: unknown) => ({
			values: vi.fn((values: unknown) => {
				const call: DrizzleMockCall = { operation: 'insert', table, values };
				calls.push(call);
				return {
					returning: vi.fn((fields?: unknown) => {
						call.returning = fields;
						return Promise.resolve(takeQueuedRows(insertRows, table));
					})
				};
			})
		})),
		update: vi.fn((table: unknown) => ({
			set: vi.fn((values: unknown) => {
				const call: DrizzleMockCall = { operation: 'update', table, values };
				calls.push(call);
				return {
					where: vi.fn((condition: unknown) => {
						call.where = condition;
						return {
							returning: vi.fn((fields?: unknown) => {
								call.returning = fields;
								return Promise.resolve(takeQueuedRows(updateRows, table));
							})
						};
					})
				};
			})
		})),
		delete: vi.fn((table: unknown) => ({
			where: vi.fn((condition: unknown) => {
				const call: DrizzleMockCall = { operation: 'delete', table, where: condition };
				calls.push(call);
				return {
					returning: vi.fn((fields?: unknown) => {
						call.returning = fields;
						return Promise.resolve(options.deleteRows?.get(table) ?? []);
					})
				};
			})
		}))
	} as unknown as TermixDb;

	return { database, calls };
}

export function awaitableRows(
	rows: unknown[],
	call: DrizzleMockCall
): {
	limit: (count: number) => Promise<unknown[]>;
	then: Promise<unknown[]>['then'];
} {
	const promise = Promise.resolve(rows);
	return {
		limit: vi.fn((count: number) => {
			call.limit = count;
			return Promise.resolve(rows.slice(0, count));
		}),
		then: promise.then.bind(promise)
	};
}

export function cloneRowQueues(rowQueues?: Map<unknown, unknown[][]>): Map<unknown, unknown[][]> {
	return new Map([...(rowQueues?.entries() ?? [])].map(([table, rows]) => [table, [...rows]]));
}

export function takeQueuedRows(rowQueues: Map<unknown, unknown[][]>, table: unknown): unknown[] {
	const queue = rowQueues.get(table);
	return queue?.shift() ?? [];
}

export function operationCall(
	calls: DrizzleMockCall[],
	operation: DrizzleOperation,
	table: unknown,
	index = 0
): DrizzleMockCall {
	const call = calls.filter((item) => item.operation === operation && item.table === table)[index];
	if (!call) throw new Error(`Missing ${operation} call for mocked Drizzle table`);
	return call;
}

export function terminalRecording(
	patch: Partial<TerminalRecordingRecord> = {}
): TerminalRecordingRecord {
	const now = new Date('2026-05-15T10:00:00.000Z');
	return {
		id: 'recording-1',
		userId: 'user-1',
		hostId: 'host-1',
		connectionSessionId: null,
		sshLiveSessionId: null,
		status: 'recording',
		storageKey: 'recordings/recording-1.cast',
		startedAt: now,
		endedAt: null,
		retentionExpiresAt: null,
		metadata: {},
		createdAt: now,
		updatedAt: now,
		...patch
	};
}
