export type HostHealthState =
	| 'stale'
	| 'broken_credentials'
	| 'repeated_failures'
	| 'never_used'
	| 'healthy';

export type CredentialHealth = 'ok' | 'missing' | 'invalid' | 'expired' | 'unknown';

export type HostDiskFact = {
	filesystem: string;
	mount: string;
	sizeBytes: number;
	usedBytes: number;
	availableBytes: number;
	usePercent: number | null;
};

export type HostMemoryFact = {
	totalBytes: number;
	usedBytes: number;
	availableBytes: number | null;
};

export type HostServiceHint = {
	name: string;
	state: string;
	enabled: boolean | null;
	description?: string;
};

export type SshHostFacts = {
	os: {
		name: string | null;
		id: string | null;
		version: string | null;
	};
	kernel: string | null;
	uptimeSeconds: number | null;
	disks: HostDiskFact[];
	memory: HostMemoryFact | null;
	services: HostServiceHint[];
};

export type HostHealthInput = {
	now?: Date;
	createdAt?: Date | string | null;
	lastSeenAt?: Date | string | null;
	lastSuccessfulConnectionAt?: Date | string | null;
	lastFailureAt?: Date | string | null;
	failureCount?: number | null;
	credentialHealth?: CredentialHealth | null;
	staleAfterDays?: number;
	repeatedFailureThreshold?: number;
};

export type HostHealthDecision = {
	state: HostHealthState;
	code: string;
	message: string;
	stale: boolean;
	actionable: boolean;
	lastActivityAt: Date | null;
};

export const emptySshHostFacts: SshHostFacts = {
	os: {
		name: null,
		id: null,
		version: null
	},
	kernel: null,
	uptimeSeconds: null,
	disks: [],
	memory: null,
	services: []
};

export function parseSshHostFacts(output: string): SshHostFacts {
	const lines = output
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
	const osRelease = parseOsRelease(lines);

	return {
		os: {
			name: osRelease.PRETTY_NAME ?? osRelease.NAME ?? null,
			id: osRelease.ID ?? null,
			version: osRelease.VERSION_ID ?? osRelease.VERSION ?? null
		},
		kernel: parseKernel(lines),
		uptimeSeconds: parseUptimeSeconds(lines),
		disks: parseDiskFacts(lines),
		memory: parseMemoryFact(lines),
		services: parseServiceHints(lines)
	};
}

export function evaluateHostHealth(input: HostHealthInput): HostHealthDecision {
	const now = input.now ?? new Date();
	const staleAfterDays = input.staleAfterDays ?? 30;
	const repeatedFailureThreshold = input.repeatedFailureThreshold ?? 3;
	const lastSeenAt = toDate(input.lastSeenAt);
	const lastSuccessfulConnectionAt = toDate(input.lastSuccessfulConnectionAt);
	const lastFailureAt = toDate(input.lastFailureAt);
	const lastActivityAt = latestDate([lastSeenAt, lastSuccessfulConnectionAt, lastFailureAt]);
	const credentialHealth = input.credentialHealth ?? 'unknown';

	if (
		credentialHealth === 'missing' ||
		credentialHealth === 'invalid' ||
		credentialHealth === 'expired'
	) {
		return {
			state: 'broken_credentials',
			code: `credential_${credentialHealth}`,
			message: credentialMessage(credentialHealth),
			stale: false,
			actionable: true,
			lastActivityAt
		};
	}

	const failureCount = input.failureCount ?? 0;
	if (
		failureCount >= repeatedFailureThreshold &&
		lastFailureAt &&
		(!lastSuccessfulConnectionAt || lastFailureAt > lastSuccessfulConnectionAt)
	) {
		return {
			state: 'repeated_failures',
			code: 'repeated_connection_failures',
			message: `The host has ${failureCount} recent connection failures without a later success.`,
			stale: false,
			actionable: true,
			lastActivityAt
		};
	}

	if (!lastSeenAt && !lastSuccessfulConnectionAt) {
		return {
			state: 'never_used',
			code: 'host_never_used',
			message: 'No successful connection or health check has been recorded for this host.',
			stale: false,
			actionable: false,
			lastActivityAt
		};
	}

	const freshnessAnchor = lastSuccessfulConnectionAt ?? lastSeenAt;
	if (freshnessAnchor && ageInDays(now, freshnessAnchor) > staleAfterDays) {
		return {
			state: 'stale',
			code: 'host_stale',
			message: `The host has not been seen successfully for more than ${staleAfterDays} days.`,
			stale: true,
			actionable: true,
			lastActivityAt
		};
	}

	return {
		state: 'healthy',
		code: 'host_healthy',
		message: 'The host has recent successful activity and no blocking health signals.',
		stale: false,
		actionable: false,
		lastActivityAt
	};
}

function parseOsRelease(lines: string[]): Record<string, string> {
	const values: Record<string, string> = {};
	for (const line of lines) {
		const match = /^([A-Z][A-Z0-9_]+)=(.*)$/.exec(line);
		if (!match) continue;
		values[match[1]] = unquote(match[2]);
	}
	return values;
}

