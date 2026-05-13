import type { ProtocolAdapter } from './types';
import { connectTcpTarget, proxyTcpBytes } from './tcp';

export function createVncAdapter(): ProtocolAdapter {
	return {
		protocol: 'vnc',
		handle(socket, ticket) {
			const target = connectTcpTarget(ticket.target.host, ticket.target.port);
			proxyTcpBytes(socket, target);
		}
	};
}
