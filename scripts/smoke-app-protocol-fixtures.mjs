import { createRequire } from 'node:module';
import { createFileFixtureHelpers } from './smoke-app-file-fixtures.mjs';

const require = createRequire(import.meta.url);
const { Server: SshServer, utils } = require('ssh2');

export const { createFtpFixtureServer, installSftpFixtureServer } = createFileFixtureHelpers(
	utils.sftp.STATUS_CODE
);

export function createSshFixtureServer() {
	const files = new Map([['/smoke.txt', Buffer.from('hello-from-sftp\n')]]);
	const directories = new Set(['/']);
	const clients = new Set();
	const hostKeys = [utils.generateKeyPairSync('ed25519').private];
	const server = new SshServer({ hostKeys }, (client) => {
		clients.add(client);
		client.once('close', () => clients.delete(client));
		client
			.on('error', () => clients.delete(client))
			.on('authentication', (context) => {
				if (
					context.method === 'password' &&
					context.username === 'smoke' &&
					context.password === 'smoke-password'
				) {
					context.accept();
					return;
				}
				context.reject();
			})
			.on('ready', () => {
				client.on('session', (accept) => {
					const session = accept();
					session.on('pty', (acceptPty) => acceptPty?.());
					session.on('shell', (acceptShell) => {
						const stream = acceptShell();
						stream.write('ssh-ready\n');
						stream.on('data', (chunk) => {
							if (chunk.includes(Buffer.from('smoke-shell'))) {
								stream.write('ssh-echo:smoke-shell\n');
								stream.exit(0);
								stream.end();
							}
						});
					});
					session.on('sftp', (acceptSftp) =>
						installSftpFixtureServer(acceptSftp(), { files, directories })
					);
				});
			});
	});

	server.closeAllClients = () => {
		for (const client of clients) client.end();
		clients.clear();
	};
	return server;
}
