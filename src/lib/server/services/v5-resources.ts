import { and, eq } from 'drizzle-orm';
import { db, type TermixDb } from '$lib/server/db';
import {
	commandSnippets,
	fileBookmarks,
	ftpsHostSettings,
	rdpHostSettings,
	terminalPreferences,
	terminalRecordings
} from '$lib/server/db/schema';

export type TerminalRecordingStatus = 'recording' | 'completed' | 'failed' | 'expired';
export type FtpsMode = 'explicit' | 'implicit';
export type FileTransferProtocol = 'sftp' | 'ftp' | 'ftps';

export interface TerminalPreferenceRecord {
	id: string;
	userId: string;
	hostId: string;
	fontSize: number;
	theme: string;
	scrollbackLines: number;
	shellTitle: string | null;
	initialCols: number;
	initialRows: number;
	metadata: Record<string, unknown>;
	createdAt: Date;
	updatedAt: Date;
}

export interface CommandSnippetRecord {
	id: string;
	userId: string;
	workspaceId: string | null;
	hostId: string | null;
	name: string;
	command: string;
	description: string | null;
	tags: string[];
	metadata: Record<string, unknown>;
	createdAt: Date;
	updatedAt: Date;
}

export interface TerminalRecordingRecord {
	id: string;
	userId: string;
	hostId: string;
	connectionSessionId: string | null;
	sshLiveSessionId: string | null;
	status: TerminalRecordingStatus;
	storageKey: string;
	startedAt: Date;
	endedAt: Date | null;
	retentionExpiresAt: Date | null;
	metadata: Record<string, unknown>;
	createdAt: Date;
	updatedAt: Date;
}

export interface FileBookmarkRecord {
	id: string;
	userId: string;
	hostId: string;
	protocol: FileTransferProtocol;
	label: string;
	remotePath: string;
	metadata: Record<string, unknown>;
	createdAt: Date;
	updatedAt: Date;
}

export interface FtpsHostSettingsRecord {
	id: string;
	userId: string;
	hostId: string;
	mode: FtpsMode;
	rejectUnauthorized: boolean;
	certificateHostname: string | null;
	metadata: Record<string, unknown>;
	createdAt: Date;
	updatedAt: Date;
}

export interface RdpHostSettingsRecord {
	id: string;
	userId: string;
	hostId: string;
	display: Record<string, unknown>;
	clipboard: Record<string, unknown>;
	audio: Record<string, unknown>;
	gateway: Record<string, unknown>;
	metadata: Record<string, unknown>;
	createdAt: Date;
	updatedAt: Date;
}

export interface CommandSnippetFilters {
	workspaceId?: string | null;
	hostId?: string | null;
}

export interface TerminalRecordingFilters {
	hostId?: string | null;
	status?: TerminalRecordingStatus | null;
}

export interface FileBookmarkFilters {
	hostId?: string | null;
	protocol?: FileTransferProtocol | null;
}

export interface V5ResourcesRepository {
	getTerminalPreference(userId: string, hostId: string): Promise<TerminalPreferenceRecord | null>;
	upsertTerminalPreference(preference: TerminalPreferenceRecord): Promise<TerminalPreferenceRecord>;
	listCommandSnippets(
		userId: string,
		filters?: CommandSnippetFilters
	): Promise<CommandSnippetRecord[]>;
	createCommandSnippet(snippet: CommandSnippetRecord): Promise<CommandSnippetRecord>;
	createTerminalRecording(recording: TerminalRecordingRecord): Promise<TerminalRecordingRecord>;
	updateTerminalRecording(
		userId: string,
		id: string,
		patch: Partial<
			Pick<
				TerminalRecordingRecord,
				'status' | 'endedAt' | 'retentionExpiresAt' | 'metadata' | 'updatedAt'
			>
		>
	): Promise<TerminalRecordingRecord | null>;
	listTerminalRecordings(
		userId: string,
		filters?: TerminalRecordingFilters
	): Promise<TerminalRecordingRecord[]>;
	listFileBookmarks(userId: string, filters?: FileBookmarkFilters): Promise<FileBookmarkRecord[]>;
	createFileBookmark(bookmark: FileBookmarkRecord): Promise<FileBookmarkRecord>;
	getFtpsHostSettings(userId: string, hostId: string): Promise<FtpsHostSettingsRecord | null>;
	upsertFtpsHostSettings(settings: FtpsHostSettingsRecord): Promise<FtpsHostSettingsRecord>;
	getRdpHostSettings(userId: string, hostId: string): Promise<RdpHostSettingsRecord | null>;
	upsertRdpHostSettings(settings: RdpHostSettingsRecord): Promise<RdpHostSettingsRecord>;
}

