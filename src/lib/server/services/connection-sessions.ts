import { randomUUID } from 'node:crypto';
import { termixRepository } from './repository';
import type { ConnectionSessionRecord, ConnectionSessionRepository, HostProtocol } from './types';

export type StartConnectionSessionInput = {
	userId: string;
	hostId: string | null;
	protocol: HostProtocol;
	now?: Date;
};

export interface ConnectionSessionLifecycleRecorder {
	start(input: StartConnectionSessionInput): Promise<ConnectionSessionRecord>;
	markActive(id: string, now?: Date): Promise<ConnectionSessionRecord | null>;
	end(id: string, now?: Date): Promise<ConnectionSessionRecord | null>;
	fail(id: string, errorCode: string, now?: Date): Promise<ConnectionSessionRecord | null>;
}

export class ConnectionSessionService implements ConnectionSessionLifecycleRecorder {
	constructor(private readonly repository: ConnectionSessionRepository = termixRepository) {}

	async start(input: StartConnectionSessionInput): Promise<ConnectionSessionRecord> {
		const now = input.now ?? new Date();

		return this.repository.createConnectionSession({
			id: randomUUID(),
			userId: input.userId,
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
