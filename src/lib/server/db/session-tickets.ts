import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { db } from './index';
import { hostProtocol, sessionTickets } from './schema';

type HostProtocol = (typeof hostProtocol.enumValues)[number];

export function hashTicket(ticket: string): string {
	return createHash('sha256').update(ticket).digest('base64url');
}

export async function createSessionTicket(input: {
	userId: string;
	hostId: string;
	protocol: HostProtocol;
	target?: Record<string, unknown>;
	expiresInSeconds?: number;
}): Promise<{ ticket: string; row: typeof sessionTickets.$inferSelect }> {
	const ticket = randomBytes(32).toString('base64url');
	const expiresAt = new Date(Date.now() + (input.expiresInSeconds ?? 60) * 1000);
	const [row] = await db
		.insert(sessionTickets)
		.values({
			userId: input.userId,
			hostId: input.hostId,
			protocol: input.protocol,
			ticketHash: hashTicket(ticket),
			target: input.target ?? {},
			expiresAt
		})
		.returning();

	if (!row) {
		throw new Error('Could not create session ticket');
	}

	return { ticket, row };
}

export async function consumeSessionTicket(
	ticket: string
): Promise<typeof sessionTickets.$inferSelect | null> {
	const [row] = await db
		.update(sessionTickets)
		.set({ consumedAt: new Date() })
		.where(
			and(
				eq(sessionTickets.ticketHash, hashTicket(ticket)),
				gt(sessionTickets.expiresAt, new Date()),
				isNull(sessionTickets.consumedAt)
			)
		)
		.returning();

	return row ?? null;
}
