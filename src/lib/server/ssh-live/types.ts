import type { ConsumedTicket } from '$lib/server/protocols';

export type SshAttachTicket = {
	ticketId: string;
	userId: string;
	sshLiveSessionId: string;
	session: ConsumedTicket;
	terminalCols: number;
	terminalRows: number;
};
