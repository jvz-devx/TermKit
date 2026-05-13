import type { ProtocolAdapter } from './types';

export function createRdpGatewayPlaceholderAdapter(): ProtocolAdapter {
	return {
		protocol: 'rdp',
		handle(socket) {
			socket.send(
				JSON.stringify({
					type: 'rdp-gateway-placeholder',
					message: 'RDP websocket accepted; Devolutions Gateway bootstrap is not wired yet.'
				})
			);
			socket.close(1013, 'rdp gateway bootstrap pending');
		}
	};
}
