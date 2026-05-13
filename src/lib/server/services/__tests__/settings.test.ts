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
			rememberLastActiveTab: true
		});

		expect(saved).toEqual({
			ticketTtlSeconds: 120,
			terminalFontSize: 15,
			clipboardSync: false,
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
				rememberLastActiveTab: null
			})
		).toThrow(ServiceValidationError);
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
			clipboardSync: false
		});
	});
});
