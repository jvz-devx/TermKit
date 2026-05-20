import { describe, expect, it } from 'vitest';
import { ServiceValidationError } from '../errors';
import {
	BASIC_APP_SETTINGS_KEY,
	DEFAULT_BASIC_APP_SETTINGS,
	InMemorySettingsRepository,
	SettingsService,
	validateBasicAppSettingsInput
} from '../settings';

describe('SettingsService', () => {
	it('returns sensible defaults before settings are persisted', async () => {
		const service = new SettingsService(new InMemorySettingsRepository());

		await expect(service.getBasicAppSettings()).resolves.toEqual(DEFAULT_BASIC_APP_SETTINGS);
	});

	it('validates and persists basic app settings', async () => {
		const repository = new InMemorySettingsRepository();
		const service = new SettingsService(repository);

		const saved = await service.saveBasicAppSettings({
			ticketTtlSeconds: '120',
			terminalFontSize: 15,
			clipboardSync: false,
			rdpClipboard: {
				text: true,
				files: false,
				clientToRemote: true,
				remoteToClient: false,
				fileTransferSizeLimitMiB: '64'
			},
			rdpPerformancePreset: 'performance',
			rdpAudioRedirection: true,
			rememberLastActiveTab: true
		});

		expect(saved).toEqual({
			ticketTtlSeconds: 120,
			terminalFontSize: 15,
			clipboardSync: false,
			rdpClipboard: {
				text: true,
				files: false,
				clientToRemote: true,
				remoteToClient: false,
				fileTransferSizeLimitMiB: 64
			},
			rdpPerformancePreset: 'performance',
			rdpAudioRedirection: true,
			rememberLastActiveTab: true
		});
		await expect(repository.getSetting(BASIC_APP_SETTINGS_KEY)).resolves.toEqual(saved);
		await expect(service.getBasicAppSettings()).resolves.toEqual(saved);
	});

	it('rejects invalid persisted values on write', () => {
		expect(() =>
			validateBasicAppSettingsInput({
				ticketTtlSeconds: 9,
				terminalFontSize: 40,
				clipboardSync: 'yes',
				rdpClipboard: {
					text: 'yes',
					files: null,
					clientToRemote: true,
					remoteToClient: 'no',
					fileTransferSizeLimitMiB: 0
				},
				rdpPerformancePreset: 'fast',
				rdpAudioRedirection: 'yes',
				rememberLastActiveTab: null
			})
		).toThrow(ServiceValidationError);
		try {
			validateBasicAppSettingsInput({
				ticketTtlSeconds: 9,
				terminalFontSize: 40,
				clipboardSync: 'yes',
				rdpClipboard: {
					text: 'yes',
					files: null,
					clientToRemote: true,
					remoteToClient: 'no',
					fileTransferSizeLimitMiB: 0
				},
				rdpPerformancePreset: 'fast',
				rdpAudioRedirection: 'yes',
				rememberLastActiveTab: null
			});
		} catch (error) {
			expect(error).toMatchObject({
				issues: [
					'rdpClipboard.text must be a boolean',
					'rdpClipboard.files must be a boolean',
					'rdpClipboard.remoteToClient must be a boolean',
					'rdpClipboard.fileTransferSizeLimitMiB must be an integer between 1 and 1024',
					'ticketTtlSeconds must be an integer between 10 and 300',
					'terminalFontSize must be an integer between 8 and 32',
					'clipboardSync must be a boolean',
					'rdpPerformancePreset must be balanced, performance, or quality',
					'rdpAudioRedirection must be a boolean',
					'rememberLastActiveTab must be a boolean'
				]
			});
		}
	});

	it('stores conservative RDP clipboard directions when all clipboard payloads are disabled', () => {
		expect(
			validateBasicAppSettingsInput({
				ticketTtlSeconds: 60,
				terminalFontSize: 13,
				clipboardSync: true,
				rdpClipboard: {
					text: false,
					files: false,
					clientToRemote: true,
					remoteToClient: true,
					fileTransferSizeLimitMiB: 16
				},
				rdpPerformancePreset: 'balanced',
				rdpAudioRedirection: false,
				rememberLastActiveTab: true
			}).rdpClipboard
		).toEqual({
			text: false,
			files: false,
			clientToRemote: false,
			remoteToClient: false,
			fileTransferSizeLimitMiB: 16
		});
	});

	it('falls back per field when legacy stored settings are malformed', async () => {
		const repository = new InMemorySettingsRepository();
		await repository.upsertSetting(BASIC_APP_SETTINGS_KEY, {
			ticketTtlSeconds: '300',
			terminalFontSize: 'large',
			clipboardSync: false,
			rememberLastActiveTab: 'yes'
		});

		const service = new SettingsService(repository);

		await expect(service.getBasicAppSettings()).resolves.toEqual({
			...DEFAULT_BASIC_APP_SETTINGS,
			ticketTtlSeconds: 300,
			clipboardSync: false,
			rdpClipboard: {
				...DEFAULT_BASIC_APP_SETTINGS.rdpClipboard,
				text: false,
				files: false,
				clientToRemote: false,
				remoteToClient: false
			}
		});
	});

	it('falls back when stored RDP operator settings are malformed', async () => {
		const repository = new InMemorySettingsRepository();
		await repository.upsertSetting(BASIC_APP_SETTINGS_KEY, {
			...DEFAULT_BASIC_APP_SETTINGS,
			rdpPerformancePreset: 'ultra',
			rdpAudioRedirection: 'enabled'
		});

		const service = new SettingsService(repository);

		await expect(service.getBasicAppSettings()).resolves.toEqual(DEFAULT_BASIC_APP_SETTINGS);
	});

	it('maps legacy disabled clipboard sync to a disabled RDP clipboard policy', async () => {
		const repository = new InMemorySettingsRepository();
		await repository.upsertSetting(BASIC_APP_SETTINGS_KEY, {
			ticketTtlSeconds: 60,
			terminalFontSize: 13,
			clipboardSync: false,
			rememberLastActiveTab: true
		});

		const service = new SettingsService(repository);

		await expect(service.getBasicAppSettings()).resolves.toEqual({
			...DEFAULT_BASIC_APP_SETTINGS,
			clipboardSync: false,
			rdpClipboard: {
				...DEFAULT_BASIC_APP_SETTINGS.rdpClipboard,
				text: false,
				files: false,
				clientToRemote: false,
				remoteToClient: false
			}
		});
	});

	it('enables file clipboard for default and legacy-enabled settings', async () => {
		const repository = new InMemorySettingsRepository();
		await repository.upsertSetting(BASIC_APP_SETTINGS_KEY, {
			ticketTtlSeconds: 60,
			terminalFontSize: 13,
			clipboardSync: true,
			rememberLastActiveTab: true
		});

		const service = new SettingsService(repository);

		expect(DEFAULT_BASIC_APP_SETTINGS.rdpClipboard.files).toBe(true);
		await expect(service.getBasicAppSettings()).resolves.toMatchObject({
			clipboardSync: true,
			rdpClipboard: {
				text: true,
				files: true,
				clientToRemote: true,
				remoteToClient: true
			}
		});
	});
});
