import { Client } from 'ssh2';
import type { ProtocolAdapter } from './types';
import { rawDataToBuffer } from './tcp';

export function createSshAdapter(): ProtocolAdapter {
	return {
		protocol: 'ssh',
		handle(socket, ticket) {
			const connection = new Client();
			const credential = ticket.target.credential;
			const username = credential?.username ?? ticket.target.username;

			connection
				.on('ready', () => {
					connection.shell((error, stream) => {
						if (error) {
							socket.close(1011, 'ssh shell failed');
							connection.end();
							return;
						}

						stream.on('data', (chunk: Buffer) => {
							if (socket.readyState === socket.OPEN) socket.send(chunk);
						});
						stream.on('close', () => socket.close(1000, 'ssh shell closed'));

						socket.on('message', (data) => {
							if (typeof data === 'string') {
								stream.write(data);
							} else if (Array.isArray(data)) {
								for (const chunk of data) stream.write(chunk);
							} else {
								stream.write(rawDataToBuffer(data));
							}
						});

						socket.on('close', () => connection.end());
						socket.on('error', () => connection.end());
					});
				})
				.on('error', () => socket.close(1011, 'ssh connection failed'));

			connection.connect({
				host: ticket.target.host,
				port: ticket.target.port,
				username,
				password: credential?.kind === 'password' ? credential.password : undefined,
				privateKey: credential?.kind === 'ssh_key' ? credential.privateKey : undefined,
				passphrase: credential?.kind === 'ssh_key' ? credential.passphrase : undefined
			});
		}
	};
}
