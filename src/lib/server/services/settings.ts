import { eq } from 'drizzle-orm';
import { db, type TermixDb } from '$lib/server/db';
import { settings as settingsTable } from '$lib/server/db/schema';
import { ServiceValidationError } from './errors';

export const BASIC_APP_SETTINGS_KEY = 'app.basic';
const ticketTtlMinimumSeconds = 10;
const ticketTtlMaximumSeconds = 300;
const rdpClipboardFileTransferMinimumMiB = 1;
const rdpClipboardFileTransferMaximumMiB = 1024;
const rdpPerformancePresets = ['balanced', 'performance', 'quality'] as const;

export type RdpPerformancePreset = (typeof rdpPerformancePresets)[number];

export type RdpClipboardPolicy = {
	text: boolean;
	files: boolean;
	clientToRemote: boolean;
	remoteToClient: boolean;
	fileTransferSizeLimitMiB: number;
};

export type BasicAppSettings = {
	ticketTtlSeconds: number;
	terminalFontSize: number;
	clipboardSync: boolean;
	rdpClipboard: RdpClipboardPolicy;
	rdpPerformancePreset: RdpPerformancePreset;
	rdpAudioRedirection: boolean;
	rememberLastActiveTab: boolean;
};

export type BasicAppSettingsInput = Partial<Record<keyof BasicAppSettings, unknown>>;

export const DEFAULT_BASIC_APP_SETTINGS: BasicAppSettings = {
	ticketTtlSeconds: 60,
	terminalFontSize: 13,
	clipboardSync: true,
	rdpClipboard: {
		text: true,
		files: true,
		clientToRemote: true,
		remoteToClient: true,
		fileTransferSizeLimitMiB: 16
	},
	rdpPerformancePreset: 'balanced',
	rdpAudioRedirection: false,
	rememberLastActiveTab: true
};

export interface SettingsRepository {
	getSetting(key: string): Promise<unknown | null>;
	upsertSetting(key: string, value: unknown, now: Date): Promise<unknown>;
}

export class DrizzleSettingsRepository implements SettingsRepository {
	constructor(private readonly database: TermixDb = db) {}

	async getSetting(key: string): Promise<unknown | null> {
		const [row] = await this.database
			.select({ value: settingsTable.value })
			.from(settingsTable)
			.where(eq(settingsTable.key, key))
			.limit(1);

		return row?.value ?? null;
	}

	async upsertSetting(key: string, value: unknown, now: Date): Promise<unknown> {
		const [row] = await this.database
			.insert(settingsTable)
			.values({
				key,
				value,
				createdAt: now,
				updatedAt: now
			})
			.onConflictDoUpdate({
				target: settingsTable.key,
				set: {
					value,
					updatedAt: now
				}
			})
			.returning({ value: settingsTable.value });

		if (!row) throw new Error('Could not persist settings');
		return row.value;
	}
}

export class InMemorySettingsRepository implements SettingsRepository {
	private readonly settings = new Map<string, unknown>();

	async getSetting(key: string): Promise<unknown | null> {
		return this.settings.get(key) ?? null;
	}

	async upsertSetting(key: string, value: unknown): Promise<unknown> {
		this.settings.set(key, value);
		return value;
	}
}

export class SettingsService {
	constructor(private readonly repository: SettingsRepository = new DrizzleSettingsRepository()) {}

	async getBasicAppSettings(): Promise<BasicAppSettings> {
		const value = await this.repository.getSetting(BASIC_APP_SETTINGS_KEY);
		return normalizeStoredSettings(value);
	}

	async saveBasicAppSettings(input: BasicAppSettingsInput): Promise<BasicAppSettings> {
		const validated = validateBasicAppSettingsInput(input);
		const stored = await this.repository.upsertSetting(
			BASIC_APP_SETTINGS_KEY,
			validated,
			new Date()
		);

		return normalizeStoredSettings(stored);
	}
}

