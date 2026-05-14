export type TerminalTheme = 'dark' | 'light' | 'system';

export type TerminalPreferences = {
	fontSize: number | null;
	scrollback: number;
	cursorBlink: boolean;
	theme: TerminalTheme;
};

export type SshJumpHostMetadata = {
	enabled: boolean;
	hostId: string | null;
};

export type FtpsHostMetadata = {
	mode: 'explicit' | 'implicit';
	rejectUnauthorized: boolean;
	certificateHostname: string | null;
};

export type TermixHostMetadata = Record<string, unknown> & {
	terminalPreferences: TerminalPreferences;
	sshJumpHost: SshJumpHostMetadata;
	ftps: FtpsHostMetadata;
};

export type SshJumpHostConfig = {
	hostId: string;
};

export const DEFAULT_TERMINAL_PREFERENCES: TerminalPreferences = {
	fontSize: null,
	scrollback: 5000,
	cursorBlink: true,
	theme: 'dark'
};

export const DEFAULT_SSH_JUMP_HOST: SshJumpHostMetadata = {
	enabled: false,
	hostId: null
};

export const DEFAULT_FTPS_HOST_METADATA: FtpsHostMetadata = {
	mode: 'explicit',
	rejectUnauthorized: true,
	certificateHostname: null
};

const minimumFontSize = 8;
const maximumFontSize = 32;
const minimumScrollback = 500;
const maximumScrollback = 50_000;
const terminalThemes = ['dark', 'light', 'system'] as const;
const ftpsModes = ['explicit', 'implicit'] as const;
const blockedMetadataKeys = new Set([
	'terminalOutput',
	'terminalScrollbackOutput',
	'scrollbackOutput',
	'terminalBuffer'
]);

export function normalizeHostMetadata(value: unknown): TermixHostMetadata {
	const record = isRecord(value) ? value : {};
	const preserved = Object.fromEntries(
		Object.entries(record).filter(([key]) => !blockedMetadataKeys.has(key))
	);

	return {
		...preserved,
		terminalPreferences: normalizeTerminalPreferences(record.terminalPreferences),
		sshJumpHost: normalizeSshJumpHostMetadata(record.sshJumpHost),
		ftps: normalizeFtpsHostMetadata(record.ftps, record)
	};
}

export function normalizeTerminalPreferences(value: unknown): TerminalPreferences {
	if (!isRecord(value)) return { ...DEFAULT_TERMINAL_PREFERENCES };

	return {
		fontSize:
			value.fontSize === null || value.fontSize === undefined
				? null
				: (asBoundedInteger(value.fontSize, minimumFontSize, maximumFontSize) ??
					DEFAULT_TERMINAL_PREFERENCES.fontSize),
		scrollback:
			asBoundedInteger(value.scrollback, minimumScrollback, maximumScrollback) ??
			DEFAULT_TERMINAL_PREFERENCES.scrollback,
		cursorBlink:
			typeof value.cursorBlink === 'boolean'
				? value.cursorBlink
				: DEFAULT_TERMINAL_PREFERENCES.cursorBlink,
		theme: terminalThemes.includes(value.theme as TerminalTheme)
			? (value.theme as TerminalTheme)
			: DEFAULT_TERMINAL_PREFERENCES.theme
	};
}

export function normalizeSshJumpHostMetadata(value: unknown): SshJumpHostMetadata {
	if (!isRecord(value)) return { ...DEFAULT_SSH_JUMP_HOST };

	const hostId = asTrimmedString(value.hostId);
	const enabled = typeof value.enabled === 'boolean' ? value.enabled : Boolean(hostId);

	return {
		enabled: enabled && Boolean(hostId),
		hostId: enabled ? hostId : null
	};
}

export function normalizeFtpsHostMetadata(
	value: unknown,
	legacy: Record<string, unknown> = {}
): FtpsHostMetadata {
	const record = isRecord(value) ? value : {};
	const mode = record.mode ?? record.ftpsMode ?? legacy.ftpsMode;
	const rejectUnauthorized =
		record.rejectUnauthorized ?? record.ftpsRejectUnauthorized ?? legacy.ftpsRejectUnauthorized;
	const certificateHostname =
		record.certificateHostname ?? record.ftpsCertificateHostname ?? legacy.ftpsCertificateHostname;

	return {
		mode: ftpsModes.includes(mode as FtpsHostMetadata['mode'])
			? (mode as FtpsHostMetadata['mode'])
			: DEFAULT_FTPS_HOST_METADATA.mode,
		rejectUnauthorized:
			typeof rejectUnauthorized === 'boolean'
				? rejectUnauthorized
				: DEFAULT_FTPS_HOST_METADATA.rejectUnauthorized,
		certificateHostname: asTrimmedString(certificateHostname)
	};
}

export function toSshJumpHostConfig(value: unknown): SshJumpHostConfig | null {
	const jumpHost = normalizeSshJumpHostMetadata(value);
	if (!jumpHost.enabled || !jumpHost.hostId) return null;
	return { hostId: jumpHost.hostId };
}

export function terminalFontSize(preferences: TerminalPreferences, fallback: number): number {
	return preferences.fontSize ?? fallback;
}

function asBoundedInteger(value: unknown, minimum: number, maximum: number): number | null {
	const numeric =
		typeof value === 'number'
			? value
			: typeof value === 'string' && value.trim()
				? Number(value)
				: Number.NaN;
	if (!Number.isInteger(numeric) || numeric < minimum || numeric > maximum) return null;
	return numeric;
}

function asTrimmedString(value: unknown): string | null {
	return typeof value === 'string' ? value.trim() || null : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
