import { describe, expect, it } from 'vitest';
import { createRdpGatewayAdapter } from './rdp';
import type { ConsumedTicket } from './types';

describe('RDP protocol adapter', () => {
	it('rejects direct websocket use with a Gateway bootstrap message', () => {
		const messages: string[] = [];
		const closes: Array<{ code: number; reason: string }> = [];
		const adapter = createRdpGatewayAdapter();

		adapter.handle(
			{
				send(message: string) {
					messages.push(message);
				},
				close(code: number, reason: string) {
					closes.push({ code, reason });
				}
			} as never,
			testTicket()
		);

		expect(messages.map((message) => JSON.parse(message))).toEqual([
			{
				type: 'rdp-gateway-bootstrap-required',
				message:
					'RDP sessions are provisioned through Devolutions Gateway during launch; this websocket route is not used for RDP.'
			}
		]);
		expect(messages.join(' ')).not.toContain('placeholder');
		expect(closes).toEqual([{ code: 1008, reason: 'rdp gateway bootstrap required' }]);
	});
});

function testTicket(): ConsumedTicket {
	return {
		ticketId: 'ticket-1',
		userId: 'user-1',
		hostId: 'host-1',
		protocol: 'rdp',
		target: {
			host: 'windows.example.test',
			port: 3389
		}
	};
}
