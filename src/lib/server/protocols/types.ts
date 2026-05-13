import type { WebSocket } from 'ws';

export type Protocol = 'ssh' | 'vnc' | 'telnet' | 'rdp';

export type Credential =
	| {
			kind: 'password';
			username?: string;
			password: string;
	  }
	| {
			kind: 'ssh_key';
			username?: string;
			privateKey: string;
			passphrase?: string;
	  };

export type TicketTarget = {
	host: string;
	port: number;
	username?: string;
	credential?: Credential;
};

export type ConsumedTicket = {
	ticketId: string;
	userId: string;
	hostId: string;
	protocol: Protocol;
	target: TicketTarget;
	metadata?: Record<string, unknown>;
};

export type TicketConsumer = {
	consume(ticket: string, protocol: Protocol, userId?: string): Promise<ConsumedTicket | null>;
};

export type ProtocolAdapter = {
	protocol: Protocol;
	handle(socket: WebSocket, ticket: ConsumedTicket): void | Promise<void>;
};

export const rejectingTicketConsumer: TicketConsumer = {
	async consume() {
		return null;
	}
};
