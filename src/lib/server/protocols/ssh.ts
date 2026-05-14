import { Client, type ClientChannel } from 'ssh2';
import { connectTrustedSsh } from './ssh-connect';
import { type SshHostKeyTrustError } from './ssh-host-trust';
import type { ProtocolAdapter } from './types';
import { parseTerminalControlFrame, rawDataToBuffer, type TerminalSize } from './tcp';

export function createSshAdapter(): ProtocolAdapter {
	return {
		protocol: 'ssh',
		async handle(socket, ticket) {
			let connection: Client | null = null;
			const credential = ticket.target.credential;
			let terminalSize: TerminalSize = { cols: 80, rows: 24 };
			let shellStream: ClientChannel | undefined;
			let hostKeyTrustError: SshHostKeyTrustError | undefined;

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
			socket.on('close', () => connection?.end());
			socket.on('error', () => connection?.end());

			try {
				connection = await connectTrustedSsh(
					{
						userId: ticket.userId,
						hostId: ticket.hostId,
						...ticket.target,
						credential,
						username: credential?.username ?? ticket.target.username
					},
					{
						onHostKeyTrustFailure(error) {
							hostKeyTrustError = error;
						}
					}
				);
			} catch {
				if (socket.readyState === socket.OPEN) {
					socket.close(
						1011,
						hostKeyTrustError ? 'ssh host key not trusted' : 'ssh connection failed'
					);
				}
				return;
			}

			connection.on('error', () => {
				socket.close(
					1011,
					hostKeyTrustError ? 'ssh host key not trusted' : 'ssh connection failed'
				);
			});

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
						connection?.end();
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
		}
	};
}
