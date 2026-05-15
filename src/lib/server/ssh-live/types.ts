import type { ConsumedTicket } from '$lib/server/protocols';

export type SshAttachTicket = {
	ticketId: string;
	userId: string;
	sshLiveSessionId: string;
	consumedAt?: Date;
	sessionStatus: 'starting' | 'attached' | 'detached';
	session: ConsumedTicket;
	terminalCols: number;
	terminalRows: number;
};
