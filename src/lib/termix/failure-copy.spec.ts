import { describe, expect, it } from 'vitest';
import { failureCopy, failureDetail, humanizeCode, protocolLabel } from './failure-copy';

describe('failure copy helpers', () => {
	it('maps raw transport codes to user-facing explanations', () => {
		expect(failureCopy({ protocol: 'telnet', code: 'websocket_close_1011' })).toMatchObject({
			title: 'Target connection failed',
			nextStep: expect.stringContaining('host address')
		});
	});

	it('keeps raw codes as diagnostics rather than primary text', () => {
		const copy = failureCopy({ protocol: 'ssh', code: 'ssh_host_key_not_trusted' });

		expect(copy.title).toBe('Host key is not trusted');
		expect(failureDetail(copy)).toContain('Enroll the host key');
		expect(copy.diagnostic).toBe('code: ssh_host_key_not_trusted');
	});

	it('maps proxy backend availability failures to gateway recovery copy', () => {
		const copy = failureCopy({ protocol: 'sftp', message: 'no available server' });

		expect(copy.title).toBe('Gateway session failed');
		expect(failureDetail(copy)).toContain('service is healthy');
		expect(copy.diagnostic).toBe('message: no available server');
	});

	it('maps credential, timeout, shell, ticket, and policy failures', () => {
		expect(failureCopy({ protocol: 'rdp', message: 'logon failure' }).title).toBe(
			'Authentication failed'
		);
		expect(failureCopy({ protocol: 'vnc', message: 'timed out' }).title).toBe(
			'Connection timed out'
		);
		expect(failureCopy({ protocol: 'ssh', message: 'shell request failed' }).title).toBe(
			'Shell failed to open'
		);
		expect(failureCopy({ protocol: 'rdp', message: 'ticket expired' }).title).toBe(
			'Session ticket failed'
		);
		expect(failureCopy({ protocol: 'ftp', message: 'forbidden' }).title).toBe('Action blocked');
	});

	it('uses fallback copy for unknown failures and hides code-like messages', () => {
		expect(failureCopy({ protocol: null, message: 'remote closed the socket' })).toMatchObject({
			title: 'Session failed',
			detail: 'remote closed the socket'
		});
		expect(
			failureCopy({
				protocol: undefined,
				message: 'proxy_closed',
				fallbackTitle: 'Launch failed'
			})
		).toMatchObject({
			title: 'Target connection failed',
			diagnostic: 'message: proxy_closed'
		});
		expect(failureCopy({ protocol: 'ftp', message: 'unknown_code' })).toMatchObject({
			title: 'FTP failed',
			detail: 'FTP failed before it became usable.'
		});
	});

	it('formats protocol labels and fallback codes consistently', () => {
		expect(protocolLabel(null)).toBe('Session');
		expect(protocolLabel('ssh_tunnel')).toBe('SSH tunnel');
		expect(protocolLabel('rdp')).toBe('RDP');
		expect(humanizeCode(null)).toBe('No diagnostic code recorded');
		expect(humanizeCode('adapter_hostkeyrejected')).toBe('adapter hostkeyrejected');
	});
});
