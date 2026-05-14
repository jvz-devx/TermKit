import { describe, expect, it } from 'vitest';
import { evaluateHostHealth, parseSshHostFacts } from './host-health';

describe('host health helpers', () => {
	it('parses SSH facts from common Linux command output', () => {
		const facts = parseSshHostFacts(`
PRETTY_NAME="Ubuntu 24.04.1 LTS"
ID=ubuntu
VERSION_ID="24.04"
Kernel: Linux 6.8.0-31-generic
 10:12:44 up 5 days,  4:03,  2 users,  load average: 0.01, 0.03, 0.05
Filesystem     1024-blocks     Used Available Capacity Mounted on
/dev/sda1         52428800 10485760  41943040      20% /
tmpfs              1024000    1024   1022976       1% /run
Mem: 16777216 4194304 2097152 0 8388608 12582912
service: ssh.service state=running enabled=enabled OpenSSH server
postgresql.service loaded active running PostgreSQL database
`);

		expect(facts.os).toEqual({
			name: 'Ubuntu 24.04.1 LTS',
			id: 'ubuntu',
			version: '24.04'
		});
		expect(facts.kernel).toBe('Linux 6.8.0-31-generic');
		expect(facts.uptimeSeconds).toBe(446_580);
		expect(facts.disks).toEqual([
			{
				filesystem: '/dev/sda1',
				mount: '/',
				sizeBytes: 53_687_091_200,
				usedBytes: 10_737_418_240,
				availableBytes: 42_949_672_960,
				usePercent: 20
			},
			{
				filesystem: 'tmpfs',
				mount: '/run',
				sizeBytes: 1_048_576_000,
				usedBytes: 1_048_576,
				availableBytes: 1_047_527_424,
				usePercent: 1
			}
		]);
		expect(facts.memory).toEqual({
			totalBytes: 16_777_216,
			usedBytes: 4_194_304,
			availableBytes: 12_582_912
		});
		expect(facts.services).toEqual([
			{
				name: 'ssh.service',
				state: 'running',
				enabled: true,
				description: 'OpenSSH server'
			},
			{
				name: 'postgresql.service',
				state: 'running',
				enabled: null,
				description: 'PostgreSQL database'
			}
		]);
	});

	it('parses proc uptime and concise memory hints', () => {
		const facts = parseSshHostFacts(`
NAME=Fedora Linux
VERSION_ID=40
Linux edge 6.10.0
uptime_seconds=12345.67
memory: total=8000 used=4000 available=2000
`);

		expect(facts.os.name).toBe('Fedora Linux');
		expect(facts.kernel).toBe('Linux edge 6.10.0');
		expect(facts.uptimeSeconds).toBe(12_345);
		expect(facts.memory).toEqual({
			totalBytes: 8000,
			usedBytes: 4000,
			availableBytes: 2000
		});
	});

	it('prioritizes broken credential health over other states', () => {
		const decision = evaluateHostHealth({
			now: new Date('2026-05-14T12:00:00.000Z'),
			lastSuccessfulConnectionAt: '2026-05-14T11:00:00.000Z',
			credentialHealth: 'invalid',
			failureCount: 10,
			lastFailureAt: '2026-05-14T11:30:00.000Z'
		});

		expect(decision).toEqual({
			state: 'broken_credentials',
			code: 'credential_invalid',
			message: 'The assigned credentials failed validation.',
			stale: false,
			actionable: true,
			lastActivityAt: new Date('2026-05-14T11:30:00.000Z')
		});
	});

	it('marks hosts with repeated failures after the last success', () => {
		const decision = evaluateHostHealth({
			now: new Date('2026-05-14T12:00:00.000Z'),
			lastSuccessfulConnectionAt: '2026-05-13T12:00:00.000Z',
			lastFailureAt: '2026-05-14T10:00:00.000Z',
			failureCount: 3,
			credentialHealth: 'ok'
		});

		expect(decision).toMatchObject({
			state: 'repeated_failures',
			code: 'repeated_connection_failures',
			stale: false,
			actionable: true
		});
	});

	it('marks never-used, stale, and healthy hosts', () => {
		const now = new Date('2026-05-14T12:00:00.000Z');

		expect(evaluateHostHealth({ now }).state).toBe('never_used');
		expect(
			evaluateHostHealth({
				now,
				lastSuccessfulConnectionAt: '2026-04-01T12:00:00.000Z',
				staleAfterDays: 30,
				credentialHealth: 'ok'
			})
		).toMatchObject({
			state: 'stale',
			stale: true
		});
		expect(
			evaluateHostHealth({
				now,
				lastSeenAt: '2026-05-14T10:00:00.000Z',
				lastSuccessfulConnectionAt: '2026-05-14T09:00:00.000Z',
				failureCount: 1,
				credentialHealth: 'ok'
			})
		).toMatchObject({
			state: 'healthy',
			stale: false,
			actionable: false
		});
	});
});