type TerminalPreferenceRow = typeof terminalPreferences.$inferSelect;
type CommandSnippetRow = typeof commandSnippets.$inferSelect;
type TerminalRecordingRow = typeof terminalRecordings.$inferSelect;
type FileBookmarkRow = typeof fileBookmarks.$inferSelect;
type FtpsHostSettingsRow = typeof ftpsHostSettings.$inferSelect;
type RdpHostSettingsRow = typeof rdpHostSettings.$inferSelect;

export class DrizzleV5ResourcesRepository implements V5ResourcesRepository {
	constructor(private readonly database: TermixDb = db) {}

	async getTerminalPreference(
		userId: string,
		hostId: string
	): Promise<TerminalPreferenceRecord | null> {
		const [row] = await this.database
			.select()
			.from(terminalPreferences)
			.where(and(eq(terminalPreferences.userId, userId), eq(terminalPreferences.hostId, hostId)))
			.limit(1);

		return row ? toTerminalPreferenceRecord(row) : null;
	}

	async upsertTerminalPreference(
		preference: TerminalPreferenceRecord
	): Promise<TerminalPreferenceRecord> {
		const [row] = await this.database
			.insert(terminalPreferences)
			.values(preference)
			.onConflictDoUpdate({
				target: [terminalPreferences.userId, terminalPreferences.hostId],
				set: {
					fontSize: preference.fontSize,
					theme: preference.theme,
					scrollbackLines: preference.scrollbackLines,
					shellTitle: preference.shellTitle,
					initialCols: preference.initialCols,
					initialRows: preference.initialRows,
					metadata: preference.metadata,
					updatedAt: preference.updatedAt
				}
			})
			.returning();

		if (!row) throw new Error('Could not persist terminal preferences');
		return toTerminalPreferenceRecord(row);
	}

	async listCommandSnippets(
		userId: string,
		filters: CommandSnippetFilters = {}
	): Promise<CommandSnippetRecord[]> {
		const rows = await this.database
			.select()
			.from(commandSnippets)
			.where(eq(commandSnippets.userId, userId));

		return rows
			.filter((row) => matchesCommandSnippetFilters(row, filters))
			.map(toCommandSnippetRecord);
	}

	async createCommandSnippet(snippet: CommandSnippetRecord): Promise<CommandSnippetRecord> {
		const [row] = await this.database.insert(commandSnippets).values(snippet).returning();
		if (!row) throw new Error('Could not create command snippet');
		return toCommandSnippetRecord(row);
	}

	async createTerminalRecording(
		recording: TerminalRecordingRecord
	): Promise<TerminalRecordingRecord> {
		const [row] = await this.database.insert(terminalRecordings).values(recording).returning();
		if (!row) throw new Error('Could not create terminal recording');
		return toTerminalRecordingRecord(row);
	}

	async updateTerminalRecording(
		userId: string,
		id: string,
		patch: Partial<
			Pick<
				TerminalRecordingRecord,
				'status' | 'endedAt' | 'retentionExpiresAt' | 'metadata' | 'updatedAt'
			>
		>
	): Promise<TerminalRecordingRecord | null> {
		const [row] = await this.database
			.update(terminalRecordings)
			.set(patch)
			.where(and(eq(terminalRecordings.id, id), eq(terminalRecordings.userId, userId)))
			.returning();

		return row ? toTerminalRecordingRecord(row) : null;
	}

	async listTerminalRecordings(
		userId: string,
		filters: TerminalRecordingFilters = {}
	): Promise<TerminalRecordingRecord[]> {
		const rows = await this.database
			.select()
			.from(terminalRecordings)
			.where(eq(terminalRecordings.userId, userId));

		return rows
			.filter((row) => matchesTerminalRecordingFilters(row, filters))
			.map(toTerminalRecordingRecord);
	}

	async listFileBookmarks(
		userId: string,
		filters: FileBookmarkFilters = {}
	): Promise<FileBookmarkRecord[]> {
		const rows = await this.database
			.select()
			.from(fileBookmarks)
			.where(eq(fileBookmarks.userId, userId));

		return rows.filter((row) => matchesFileBookmarkFilters(row, filters)).map(toFileBookmarkRecord);
	}