export function validateBasicAppSettingsInput(input: BasicAppSettingsInput): BasicAppSettings {
	const issues: string[] = [];
	const ticketTtlSeconds = asInteger(input.ticketTtlSeconds);
	const terminalFontSize = asInteger(input.terminalFontSize);
	const clipboardSync = asBoolean(input.clipboardSync);
	const rdpClipboard = validateRdpClipboardPolicyInput(input.rdpClipboard, issues);
	const rdpPerformancePreset = asRdpPerformancePreset(input.rdpPerformancePreset);
	const rdpAudioRedirection = asBoolean(input.rdpAudioRedirection);
	const rememberLastActiveTab = asBoolean(input.rememberLastActiveTab);

	if (
		ticketTtlSeconds === null ||
		ticketTtlSeconds < ticketTtlMinimumSeconds ||
		ticketTtlSeconds > ticketTtlMaximumSeconds
	) {
		issues.push('ticketTtlSeconds must be an integer between 10 and 300');
	}

	if (terminalFontSize === null || terminalFontSize < 8 || terminalFontSize > 32) {
		issues.push('terminalFontSize must be an integer between 8 and 32');
	}

	if (clipboardSync === null) {
		issues.push('clipboardSync must be a boolean');
	}

	if (rdpPerformancePreset === null) {
		issues.push('rdpPerformancePreset must be balanced, performance, or quality');
	}

	if (rdpAudioRedirection === null) {
		issues.push('rdpAudioRedirection must be a boolean');
	}

	if (rememberLastActiveTab === null) {
		issues.push('rememberLastActiveTab must be a boolean');
	}

	if (issues.length > 0) throw new ServiceValidationError(issues);

	return {
		ticketTtlSeconds: ticketTtlSeconds!,
		terminalFontSize: terminalFontSize!,
		clipboardSync: clipboardSync!,
		rdpClipboard: normalizeRdpClipboardPolicyDirections(rdpClipboard!),
		rdpPerformancePreset: rdpPerformancePreset!,
		rdpAudioRedirection: rdpAudioRedirection!,
		rememberLastActiveTab: rememberLastActiveTab!
	};
}

function normalizeStoredSettings(value: unknown): BasicAppSettings {
	if (!isRecord(value)) return { ...DEFAULT_BASIC_APP_SETTINGS };

	const legacyClipboardSync =
		typeof value.clipboardSync === 'boolean'
			? value.clipboardSync
			: DEFAULT_BASIC_APP_SETTINGS.clipboardSync;

	return {
		ticketTtlSeconds:
			asStoredInteger(value.ticketTtlSeconds, ticketTtlMinimumSeconds, ticketTtlMaximumSeconds) ??
			DEFAULT_BASIC_APP_SETTINGS.ticketTtlSeconds,
		terminalFontSize:
			asStoredInteger(value.terminalFontSize, 8, 32) ?? DEFAULT_BASIC_APP_SETTINGS.terminalFontSize,
		clipboardSync: legacyClipboardSync,
		rdpClipboard: normalizeStoredRdpClipboardPolicy(value.rdpClipboard, legacyClipboardSync),
		rdpPerformancePreset:
			asRdpPerformancePreset(value.rdpPerformancePreset) ??
			DEFAULT_BASIC_APP_SETTINGS.rdpPerformancePreset,
		rdpAudioRedirection:
			typeof value.rdpAudioRedirection === 'boolean'
				? value.rdpAudioRedirection
				: DEFAULT_BASIC_APP_SETTINGS.rdpAudioRedirection,
		rememberLastActiveTab:
			typeof value.rememberLastActiveTab === 'boolean'
				? value.rememberLastActiveTab
				: DEFAULT_BASIC_APP_SETTINGS.rememberLastActiveTab
	};
}

