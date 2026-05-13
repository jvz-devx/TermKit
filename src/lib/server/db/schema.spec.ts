import { describe, expect, it } from 'vitest';
import { getTableName } from 'drizzle-orm';
import {
	connectionSessions,
	credentials,
	hostProtocol,
	hosts,
	sessionTickets,
	sessions,
	users
} from './schema';

describe('core schema', () => {
	it('defines the V1 protocol enum values', () => {
		expect.assertions(1);

		expect(hostProtocol.enumValues).toEqual(['ssh', 'rdp', 'vnc', 'telnet']);
	});

	it('uses the expected core table names', () => {
		expect.assertions(6);

		expect(getTableName(users)).toBe('users');
		expect(getTableName(sessions)).toBe('sessions');
		expect(getTableName(hosts)).toBe('hosts');
		expect(getTableName(credentials)).toBe('credentials');
		expect(getTableName(connectionSessions)).toBe('connection_sessions');
		expect(getTableName(sessionTickets)).toBe('session_tickets');
	});
});
