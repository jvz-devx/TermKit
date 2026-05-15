import { describe, expect, it } from 'vitest';
import type { TermixDb } from '$lib/server/db';
import {
	DrizzleV5ResourcesRepository,
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

	it('maps migration-shaped V5 rows with nullable JSON columns to safe defaults', async () => {
		expect.assertions(4);

		const now = new Date('2026-05-14T12:00:00.000Z');
		const snippets = new DrizzleV5ResourcesRepository(
			fakeSelectDb([commandSnippet({ metadata: null as unknown as Record<string, unknown> })])
		);
		const recordings = new DrizzleV5ResourcesRepository(
			fakeSelectDb([terminalRecording({ metadata: null as unknown as Record<string, unknown> })])
		);
		const bookmarks = new DrizzleV5ResourcesRepository(
			fakeSelectDb([fileBookmark({ metadata: null as unknown as Record<string, unknown> })])
		);
		const rdpSettings = new DrizzleV5ResourcesRepository(
			fakeSelectDb([
				rdpHostSettings({
					display: null as unknown as Record<string, unknown>,
					clipboard: null as unknown as Record<string, unknown>,
					audio: null as unknown as Record<string, unknown>,
					gateway: null as unknown as Record<string, unknown>,
					metadata: null as unknown as Record<string, unknown>,
					updatedAt: now
				})
			])
		);

		await expect(snippets.listCommandSnippets('user-1')).resolves.toEqual([
			expect.objectContaining({ metadata: {} })
		]);
		await expect(recordings.listTerminalRecordings('user-1')).resolves.toEqual([
			expect.objectContaining({ metadata: {} })
		]);
		await expect(bookmarks.listFileBookmarks('user-1')).resolves.toEqual([
			expect.objectContaining({ metadata: {} })
		]);
		await expect(rdpSettings.getRdpHostSettings('user-1', 'host-1')).resolves.toMatchObject({
			display: {},
			clipboard: {},
			audio: {},
			gateway: {},
			metadata: {}
		});
	});

	it('keeps nullable filters and user ownership boundaries precise in memory', async () => {
		expect.assertions(5);

		const repository = new InMemoryV5ResourcesRepository();
		await repository.createCommandSnippet(
			commandSnippet({
				id: 'global-snippet',
				workspaceId: null,
				hostId: null,
				name: 'Global reboot'
			})
		);
		await repository.createCommandSnippet(
			commandSnippet({
				id: 'host-snippet',
				workspaceId: 'workspace-1',
				hostId: 'host-1',
				name: 'Host reboot'
			})
		);
		await repository.createCommandSnippet(
			commandSnippet({
				id: 'other-user-snippet',
				userId: 'user-2',
				workspaceId: null,
				hostId: null,
				name: 'Other private snippet'
			})
		);
		await repository.createTerminalRecording(terminalRecording({ id: 'recording-1' }));

		await expect(
			repository.listCommandSnippets('user-1', { workspaceId: null, hostId: null })
		).resolves.toEqual([expect.objectContaining({ id: 'global-snippet' })]);
		await expect(
			repository.listCommandSnippets('user-1', { workspaceId: 'workspace-1', hostId: 'host-1' })
		).resolves.toEqual([expect.objectContaining({ id: 'host-snippet' })]);
		await expect(repository.listCommandSnippets('user-2')).resolves.toEqual([
			expect.objectContaining({ id: 'other-user-snippet' })
		]);
		await expect(
			repository.updateTerminalRecording('user-2', 'recording-1', { status: 'failed' })
		).resolves.toBeNull();
		await expect(repository.listTerminalRecordings('user-1')).resolves.toEqual([
			expect.objectContaining({ id: 'recording-1', status: 'recording' })
		]);
	});

	it('keeps host-scoped upserts and resource filters isolated by user and host', async () => {
		expect.assertions(8);

		const repository = new InMemoryV5ResourcesRepository();
		await repository.upsertTerminalPreference(terminalPreference({ fontSize: 12, theme: 'light' }));
		await repository.upsertTerminalPreference(terminalPreference({ fontSize: 18, theme: 'dark' }));
		await repository.upsertFtpsHostSettings(ftpsHostSettings({ mode: 'explicit' }));
		await repository.upsertFtpsHostSettings(
			ftpsHostSettings({
				mode: 'implicit',
				rejectUnauthorized: false,
				certificateHostname: 'ftps.example.test'
			})
		);
		await repository.upsertRdpHostSettings(
			rdpHostSettings({
				display: { width: 1280 },
				clipboard: { text: true },
				metadata: { first: true }
			})
		);
		await repository.upsertRdpHostSettings(
			rdpHostSettings({
				display: { width: 1920 },
				clipboard: { text: false, files: false },
				metadata: { second: true }
			})
		);
		await repository.createFileBookmark(fileBookmark({ id: 'ftp-1', protocol: 'ftp' }));
		await repository.createFileBookmark(fileBookmark({ id: 'sftp-1', protocol: 'sftp' }));
		await repository.createFileBookmark(
			fileBookmark({ id: 'other-host', hostId: 'host-2', protocol: 'sftp' })
		);
		await repository.createTerminalRecording(
			terminalRecording({ id: 'active-host-1', hostId: 'host-1', status: 'recording' })
		);
		await repository.createTerminalRecording(
			terminalRecording({ id: 'failed-host-1', hostId: 'host-1', status: 'failed' })
		);
		await repository.createTerminalRecording(
			terminalRecording({ id: 'active-host-2', hostId: 'host-2', status: 'recording' })
		);

		await expect(repository.getTerminalPreference('user-1', 'host-1')).resolves.toMatchObject({
			fontSize: 18,
			theme: 'dark'
		});
		await expect(repository.getFtpsHostSettings('user-1', 'host-1')).resolves.toMatchObject({
			mode: 'implicit',
			rejectUnauthorized: false,
			certificateHostname: 'ftps.example.test'
		});
		await expect(repository.getRdpHostSettings('user-1', 'host-1')).resolves.toMatchObject({
			display: { width: 1920 },
			clipboard: { text: false, files: false },
			metadata: { second: true }
		});
		await expect(repository.listFileBookmarks('user-1', { protocol: 'sftp' })).resolves.toEqual([
			expect.objectContaining({ id: 'sftp-1' }),
			expect.objectContaining({ id: 'other-host' })
		]);
		await expect(
			repository.listFileBookmarks('user-1', { hostId: 'host-1', protocol: 'sftp' })
		).resolves.toEqual([expect.objectContaining({ id: 'sftp-1' })]);
		await expect(
			repository.listTerminalRecordings('user-1', { hostId: 'host-1', status: 'recording' })
		).resolves.toEqual([expect.objectContaining({ id: 'active-host-1' })]);
		await expect(
			repository.updateTerminalRecording('user-1', 'active-host-1', {
				status: 'expired',
				retentionExpiresAt: new Date('2026-05-15T12:00:00.000Z'),
				metadata: { cleanup: 'ttl' }
			})
		).resolves.toMatchObject({ status: 'expired', metadata: { cleanup: 'ttl' } });
		await expect(repository.listTerminalRecordings('user-2')).resolves.toEqual([]);
	});
});

function queryResult<T>(rows: T[]) {
	return {
		limit: (count: number) => Promise.resolve(rows.slice(0, count)),
		then: Promise.resolve(rows).then.bind(Promise.resolve(rows))
	};
}

function fakeSelectDb<T>(rows: T[]): TermixDb {
	return {
		select: () => ({
			from: () => ({
				where: () => queryResult(rows)
			})
		})
	} as unknown as TermixDb;
}

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
