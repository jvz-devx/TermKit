import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMock = vi.hoisted(() => ({
	insertRows: [] as unknown[],
	updateRows: [] as unknown[],
	insertedValues: undefined as unknown,
	updatePatch: undefined as unknown,
	whereCalls: 0,
	insert: vi.fn(() => ({
		values: vi.fn((values: unknown) => {
			dbMock.insertedValues = values;
			return {
				returning: vi.fn(async () => dbMock.insertRows)
			};
		})
	})),
	update: vi.fn(() => ({
		set: vi.fn((patch: unknown) => {
			dbMock.updatePatch = patch;
			return {
				where: vi.fn(() => {
					dbMock.whereCalls += 1;
					return {
						returning: vi.fn(async () => dbMock.updateRows)
					};
				})
			};
		})
	}))
}));

vi.mock('./index', () => ({
	db: {
		insert: dbMock.insert,
		update: dbMock.update
	}
}));

import { consumeSessionTicket, createSessionTicket, hashTicket } from './session-tickets';

describe('db session tickets', () => {
	beforeEach(() => {
		vi.useRealTimers();
		dbMock.insertRows = [];
		dbMock.updateRows = [];
		dbMock.insertedValues = undefined;
		dbMock.updatePatch = undefined;
		dbMock.whereCalls = 0;
		dbMock.insert.mockClear();
		dbMock.update.mockClear();
	});

	it('hashes tickets deterministically without exposing raw ticket material', () => {
		expect.assertions(3);

		const hash = hashTicket('ticket-value');

		expect(hash).toBe(hashTicket('ticket-value'));
		expect(hash).not.toBe('ticket-value');
		expect(hash).toMatch(/^[A-Za-z0-9_-]+$/);
	});

	it('creates ticket rows with default targets, hashes, and caller supplied expiry', async () => {
		expect.assertions(8);

		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-05-14T12:00:00.000Z'));
		const row = {
			id: 'ticket-row-1',
			userId: 'user-1',
			hostId: 'host-1',
			protocol: 'ssh',
			ticketHash: 'persisted-hash',
			target: {},
			expiresAt: new Date('2026-05-14T12:02:00.000Z'),
			consumedAt: null,
			createdAt: new Date('2026-05-14T12:00:00.000Z')
		};
		dbMock.insertRows = [row];

		const created = await createSessionTicket({
			userId: 'user-1',
			hostId: 'host-1',
			protocol: 'ssh',
			expiresInSeconds: 120
		});

		expect(created.row).toBe(row);
		expect(created.ticket).toEqual(expect.any(String));
		expect(created.ticket).not.toBe(row.ticketHash);
		expect(dbMock.insert).toHaveBeenCalledTimes(1);
		expect(dbMock.insertedValues).toMatchObject({
			userId: 'user-1',
			hostId: 'host-1',
			protocol: 'ssh',
			target: {},
			expiresAt: new Date('2026-05-14T12:02:00.000Z')
		});
		expect(dbMock.insertedValues).toMatchObject({
			ticketHash: hashTicket(created.ticket)
		});
		expect(JSON.stringify(dbMock.insertedValues)).not.toContain(created.ticket);
		expect(created.ticket).toHaveLength(43);
	});

	it('persists supplied ticket targets and reports empty insert failures', async () => {
		expect.assertions(3);

		dbMock.insertRows = [
			{
				id: 'ticket-row-2',
				userId: 'user-1',
				hostId: 'host-1',
				protocol: 'rdp',
				ticketHash: 'persisted-hash',
				target: { width: 1920 },
				expiresAt: new Date(),
				consumedAt: null,
				createdAt: new Date()
			}
		];

		await createSessionTicket({
			userId: 'user-1',
			hostId: 'host-1',
			protocol: 'rdp',
			target: { width: 1920 }
		});
		expect(dbMock.insertedValues).toMatchObject({ target: { width: 1920 } });

		dbMock.insertRows = [];
		await expect(
			createSessionTicket({
				userId: 'user-1',
				hostId: 'host-1',
				protocol: 'vnc'
			})
		).rejects.toThrow('Could not create session ticket');
		expect(dbMock.insert).toHaveBeenCalledTimes(2);
	});

	it('consumes only matching unexpired unused tickets and returns null when none update', async () => {
		expect.assertions(6);

		const consumedAt = new Date('2026-05-14T12:00:00.000Z');
		vi.useFakeTimers();
		vi.setSystemTime(consumedAt);
		const row = {
			id: 'ticket-row-3',
			userId: 'user-1',
			hostId: 'host-1',
			protocol: 'ssh',
			ticketHash: hashTicket('raw-ticket'),
			target: {},
			expiresAt: new Date('2026-05-14T12:01:00.000Z'),
			consumedAt,
			createdAt: consumedAt
		};
		dbMock.updateRows = [row];

		await expect(consumeSessionTicket('raw-ticket')).resolves.toBe(row);
		expect(dbMock.update).toHaveBeenCalledTimes(1);
		expect(dbMock.updatePatch).toMatchObject({ consumedAt });
		expect(dbMock.whereCalls).toBe(1);

		dbMock.updateRows = [];
		await expect(consumeSessionTicket('raw-ticket')).resolves.toBeNull();
		expect(dbMock.update).toHaveBeenCalledTimes(2);
	});
});
