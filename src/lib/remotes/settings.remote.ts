import { command, getRequestEvent, query } from '$app/server';
import { error } from '@sveltejs/kit';
import {
	settingsService,
	type BasicAppSettings,
	type BasicAppSettingsInput,
	type RdpClipboardPolicy,
	type RdpPerformancePreset
} from '$lib/server/services/settings';
import { ServiceUnauthorizedError } from '$lib/server/services/errors';

export type { BasicAppSettings, BasicAppSettingsInput, RdpClipboardPolicy, RdpPerformancePreset };

export const getAppSettings = query(async () => {
	requireRemoteUser();
	return settingsService.getBasicAppSettings();
});

export const saveAppSettings = command<BasicAppSettingsInput, BasicAppSettings>(
	'unchecked',
	async (input) => {
		requireRemoteAdmin();
		const settings = await settingsService.saveBasicAppSettings(input);
		void getAppSettings().refresh();
		return settings;
	}
);

function requireRemoteUser(): string {
	const userId = getRequestEvent().locals.user?.id;
	if (!userId) throw new ServiceUnauthorizedError();
	return userId;
}

function requireRemoteAdmin(): string {
	const user = getRequestEvent().locals.user;
	if (!user) error(401, 'Unauthenticated');
	if (!user.isAdmin) error(403, 'Admin access required');
	return user.id;
}
