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

	it('formats protocol labels and fallback codes consistently', () => {
		expect(protocolLabel('ssh_tunnel')).toBe('SSH tunnel');
		expect(protocolLabel('rdp')).toBe('RDP');
		expect(humanizeCode('adapter_hostkeyrejected')).toBe('adapter hostkeyrejected');
	});
});