	async createFileBookmark(bookmark: FileBookmarkRecord): Promise<FileBookmarkRecord> {
		const [row] = await this.database.insert(fileBookmarks).values(bookmark).returning();
		if (!row) throw new Error('Could not create file bookmark');
		return toFileBookmarkRecord(row);
	}

	async getFtpsHostSettings(
		userId: string,
		hostId: string
	): Promise<FtpsHostSettingsRecord | null> {
		const [row] = await this.database
			.select()
			.from(ftpsHostSettings)
			.where(and(eq(ftpsHostSettings.userId, userId), eq(ftpsHostSettings.hostId, hostId)))
			.limit(1);

		return row ? toFtpsHostSettingsRecord(row) : null;
	}

	async upsertFtpsHostSettings(settings: FtpsHostSettingsRecord): Promise<FtpsHostSettingsRecord> {
		const [row] = await this.database
			.insert(ftpsHostSettings)
			.values(settings)
			.onConflictDoUpdate({
				target: [ftpsHostSettings.userId, ftpsHostSettings.hostId],
				set: {
					mode: settings.mode,
					rejectUnauthorized: settings.rejectUnauthorized,
					certificateHostname: settings.certificateHostname,
					metadata: settings.metadata,
					updatedAt: settings.updatedAt
				}
			})
			.returning();

		if (!row) throw new Error('Could not persist FTPS host settings');
		return toFtpsHostSettingsRecord(row);
	}

	async getRdpHostSettings(userId: string, hostId: string): Promise<RdpHostSettingsRecord | null> {
		const [row] = await this.database
			.select()
			.from(rdpHostSettings)
			.where(and(eq(rdpHostSettings.userId, userId), eq(rdpHostSettings.hostId, hostId)))
			.limit(1);

		return row ? toRdpHostSettingsRecord(row) : null;
	}

	async upsertRdpHostSettings(settings: RdpHostSettingsRecord): Promise<RdpHostSettingsRecord> {
		const [row] = await this.database
			.insert(rdpHostSettings)
			.values(settings)
			.onConflictDoUpdate({
				target: [rdpHostSettings.userId, rdpHostSettings.hostId],
				set: {
					display: settings.display,
					clipboard: settings.clipboard,
					audio: settings.audio,
					gateway: settings.gateway,
					metadata: settings.metadata,
					updatedAt: settings.updatedAt
				}
			})
			.returning();

		if (!row) throw new Error('Could not persist RDP host settings');
		return toRdpHostSettingsRecord(row);
	}
}

export class InMemoryV5ResourcesRepository implements V5ResourcesRepository {
	private readonly terminalPreferences = new Map<string, TerminalPreferenceRecord>();
	private readonly commandSnippets = new Map<string, CommandSnippetRecord>();
	private readonly terminalRecordings = new Map<string, TerminalRecordingRecord>();
	private readonly fileBookmarks = new Map<string, FileBookmarkRecord>();
	private readonly ftpsHostSettings = new Map<string, FtpsHostSettingsRecord>();
	private readonly rdpHostSettings = new Map<string, RdpHostSettingsRecord>();

	async getTerminalPreference(
		userId: string,
		hostId: string
	): Promise<TerminalPreferenceRecord | null> {
		return this.terminalPreferences.get(hostScopedKey(userId, hostId)) ?? null;
	}

	async upsertTerminalPreference(
		preference: TerminalPreferenceRecord
	): Promise<TerminalPreferenceRecord> {
		this.terminalPreferences.set(hostScopedKey(preference.userId, preference.hostId), preference);
		return preference;
	}

	async listCommandSnippets(
		userId: string,
		filters: CommandSnippetFilters = {}
	): Promise<CommandSnippetRecord[]> {
		return [...this.commandSnippets.values()]
			.filter((snippet) => snippet.userId === userId)
			.filter((snippet) => matchesCommandSnippetFilters(snippet, filters));
	}

	async createCommandSnippet(snippet: CommandSnippetRecord): Promise<CommandSnippetRecord> {
		this.commandSnippets.set(snippet.id, snippet);
		return snippet;
	}

	async createTerminalRecording(
		recording: TerminalRecordingRecord
	): Promise<TerminalRecordingRecord> {
		this.terminalRecordings.set(recording.id, recording);
		return recording;
	}

	async updateTerminalRecording(
		userId: string,
		id: string,
		patch: Partial<
			Pick<
				TerminalRecordingRecord,
				'status' | 'endedAt' | 'retentionExpiresAt' | 'metadata' | 'updatedAt'
			>
		>
	): Promise<TerminalRecordingRecord | null> {
		const recording = this.terminalRecordings.get(id);
		if (!recording || recording.userId !== userId) return null;
		const updated = { ...recording, ...patch, id, userId };
		this.terminalRecordings.set(id, updated);
		return updated;
	}

