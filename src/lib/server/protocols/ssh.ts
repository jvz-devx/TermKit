import { Client, type ClientChannel } from 'ssh2';
import type { ProtocolAdapter } from './types';
import { parseTerminalControlFrame, rawDataToBuffer, type TerminalSize } from './tcp';

export function createSshAdapter(): ProtocolAdapter {
	return {
		protocol: 'ssh',
		handle(socket, ticket) {
			const connection = new Client();
			const credential = ticket.target.credential;
			const username = credential?.username ?? ticket.target.username;
			let terminalSize: TerminalSize = { cols: 80, rows: 24 };
			let shellStream: ClientChannel | undefined;

			socket.on('message', (data, isBinary) => {
				if (!isBinary) {
					const control = parseTerminalControlFrame(rawDataToBuffer(data).toString('utf8'));
					if (control?.type === 'terminal.resize') {
						terminalSize = control;
						shellStream?.setWindow(control.rows, control.cols, 0, 0);
					}
					return;
				}

				if (Array.isArray(data)) {
					for (const chunk of data) shellStream?.write(chunk);
					return;
				}

				shellStream?.write(rawDataToBuffer(data));
			});
			socket.on('close', () => connection.end());
			socket.on('error', () => connection.end());

			connection
				.on('ready', () => {
					connection.shell(
						{
							term: 'xterm-256color',
							cols: terminalSize.cols,
							rows: terminalSize.rows,
							width: 0,
							height: 0
						},
						(error, stream) => {
							if (error) {
								socket.close(1011, 'ssh shell failed');
								connection.end();
								return;
							}

							shellStream = stream;
							stream.on('data', (chunk: Buffer) => {
								if (socket.readyState === socket.OPEN) socket.send(chunk);
							});
							stream.on('close', () => {
								if (socket.readyState === socket.OPEN) socket.close(1000, 'ssh shell closed');
							});
						}
					);
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