function parseKernel(lines: string[]): string | null {
	for (const line of lines) {
		const prefixed = /^kernel:\s*(.+)$/i.exec(line);
		if (prefixed) return prefixed[1].trim();
		if (/^(linux|darwin|freebsd|openbsd|netbsd)\s+\S+/i.test(line)) return line;
	}
	return null;
}

function parseUptimeSeconds(lines: string[]): number | null {
	for (const line of lines) {
		const procUptime = /^uptime_seconds[=:]\s*(\d+(?:\.\d+)?)$/i.exec(line);
		if (procUptime) return Math.floor(Number(procUptime[1]));

		const procLine = /^(\d+(?:\.\d+)?)\s+\d+(?:\.\d+)?$/.exec(line);
		if (procLine) return Math.floor(Number(procLine[1]));

		const human = /up\s+(.+?)(?:,\s+\d+\s+users?|\s+load average:|$)/i.exec(line);
		if (human) {
			const seconds = parseHumanUptime(human[1]);
			if (seconds !== null) return seconds;
		}
	}
	return null;
}

function parseDiskFacts(lines: string[]): HostDiskFact[] {
	const disks: HostDiskFact[] = [];
	for (const line of lines) {
		if (/^filesystem\s+/i.test(line)) continue;
		const parts = line.split(/\s+/);
		if (parts.length < 6) continue;
		const [filesystem, size, used, available, capacity, ...mountParts] = parts;
		if (!/^\d+$/.test(size) || !/^\d+$/.test(used) || !/^\d+$/.test(available)) continue;
		if (!/%$/.test(capacity)) continue;

		disks.push({
			filesystem,
			mount: mountParts.join(' '),
			sizeBytes: Number(size) * 1024,
			usedBytes: Number(used) * 1024,
			availableBytes: Number(available) * 1024,
			usePercent: Number.parseInt(capacity, 10)
		});
	}
	return disks;
}

function parseMemoryFact(lines: string[]): HostMemoryFact | null {
	for (const line of lines) {
		const prefixed = /^memory:\s*total=(\d+)\s+used=(\d+)(?:\s+available=(\d+))?/i.exec(line);
		if (prefixed) {
			return {
				totalBytes: Number(prefixed[1]),
				usedBytes: Number(prefixed[2]),
				availableBytes: prefixed[3] ? Number(prefixed[3]) : null
			};
		}

		const parts = line.split(/\s+/);
		if (parts[0] !== 'Mem:' || parts.length < 4) continue;
		return {
			totalBytes: Number(parts[1]),
			usedBytes: Number(parts[2]),
			availableBytes: parts[6] ? Number(parts[6]) : null
		};
	}
	return null;
}

function parseServiceHints(lines: string[]): HostServiceHint[] {
	const services: HostServiceHint[] = [];
	for (const line of lines) {
		const prefixed =
			/^service:\s*([^=\s]+)\s+state=([^=\s]+)(?:\s+enabled=([^=\s]+))?(?:\s+(.+))?$/i.exec(line);
		if (prefixed) {
			services.push({
				name: prefixed[1],
				state: prefixed[2],
				enabled: parseEnabled(prefixed[3]),
				description: prefixed[4]
			});
			continue;
		}

		const parts = line.split(/\s+/);
		if (!parts[0]?.endsWith('.service') || parts.length < 4) continue;
		services.push({
			name: parts[0],
			state: parts[2] === 'active' ? parts[3] : parts[2],
			enabled: null,
			description: parts.slice(4).join(' ') || undefined
		});
	}
	return services;
}

function parseHumanUptime(value: string): number | null {
	let seconds = 0;
	const dayMatch = /(\d+)\s+days?/i.exec(value);
	if (dayMatch) seconds += Number(dayMatch[1]) * 86_400;
	const hourMatch = /(\d+)\s+hours?/i.exec(value);
	if (hourMatch) seconds += Number(hourMatch[1]) * 3600;
	const minuteMatch = /(\d+)\s+mins?/i.exec(value);
	if (minuteMatch) seconds += Number(minuteMatch[1]) * 60;
	const hhmmMatch = /(\d+):(\d+)/.exec(value);
	if (hhmmMatch) seconds += Number(hhmmMatch[1]) * 3600 + Number(hhmmMatch[2]) * 60;
	return seconds > 0 ? seconds : null;
}

function parseEnabled(value: string | undefined): boolean | null {
	if (!value) return null;
	if (value === 'enabled') return true;
	if (value === 'disabled') return false;
	return null;
}

function unquote(value: string): string {
	const trimmed = value.trim();
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

function toDate(value: Date | string | null | undefined): Date | null {
	if (!value) return null;
	if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function latestDate(values: (Date | null)[]): Date | null {
	return values.reduce<Date | null>((latest, value) => {
		if (!value) return latest;
		if (!latest || value > latest) return value;
		return latest;
	}, null);
}

function ageInDays(now: Date, then: Date): number {
	return (now.getTime() - then.getTime()) / 86_400_000;
}

function credentialMessage(credentialHealth: Exclude<CredentialHealth, 'ok' | 'unknown'>): string {
	if (credentialHealth === 'missing') return 'The host does not have usable credentials assigned.';
	if (credentialHealth === 'expired') return 'The assigned credentials are expired.';
	return 'The assigned credentials failed validation.';
}
