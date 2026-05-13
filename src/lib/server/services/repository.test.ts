import { describe, expect, it } from 'vitest';
import type { TermixDb } from '../db';
import { DrizzleTermixServicesRepository } from './repository';

function queryResult<T>(rows: T[]) {
	return {
		limit: (count: number) => Promise.resolve(rows.slice(0, count)),
		then: Promise.resolve(rows).then.bind(Promise.resolve(rows))
	};
}

function fakeSelectDb<T>(rows: T[]): TermixDb {
	return {
		select: () => ({
			from: () => ({
				where: () => queryResult(rows)
			})
		})
	} as unknown as TermixDb;
}

function fakeInsertDb<T>(rows: T[], capture: (values: unknown) => void): TermixDb {
	return {
		insert: () => ({
			values: (values: unknown) => {
				capture(values);
				return {
					returning: () => Promise.resolve(rows)
				};
			}
		})
	} as unknown as TermixDb;
}

describe('DrizzleTermixServicesRepository', () => {
	it('maps credential rows to service records', async () => {
		expect.assertions(1);

		const now = new Date('2026-05-13T12:00:00.000Z');
		const encryptionMetadata = {
			algorithm: 'aes-256-gcm' as const,
			keyVersion: 3,
			iv: 'iv',
			authTag: 'auth-tag',
			salt: 'salt'
		};
		const repository = new DrizzleTermixServicesRepository(
			fakeSelectDb([
				{
					id: 'credential-1',
					userId: 'user-1',
					name: 'Prod password',
					kind: 'password',
					username: 'root',
					encryptedSecret: 'ciphertext',
					encryptionMetadata,
					metadata: { source: 'test' },
					createdAt: now,
					updatedAt: now
				}
			])
		);

		await expect(repository.listCredentials('user-1')).resolves.toEqual([
			{
				id: 'credential-1',
				userId: 'user-1',
				name: 'Prod password',
				kind: 'password',
				username: 'root',
				encryptedSecret: 'ciphertext',
				encryption: encryptionMetadata,
				metadata: { source: 'test' },
				createdAt: now,
				updatedAt: now
			}
		]);
	});

	it('maps session ticket targets between service strings and db json', async () => {
		expect.assertions(3);

		const now = new Date('2026-05-13T12:00:00.000Z');
		let capturedValues: unknown;
		const repository = new DrizzleTermixServicesRepository(
			fakeInsertDb(
				[
					{
						id: 'ticket-1',
						ticketHash: 'ticket-hash',
						userId: 'user-1',
						hostId: 'host-1',
						protocol: 'ssh',
						target: { value: 'ssh:shell.example.test:22' },
						expiresAt: new Date('2026-05-13T12:01:00.000Z'),
						consumedAt: null,
						createdAt: now
					}
				],
				(values) => {
					capturedValues = values;
				}
			)
		);

		const ticket = await repository.createTicket({
			id: 'ticket-1',
			ticketHash: 'ticket-hash',
			userId: 'user-1',
			hostId: 'host-1',
			protocol: 'ssh',
			target: 'ssh:shell.example.test:22',
			expiresAt: new Date('2026-05-13T12:01:00.000Z'),
			usedAt: null,
			createdAt: now
		});

		expect(capturedValues).toMatchObject({ target: { value: 'ssh:shell.example.test:22' } });
		expect(ticket.target).toBe('ssh:shell.example.test:22');
		expect(ticket.usedAt).toBeNull();
	});
});
