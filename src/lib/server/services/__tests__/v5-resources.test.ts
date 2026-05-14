import { describe, expect, it } from 'vitest';
import {
	InMemoryV5ResourcesRepository,
	type CommandSnippetRecord,
	type FileBookmarkRecord,
	type FtpsHostSettingsRecord,
	type RdpHostSettingsRecord,
	type TerminalPreferenceRecord,
	type TerminalRecordingRecord
} from '../v5-resources';

describe('V5 resources repository', () => {
	it('stores terminal preferences, snippets, and recording metadata without terminal output', async () => {
		expect.assertions(5);

		const repository = new InMemoryV5ResourcesRepository();
		const now = new Date('2026-05-14T12:00:00.000Z');

		await repository.upsertTerminalPreference(
			terminalPreference({
				fontSize: 15,
				theme: 'dark',
				scrollbackLines: 5000,
				shellTitle: 'prod shell',
				initialCols: 132,
				initialRows: 40
			})
		);
		await repository.createCommandSnippet(
			commandSnippet({
				id: 'snippet-1',
				hostId: 'host-1',
				name: 'Restart service',
				command: 'systemctl restart app',
				tags: ['ops']
			})
		);
		await repository.createTerminalRecording(
			terminalRecording({
				id: 'recording-1',
				storageKey: 'recordings/user-1/recording-1.cast',
				startedAt: now
			})
		);

		await expect(repository.getTerminalPreference('user-1', 'host-1')).resolves.toMatchObject({
			fontSize: 15,
			theme: 'dark',
			initialCols: 132,
			initialRows: 40
		});
		await expect(repository.listCommandSnippets('user-1', { hostId: 'host-1' })).resolves.toEqual([
			expect.objectContaining({ name: 'Restart service', command: 'systemctl restart app' })
		]);
		await expect(
			repository.updateTerminalRecording('user-1', 'recording-1', {
				status: 'completed',
				endedAt: new Date('2026-05-14T12:01:00.000Z'),
				updatedAt: new Date('2026-05-14T12:01:00.000Z')
			})
		).resolves.toMatchObject({ status: 'completed' });

		const [recording] = await repository.listTerminalRecordings('user-1', { status: 'completed' });
		expect(recording).toMatchObject({
			storageKey: 'recordings/user-1/recording-1.cast',
			connectionSessionId: null,
			sshLiveSessionId: null
		});
		expect(recording).not.toHaveProperty('output');
	});

	it('stores file bookmarks plus per-host FTPS and RDP settings', async () => {
		expect.assertions(4);

		const repository = new InMemoryV5ResourcesRepository();

		await repository.createFileBookmark(
			fileBookmark({
				id: 'bookmark-1',
				protocol: 'ftps',
				label: 'Release uploads',
				remotePath: '/srv/releases'
			})
		);
		await repository.upsertFtpsHostSettings(
			ftpsHostSettings({
				mode: 'implicit',
				rejectUnauthorized: false,
				certificateHostname: 'files.example.test'
			})
		);
		await repository.upsertRdpHostSettings(
			rdpHostSettings({
				display: { width: 1920, height: 1080 },
				clipboard: { text: true, files: false },
				audio: { mode: 'disabled' },
				gateway: { route: 'default' }
			})
		);

		await expect(repository.listFileBookmarks('user-1', { protocol: 'ftps' })).resolves.toEqual([
			expect.objectContaining({ label: 'Release uploads', remotePath: '/srv/releases' })
		]);
		await expect(repository.getFtpsHostSettings('user-1', 'host-1')).resolves.toMatchObject({
			mode: 'implicit',
			rejectUnauthorized: false,
			certificateHostname: 'files.example.test'
		});
		await expect(repository.getRdpHostSettings('user-1', 'host-1')).resolves.toMatchObject({
			display: { width: 1920, height: 1080 },
			clipboard: { text: true, files: false },
			audio: { mode: 'disabled' }
		});
		await expect(repository.getRdpHostSettings('user-2', 'host-1')).resolves.toBeNull();
	});
});

function terminalPreference(
	patch: Partial<TerminalPreferenceRecord> = {}
): TerminalPreferenceRecord {
	const now = new Date('2026-05-14T12:00:00.000Z');
	return {
		id: 'terminal-preference-1',
		userId: 'user-1',
		hostId: 'host-1',
		fontSize: 13,
		theme: 'system',
		scrollbackLines: 2000,
		shellTitle: null,
		initialCols: 120,
		initialRows: 32,
		metadata: {},
		createdAt: now,
		updatedAt: now,
		...patch
	};
}

function commandSnippet(patch: Partial<CommandSnippetRecord> = {}): CommandSnippetRecord {
	const now = new Date('2026-05-14T12:00:00.000Z');
	return {
		id: 'snippet-1',
		userId: 'user-1',
		workspaceId: null,
		hostId: null,
		name: 'Snippet',
		command: 'uptime',
		description: null,
		tags: [],
		metadata: {},
		createdAt: now,
		updatedAt: now,
		...patch
	};
}

function terminalRecording(patch: Partial<TerminalRecordingRecord> = {}): TerminalRecordingRecord {
	const now = new Date('2026-05-14T12:00:00.000Z');
	return {
		id: 'recording-1',
		userId: 'user-1',
		hostId: 'host-1',
		connectionSessionId: null,
		sshLiveSessionId: null,
		status: 'recording',
		storageKey: 'recordings/user-1/recording-1.cast',
		startedAt: now,
		endedAt: null,
		retentionExpiresAt: null,
		metadata: {},
		createdAt: now,
		updatedAt: now,
		...patch
	};
}

function fileBookmark(patch: Partial<FileBookmarkRecord> = {}): FileBookmarkRecord {
	const now = new Date('2026-05-14T12:00:00.000Z');
	return {
		id: 'bookmark-1',
		userId: 'user-1',
		hostId: 'host-1',
		protocol: 'ftp',
		label: 'Home',
		remotePath: '/home/ops',
		metadata: {},
		createdAt: now,
		updatedAt: now,
		...patch
	};
}

function ftpsHostSettings(patch: Partial<FtpsHostSettingsRecord> = {}): FtpsHostSettingsRecord {
	const now = new Date('2026-05-14T12:00:00.000Z');
	return {
		id: 'ftps-settings-1',
		userId: 'user-1',
		hostId: 'host-1',
		mode: 'explicit',
		rejectUnauthorized: true,
		certificateHostname: null,
		metadata: {},
		createdAt: now,
		updatedAt: now,
		...patch
	};
}

function rdpHostSettings(patch: Partial<RdpHostSettingsRecord> = {}): RdpHostSettingsRecord {
	const now = new Date('2026-05-14T12:00:00.000Z');
	return {
		id: 'rdp-settings-1',
		userId: 'user-1',
		hostId: 'host-1',
		display: {},
		clipboard: {},
		audio: {},
		gateway: {},
		metadata: {},
		createdAt: now,
		updatedAt: now,
		...patch
	};
}