function validateRdpClipboardPolicyInput(
	value: unknown,
	issues: string[]
): RdpClipboardPolicy | null {
	if (!isRecord(value)) {
		issues.push('rdpClipboard must be an object');
		return null;
	}

	const text = asBoolean(value.text);
	const files = asBoolean(value.files);
	const clientToRemote = asBoolean(value.clientToRemote);
	const remoteToClient = asBoolean(value.remoteToClient);
	const fileTransferSizeLimitMiB = asInteger(value.fileTransferSizeLimitMiB);

	if (text === null) issues.push('rdpClipboard.text must be a boolean');
	if (files === null) issues.push('rdpClipboard.files must be a boolean');
	if (clientToRemote === null) issues.push('rdpClipboard.clientToRemote must be a boolean');
	if (remoteToClient === null) issues.push('rdpClipboard.remoteToClient must be a boolean');
	if (
		fileTransferSizeLimitMiB === null ||
		fileTransferSizeLimitMiB < rdpClipboardFileTransferMinimumMiB ||
		fileTransferSizeLimitMiB > rdpClipboardFileTransferMaximumMiB
	) {
		issues.push('rdpClipboard.fileTransferSizeLimitMiB must be an integer between 1 and 1024');
	}

	if (
		text === null ||
		files === null ||
		clientToRemote === null ||
		remoteToClient === null ||
		fileTransferSizeLimitMiB === null
	) {
		return null;
	}

	return {
		text,
		files,
		clientToRemote,
		remoteToClient,
		fileTransferSizeLimitMiB
	};
}

function normalizeStoredRdpClipboardPolicy(
	value: unknown,
	legacyClipboardSync: boolean
): RdpClipboardPolicy {
	if (!isRecord(value)) {
		return normalizeRdpClipboardPolicyDirections({
			...DEFAULT_BASIC_APP_SETTINGS.rdpClipboard,
			text: legacyClipboardSync,
			files: legacyClipboardSync && DEFAULT_BASIC_APP_SETTINGS.rdpClipboard.files,
			clientToRemote: legacyClipboardSync,
			remoteToClient: legacyClipboardSync
		});
	}

	return normalizeRdpClipboardPolicyDirections({
		text:
			typeof value.text === 'boolean'
				? value.text
				: legacyClipboardSync && DEFAULT_BASIC_APP_SETTINGS.rdpClipboard.text,
		files:
			typeof value.files === 'boolean'
				? value.files
				: legacyClipboardSync && DEFAULT_BASIC_APP_SETTINGS.rdpClipboard.files,
		clientToRemote:
			typeof value.clientToRemote === 'boolean'
				? value.clientToRemote
				: legacyClipboardSync && DEFAULT_BASIC_APP_SETTINGS.rdpClipboard.clientToRemote,
		remoteToClient:
			typeof value.remoteToClient === 'boolean'
				? value.remoteToClient
				: legacyClipboardSync && DEFAULT_BASIC_APP_SETTINGS.rdpClipboard.remoteToClient,
		fileTransferSizeLimitMiB:
			asStoredInteger(
				value.fileTransferSizeLimitMiB,
				rdpClipboardFileTransferMinimumMiB,
				rdpClipboardFileTransferMaximumMiB
			) ?? DEFAULT_BASIC_APP_SETTINGS.rdpClipboard.fileTransferSizeLimitMiB
	});
}

function normalizeRdpClipboardPolicyDirections(policy: RdpClipboardPolicy): RdpClipboardPolicy {
	if (!policy.text && !policy.files) {
		return {
			...policy,
			clientToRemote: false,
			remoteToClient: false
		};
	}

	return policy;
}

function asInteger(value: unknown): number | null {
	if (typeof value === 'number' && Number.isInteger(value)) return value;
	if (typeof value !== 'string' || !value.trim()) return null;

	const parsed = Number(value);
	return Number.isInteger(parsed) ? parsed : null;
}

function asBoolean(value: unknown): boolean | null {
	return typeof value === 'boolean' ? value : null;
}

function asRdpPerformancePreset(value: unknown): RdpPerformancePreset | null {
	return rdpPerformancePresets.includes(value as RdpPerformancePreset)
		? (value as RdpPerformancePreset)
		: null;
}

function asStoredInteger(value: unknown, minimum: number, maximum: number): number | null {
	const parsed = asInteger(value);
	return parsed !== null && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export const settingsService = new SettingsService();
