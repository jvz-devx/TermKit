import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceUnauthorizedError } from '$lib/server/services/errors';
import { settingsService } from '$lib/server/services/settings';
import { getAppSettings, saveAppSettings } from './settings.remote';

const appServer = vi.hoisted(() => ({
	event: {
		locals: { user: { id: 'user-1', username: 'ada', isAdmin: true } } as {
			user?: { id: string; username: string; isAdmin?: boolean };
		},
		url: new URL('https://termix.test/settings')
	},
	refresh: vi.fn()
}));

vi.mock('$app/server', () => {
	function remoteCallable(type: 'command' | 'query', fn: (input?: unknown) => unknown) {
		const wrapper = vi.fn((input?: unknown) => {
			const promise = Promise.resolve(fn(input)) as Promise<unknown> & { refresh: () => void };
			promise.refresh = appServer.refresh;
			return promise;
		});
		Object.defineProperty(wrapper, '__', { value: { type } });
		return wrapper;
	}

	return {
		getRequestEvent: () => appServer.event,
		query: (fn: () => unknown) => remoteCallable('query', fn),
		command: (_validation: unknown, fn: (input?: unknown) => unknown) =>
			remoteCallable('command', fn)
	};
});

vi.mock('$lib/server/services/settings', () => ({
	settingsService: {
		getBasicAppSettings: vi.fn(),
		saveBasicAppSettings: vi.fn()
	}
}));

describe('settings remote functions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		appServer.event = {
			locals: { user: { id: 'user-1', username: 'ada', isAdmin: true } },
			url: new URL('https://termix.test/settings')
		};
	});

	it('loads settings only for an authenticated remote user', async () => {
		vi.mocked(settingsService.getBasicAppSettings).mockResolvedValueOnce({
			ticketTtlSeconds: 90,
			terminalFontSize: 13,
			clipboardSync: false,
			rdpClipboard: {
				text: false,
				files: false,
				clientToRemote: false,
				remoteToClient: false,
				fileTransferSizeLimitMiB: 16
			},
			rdpDriveRedirection: false,
			rdpPerformancePreset: 'balanced',
			rdpAudioRedirection: false,
			rememberLastActiveTab: true
		} as never);

		await expect(getAppSettings()).resolves.toMatchObject({
			ticketTtlSeconds: 90,
			clipboardSync: false
		});
		expect(settingsService.getBasicAppSettings).toHaveBeenCalledOnce();
	});

	it('rejects settings reads without invoking the service when auth is missing', async () => {
		appServer.event = {
			locals: {},
			url: new URL('https://termix.test/settings')
		};

		await expect(getAppSettings()).rejects.toBeInstanceOf(ServiceUnauthorizedError);
		expect(settingsService.getBasicAppSettings).not.toHaveBeenCalled();
	});

	it('rejects settings saves without invoking the service when auth is missing', async () => {
		appServer.event = {
			locals: {},
			url: new URL('https://termix.test/settings')
		};

		await expect(saveAppSettings({ ticketTtlSeconds: 120 })).rejects.toMatchObject({
			status: 401
		});
		expect(settingsService.saveBasicAppSettings).not.toHaveBeenCalled();
	});

	it('rejects settings saves for non-admin users before invoking the service', async () => {
		appServer.event = {
			locals: { user: { id: 'user-1', username: 'ada', isAdmin: false } },
			url: new URL('https://termix.test/settings')
		};

		await expect(saveAppSettings({ ticketTtlSeconds: 120 })).rejects.toMatchObject({
			status: 403
		});
		expect(settingsService.saveBasicAppSettings).not.toHaveBeenCalled();
	});

	it('saves settings through the service for admins and refreshes the settings query', async () => {
		const input = {
			ticketTtlSeconds: 120,
			rdpClipboard: {
				text: true,
				files: true,
				clientToRemote: true,
				remoteToClient: false,
				fileTransferSizeLimitMiB: 32
			},
			rdpPerformancePreset: 'quality'
		} as const;
		const saved = {
			...input,
			terminalFontSize: 14,
			clipboardSync: true,
			rdpAudioRedirection: true,
			rememberLastActiveTab: false
		} as const;
		vi.mocked(settingsService.saveBasicAppSettings).mockResolvedValueOnce(saved);

		await expect(saveAppSettings(input)).resolves.toEqual(saved);
		expect(settingsService.saveBasicAppSettings).toHaveBeenCalledWith(input);
		expect(appServer.refresh).toHaveBeenCalledOnce();
	});
});