	async listTerminalRecordings(
		userId: string,
		filters: TerminalRecordingFilters = {}
	): Promise<TerminalRecordingRecord[]> {
		return [...this.terminalRecordings.values()]
			.filter((recording) => recording.userId === userId)
			.filter((recording) => matchesTerminalRecordingFilters(recording, filters));
	}

	async listFileBookmarks(
		userId: string,
		filters: FileBookmarkFilters = {}
	): Promise<FileBookmarkRecord[]> {
		return [...this.fileBookmarks.values()]
			.filter((bookmark) => bookmark.userId === userId)
			.filter((bookmark) => matchesFileBookmarkFilters(bookmark, filters));
	}

	async createFileBookmark(bookmark: FileBookmarkRecord): Promise<FileBookmarkRecord> {
		this.fileBookmarks.set(bookmark.id, bookmark);
		return bookmark;
	}

	async getFtpsHostSettings(
		userId: string,
		hostId: string
	): Promise<FtpsHostSettingsRecord | null> {
		return this.ftpsHostSettings.get(hostScopedKey(userId, hostId)) ?? null;
	}

	async upsertFtpsHostSettings(settings: FtpsHostSettingsRecord): Promise<FtpsHostSettingsRecord> {
		this.ftpsHostSettings.set(hostScopedKey(settings.userId, settings.hostId), settings);
		return settings;
	}

	async getRdpHostSettings(userId: string, hostId: string): Promise<RdpHostSettingsRecord | null> {
		return this.rdpHostSettings.get(hostScopedKey(userId, hostId)) ?? null;
	}

	async upsertRdpHostSettings(settings: RdpHostSettingsRecord): Promise<RdpHostSettingsRecord> {
		this.rdpHostSettings.set(hostScopedKey(settings.userId, settings.hostId), settings);
		return settings;
	}
}

function toTerminalPreferenceRecord(row: TerminalPreferenceRow): TerminalPreferenceRecord {
	return {
		...row,
		metadata: row.metadata ?? {}
	};
}

function toCommandSnippetRecord(row: CommandSnippetRow): CommandSnippetRecord {
	return {
		...row,
		metadata: row.metadata ?? {}
	};
}

function toTerminalRecordingRecord(row: TerminalRecordingRow): TerminalRecordingRecord {
	return {
		...row,
		metadata: row.metadata ?? {}
	};
}

function toFileBookmarkRecord(row: FileBookmarkRow): FileBookmarkRecord {
	return {
		...row,
		metadata: row.metadata ?? {}
	};
}

function toFtpsHostSettingsRecord(row: FtpsHostSettingsRow): FtpsHostSettingsRecord {
	return {
		...row,
		metadata: row.metadata ?? {}
	};
}

function toRdpHostSettingsRecord(row: RdpHostSettingsRow): RdpHostSettingsRecord {
	return {
		...row,
		display: row.display ?? {},
		clipboard: row.clipboard ?? {},
		audio: row.audio ?? {},
		gateway: row.gateway ?? {},
		metadata: row.metadata ?? {}
	};
}

function matchesCommandSnippetFilters(
	snippet: CommandSnippetRecord | CommandSnippetRow,
	filters: CommandSnippetFilters
): boolean {
	if (filters.workspaceId !== undefined && snippet.workspaceId !== filters.workspaceId)
		return false;
	if (filters.hostId !== undefined && snippet.hostId !== filters.hostId) return false;
	return true;
}

function matchesTerminalRecordingFilters(
	recording: TerminalRecordingRecord | TerminalRecordingRow,
	filters: TerminalRecordingFilters
): boolean {
	if (filters.hostId !== undefined && recording.hostId !== filters.hostId) return false;
	if (filters.status && recording.status !== filters.status) return false;
	return true;
}

function matchesFileBookmarkFilters(
	bookmark: FileBookmarkRecord | FileBookmarkRow,
	filters: FileBookmarkFilters
): boolean {
	if (filters.hostId !== undefined && bookmark.hostId !== filters.hostId) return false;
	if (filters.protocol && bookmark.protocol !== filters.protocol) return false;
	return true;
}

function hostScopedKey(userId: string, hostId: string): string {
	return `${userId}:${hostId}`;
}

export const v5ResourcesRepository = new DrizzleV5ResourcesRepository();
