import { and, eq, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { microsoftInvitations } from '$lib/server/db/schema';
import { ServiceValidationError } from './errors';

type InvitationClient = Pick<typeof db, 'select' | 'insert' | 'update'>;

export class MicrosoftInvitationRequiredError extends Error {
	readonly status = 403;

	constructor(message = 'A Microsoft invitation is required for this account') {
		super(message);
		this.name = 'MicrosoftInvitationRequiredError';
	}
}

export type MicrosoftInvitation = typeof microsoftInvitations.$inferSelect;

export function normalizeMicrosoftInvitationEmail(value: unknown): string {
	const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
	if (!email) throw new ServiceValidationError(['email is required']);
	if (!isEmailAddress(email)) throw new ServiceValidationError(['email must be a valid address']);
	return email;
}

export function assertMicrosoftInvitationDomain(email: string, allowedDomains: string[]): void {
	const domain = email.split('@')[1] ?? '';
	if (!allowedDomains.includes(domain)) {
		throw new ServiceValidationError(['email domain is not allowed for Microsoft sign-in']);
	}
}

export async function listMicrosoftInvitations(): Promise<MicrosoftInvitation[]> {
	return db.select().from(microsoftInvitations).orderBy(microsoftInvitations.email);
}

export async function createMicrosoftInvitation(input: {
	email: unknown;
	isAdmin: unknown;
	invitedByUserId: string;
	allowedDomains: string[];
}): Promise<void> {
	const email = normalizeMicrosoftInvitationEmail(input.email);
	assertMicrosoftInvitationDomain(email, input.allowedDomains);

	const existing = await findInvitationByEmail(email);
	const now = new Date();
	const isAdmin = input.isAdmin === true;

	if (existing?.acceptedAt) {
		throw new ServiceValidationError(['invitation has already been accepted']);
	}

	if (existing) {
		await db
			.update(microsoftInvitations)
			.set({
				isAdmin,
				invitedByUserId: input.invitedByUserId,
				revokedAt: null,
				updatedAt: now
			})
			.where(eq(microsoftInvitations.id, existing.id));
		return;
	}

	await db.insert(microsoftInvitations).values({
		email,
		isAdmin,
		invitedByUserId: input.invitedByUserId
	});
}

export async function revokeMicrosoftInvitation(invitationId: unknown): Promise<void> {
	const id = typeof invitationId === 'string' ? invitationId : '';
	if (!id) throw new ServiceValidationError(['invitationId is required']);

	const [invitation] = await db
		.select()
		.from(microsoftInvitations)
		.where(eq(microsoftInvitations.id, id))
		.limit(1);

	if (!invitation) throw new ServiceValidationError(['invitation was not found']);
	if (invitation.acceptedAt) {
		throw new ServiceValidationError([
			'accepted invitations cannot be revoked; disable the user instead'
		]);
	}

	const now = new Date();
	await db
		.update(microsoftInvitations)
		.set({ revokedAt: now, updatedAt: now })
		.where(eq(microsoftInvitations.id, id));
}

export async function requireActiveMicrosoftInvitation(
	email: string,
	client: InvitationClient = db
): Promise<MicrosoftInvitation> {
	const [invitation] = await client
		.select()
		.from(microsoftInvitations)
		.where(
			and(
				eq(microsoftInvitations.email, email),
				isNull(microsoftInvitations.acceptedAt),
				isNull(microsoftInvitations.revokedAt)
			)
		)
		.limit(1);

	if (!invitation) throw new MicrosoftInvitationRequiredError();
	return invitation;
}

export async function markMicrosoftInvitationAccepted(input: {
	email: string;
	userId: string;
	client?: InvitationClient;
}): Promise<void> {
	const client = input.client ?? db;
	const now = new Date();

	await client
		.update(microsoftInvitations)
		.set({
			acceptedUserId: input.userId,
			acceptedAt: now,
			updatedAt: now
		})
		.where(
			and(
				eq(microsoftInvitations.email, input.email),
				isNull(microsoftInvitations.acceptedAt),
				isNull(microsoftInvitations.revokedAt)
			)
		);
}

async function findInvitationByEmail(email: string): Promise<MicrosoftInvitation | null> {
	const [invitation] = await db
		.select()
		.from(microsoftInvitations)
		.where(eq(microsoftInvitations.email, email))
		.limit(1);
	return invitation ?? null;
}

function isEmailAddress(value: string): boolean {
	const [localPart, domain, ...extra] = value.split('@');
	return extra.length === 0 && Boolean(localPart) && Boolean(domain) && isEmailDomain(domain);
}

function isEmailDomain(value: string): boolean {
	return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(
		value
	);
}
