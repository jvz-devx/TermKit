import { describe, expect, it, vi } from 'vitest';
import { LiveSshAttachError } from '../ssh-live/manager';
import { createLiveSshAdapter } from './ssh-live';
import type { ConsumedTicket } from './types';

describe('live SSH protocol adapter', () => {
	it('attaches sockets to the live SSH manager', () => {
		expect.assertions(1);

		const socket = fakeSocket();
		const manager = {
			attach: vi.fn()
		};

		createLiveSshAdapter(manager as never).handle(socket as never, ticket());

		expect(manager.attach).toHaveBeenCalledWith(ticket(), socket);
	});

	it('closes active attachment conflicts with a policy close code', () => {
		expect.assertions(1);

		const socket = fakeSocket();
		const manager = {
			attach() {
				throw new LiveSshAttachError('active attachment', 'active_attachment');
			}
		};

		createLiveSshAdapter(manager as never).handle(socket as never, ticket());

		expect(socket.close).toHaveBeenCalledWith(1008, 'active_attachment');
	});

	it('rethrows unexpected manager failures', () => {
		expect.assertions(1);

		const socket = fakeSocket();
		const manager = {
			attach() {
				throw new Error('boom');
			}
		};

		expect(() => createLiveSshAdapter(manager as never).handle(socket as never, ticket())).toThrow(
			'boom'
		);
	});
});

function fakeSocket() {
	return {
		close: vi.fn()
	};
}

function ticket(): ConsumedTicket {
	return {
		ticketId: 'ticket-1',
		userId: 'user-1',
		hostId: 'host-1',
		protocol: 'ssh',
		target: {
			host: 'shell.example.test',
			port: 22
		}
	};
}
