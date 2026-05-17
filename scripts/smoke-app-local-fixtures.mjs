import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createFtpFixtureServer, createSshFixtureServer } from './smoke-app-protocol-fixtures.mjs';
import {
	createTelnetFixtureServer,
	createVncFixtureServer
} from './smoke-app-terminal-fixtures.mjs';
import { closeServer, listen } from './smoke-app-runtime.mjs';

export async function startProtocolFixtures({ tempDir, execFile }) {
	const sshServer = createSshFixtureServer();
	const ftp = createFtpFixtureServer({
		label: 'ftp',
		files: new Map([['/ftp-smoke.txt', Buffer.from('hello-from-ftp\n')]])
	});
	const ftpsIdentity = await createTemporaryTlsIdentity({ tempDir, execFile });
	const ftps = createFtpFixtureServer({
		label: 'ftps',
		files: new Map([['/ftps-smoke.txt', Buffer.from('hello-from-ftps\n')]]),
		tls: ftpsIdentity
	});
	const telnet = createTelnetFixtureServer();
	const vnc = createVncFixtureServer();

	await Promise.all([
		listen(sshServer),
		listen(ftp.server),
		listen(ftps.server),
		listen(telnet.server),
		listen(vnc.server)
	]);

	return {
		sshPort: sshServer.address().port,
		ftpPort: ftp.server.address().port,
		ftpsPort: ftps.server.address().port,
		ftpsState: ftps.state,
		telnetPort: telnet.server.address().port,
		vncPort: vnc.server.address().port,
		telnetState: telnet.state,
		vncState: vnc.state,
		closeVncClients: () => vnc.server.closeAllClients?.(),
		summary: `ssh:${sshServer.address().port} ftp:${ftp.server.address().port} ftps:${ftps.server.address().port} telnet:${telnet.server.address().port} vnc:${vnc.server.address().port}`,
		close: async () => {
			await Promise.all([
				closeServer(sshServer),
				closeServer(ftp.server),
				closeServer(ftps.server),
				closeServer(telnet.server),
				closeServer(vnc.server)
			]);
		}
	};
}

async function createTemporaryTlsIdentity({ tempDir, execFile }) {
	const keyPath = join(tempDir, 'ftps-key.pem');
	const certPath = join(tempDir, 'ftps-cert.pem');
	await execFile('openssl', [
		'req',
		'-x509',
		'-newkey',
		'rsa:2048',
		'-keyout',
		keyPath,
		'-out',
		certPath,
		'-nodes',
		'-days',
		'1',
		'-subj',
		'/CN=127.0.0.1',
		'-addext',
		'subjectAltName=IP:127.0.0.1'
	]);
	const [key, cert] = await Promise.all([readFile(keyPath), readFile(certPath)]);
	return { key, cert };
}
