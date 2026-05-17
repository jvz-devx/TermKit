import { describe, expect, it } from 'vitest';
import {
	adminFailureDetail,
	adminFailureTitle,
	adminProtocolLabel,
	formatAdminDuration,
	isV4AdminProtocol
} from './admin-visibility';
import type { AdminFailureReason } from '$lib/remotes/admin.remote';

describe('V4 admin visibility helpers', () => {
	it('labels SSH tunnel, FTP, and FTPS protocols for admin views', () => {
		expect.hasAssertions();

		expect(adminProtocolLabel('ssh_tunnel')).toBe('SSH tunnel');
		expect(adminProtocolLabel('ftp')).toBe('FTP');
		expect(adminProtocolLabel('ftps')).toBe('FTPS');
		expect(isV4AdminProtocol('ssh_tunnel')).toBe(true);
		expect(isV4AdminProtocol('ftp')).toBe(true);
		expect(isV4AdminProtocol('ftps')).toBe(true);
		expect(isV4AdminProtocol('ssh')).toBe(false);
	});

	it('renders structured failure reasons without dropping the raw code', () => {
		expect.hasAssertions();
		const reason: AdminFailureReason = {
			code: 'ftp_auth_failed',
			category: 'authentication',
			message: 'Authentication failed for ftp'
		};

		expect(adminFailureTitle(reason, 'fallback')).toBe('Authentication failed for ftp');
		expect(adminFailureDetail(reason, 'fallback')).toBe('authentication: ftp_auth_failed');
		expect(adminFailureTitle(null, 'ssh_tunnel_timeout')).toBe('ssh tunnel timeout');
		expect(adminFailureDetail(null, 'ssh_tunnel_timeout')).toBe('ssh_tunnel_timeout');
	});

	it('formats long-running activity durations for active session state', () => {
		expect.hasAssertions();

		expect(formatAdminDuration(null)).toBe('In progress');
		expect(formatAdminDuration(42_000)).toBe('42s');
		expect(formatAdminDuration(185_000)).toBe('3m 5s');
		expect(formatAdminDuration(7_800_000)).toBe('2h 10m');
	});
});
