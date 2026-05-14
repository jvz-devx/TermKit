import { randomUUID } from 'node:crypto';
import { termixRepository } from './repository';
import type {
	ConnectionHistoryFilters,
	ConnectionHistoryRecord,
	ConnectionSessionRecord,
	ConnectionSessionRepository,
	ConnectionProtocol,
	HostRepository
} from './types';

export type StartConnectionSessionInput = {
	id?: string;
	userId: string;
	hostId: string | null;
	protocol: ConnectionProtocol;
	now?: Date;
};

export interface ConnectionSessionLifecycleRecorder {
	start(input: StartConnectionSessionInput): Promise<ConnectionSessionRecord>;
	markActive(id: string, now?: Date): Promise<ConnectionSessionRecord | null>;
	end(id: string, now?: Date): Promise<ConnectionSessionRecord | null>;
	fail(id: string, errorCode: string, now?: Date): Promise<ConnectionSessionRecord | null>;
}

export class ConnectionSessionService implements ConnectionSessionLifecycleRecorder {
	constructor(
		private readonly repository: ConnectionSessionRepository &
			Pick<HostRepository, 'getHost'> = termixRepository
	) {}

	listHistory(
		userId: string,
		filters?: ConnectionHistoryFilters
	): Promise<ConnectionHistoryRecord[]> {
		return this.repository.listConnectionHistory(userId, filters);
	}

	async start(input: StartConnectionSessionInput): Promise<ConnectionSessionRecord> {
		const now = input.now ?? new Date();
		const host = input.hostId
			? await this.repository.getHost(input.userId, input.hostId).catch(() => null)
			: null;

		return this.repository.createConnectionSession({
			id: input.id ?? randomUUID(),
			userId: input.userId,
			workspaceId: host?.workspaceId ?? null,
			hostId: input.hostId,
			protocol: input.protocol,
			status: 'starting',
			startedAt: now,
			endedAt: null,
			errorCode: null,
			updatedAt: now
		});
	}

	markActive(id: string, now = new Date()): Promise<ConnectionSessionRecord | null> {
		return this.repository.updateConnectionSession(id, {
			status: 'active',
			errorCode: null,
			updatedAt: now
		});
	}

	async markActiveForUser(
		userId: string,
		id: string,
		now = new Date()
	): Promise<ConnectionSessionRecord | null> {
		if (!(await this.isOwnedByUser(userId, id))) return null;
		return this.markActive(id, now);
	}

	end(id: string, now = new Date()): Promise<ConnectionSessionRecord | null> {
		return this.repository.updateConnectionSession(id, {
			status: 'ended',
			endedAt: now,
			errorCode: null,
			updatedAt: now
		});
	}

	async endForUser(
		userId: string,
		id: string,
		now = new Date()
	): Promise<ConnectionSessionRecord | null> {
		if (!(await this.isOwnedByUser(userId, id))) return null;
		return this.end(id, now);
	}

	fail(id: string, errorCode: string, now = new Date()): Promise<ConnectionSessionRecord | null> {
		return this.repository.updateConnectionSession(id, {
			status: 'failed',
			endedAt: now,
			errorCode,
			updatedAt: now
		});
	}

	async failForUser(
		userId: string,
		id: string,
		errorCode: string,
		now = new Date()
	): Promise<ConnectionSessionRecord | null> {
		if (!(await this.isOwnedByUser(userId, id))) return null;
		return this.fail(id, errorCode, now);
	}

	private async isOwnedByUser(userId: string, id: string): Promise<boolean> {
		const session = await this.repository.getConnectionSession(id);
		return session?.userId === userId;
	}
}

export const connectionSessionService = new ConnectionSessionService();
