import type {
	CredentialRecord,
	HostRecord,
	SessionTicketRecord,
	TermixServicesRepository
} from './types';

export class InMemoryTermixServicesRepository implements TermixServicesRepository {
	private readonly hosts = new Map<string, HostRecord>();
	private readonly credentials = new Map<string, CredentialRecord>();
	private readonly tickets = new Map<string, SessionTicketRecord>();

	async listHosts(userId: string): Promise<HostRecord[]> {
		return [...this.hosts.values()].filter((host) => host.userId === userId);
	}

	async getHost(userId: string, id: string): Promise<HostRecord | null> {
		const host = this.hosts.get(id);
		return host?.userId === userId ? host : null;
	}

	async createHost(host: HostRecord): Promise<HostRecord> {
		this.hosts.set(host.id, host);
		return host;
	}

	async updateHost(
		userId: string,
		id: string,
		patch: Partial<HostRecord>
	): Promise<HostRecord | null> {
		const host = await this.getHost(userId, id);
		if (!host) return null;

		const updated = { ...host, ...patch, id, userId };
		this.hosts.set(id, updated);
		return updated;
	}

	async deleteHost(userId: string, id: string): Promise<boolean> {
		const host = await this.getHost(userId, id);
		if (!host) return false;
		return this.hosts.delete(id);
	}

	async listCredentials(userId: string): Promise<CredentialRecord[]> {
		return [...this.credentials.values()].filter((credential) => credential.userId === userId);
	}

	async getCredential(userId: string, id: string): Promise<CredentialRecord | null> {
		const credential = this.credentials.get(id);
		return credential?.userId === userId ? credential : null;
	}

	async createCredential(credential: CredentialRecord): Promise<CredentialRecord> {
		this.credentials.set(credential.id, credential);
		return credential;
	}

	async updateCredential(
		userId: string,
		id: string,
		patch: Partial<CredentialRecord>
	): Promise<CredentialRecord | null> {
		const credential = await this.getCredential(userId, id);
		if (!credential) return null;

		const updated = { ...credential, ...patch, id, userId };
		this.credentials.set(id, updated);
		return updated;
	}

	async deleteCredential(userId: string, id: string): Promise<boolean> {
		const credential = await this.getCredential(userId, id);
		if (!credential) return false;
		return this.credentials.delete(id);
	}

	async createTicket(ticket: SessionTicketRecord): Promise<SessionTicketRecord> {
		this.tickets.set(ticket.ticketHash, ticket);
		return ticket;
	}

	async getTicketByHash(ticketHash: string): Promise<SessionTicketRecord | null> {
		return this.tickets.get(ticketHash) ?? null;
	}

	async consumeTicket(ticketHash: string, usedAt: Date): Promise<SessionTicketRecord | null> {
		const ticket = await this.getTicketByHash(ticketHash);
		if (!ticket || ticket.usedAt) return null;

		const consumed = { ...ticket, usedAt };
		this.tickets.set(ticketHash, consumed);
		return consumed;
	}
}

export const termixRepository = new InMemoryTermixServicesRepository();
