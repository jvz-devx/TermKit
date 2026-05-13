import type { ProtocolAdapter } from './types';

export function createRdpGatewayAdapter(): ProtocolAdapter {
	return {
		protocol: 'rdp',
		handle(socket) {
			socket.send(
				JSON.stringify({
					type: 'rdp-gateway-bootstrap-required',
					message:
						'RDP sessions are provisioned through Devolutions Gateway during launch; this websocket route is not used for RDP.'
				})
			);
			socket.close(1008, 'rdp gateway bootstrap required');
		}
	};
}

export const createRdpGatewayPlaceholderAdapter = createRdpGatewayAdapter;
