import type { ProtocolAdapter } from './types';
import { liveSshManager, LiveSshAttachError, type LiveSshManager } from '../ssh-live/manager';

export function createLiveSshAdapter(manager: LiveSshManager = liveSshManager): ProtocolAdapter {
	return {
		protocol: 'ssh',
		handle(socket, ticket) {
			try {
				manager.attach(ticket, socket);
			} catch (error) {
				if (error instanceof LiveSshAttachError) {
					const closeCode = error.code === 'active_attachment' ? 1008 : 1011;
					socket.close(closeCode, error.code);
					return;
				}
				throw error;
			}
		}
	};
}
