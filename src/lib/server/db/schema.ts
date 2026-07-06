import { relations } from 'drizzle-orm';
import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';
import {
	authIdentityProvider,
	connectionProtocol,
	connectionSessionStatus,
	credentialKind,
	fileTransferProtocol,
	ftpsMode,
	hostProtocol,
	rdpLiveSessionStatus,
	sshLiveSessionStatus,
	sshTunnelSessionStatus,
	terminalRecordingStatus,
	timestamps,
	workspaceMemberRole
} from './schema-enums';
export * from './schema-enums';

export const users = pgTable(
	'users',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		username: text('username').notNull(),
		passwordHash: text('password_hash').notNull(),
		isAdmin: boolean('is_admin').notNull().default(false),
		disabledAt: timestamp('disabled_at', { withTimezone: true }),
		...timestamps
	},
	(table) => [uniqueIndex('users_username_unique').on(table.username)]
);

export const authIdentities = pgTable(
	'auth_identities',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		provider: authIdentityProvider('provider').notNull(),
		tenantId: text('tenant_id').notNull(),
		providerSubject: text('provider_subject').notNull(),
		email: text('email'),
		displayName: text('display_name'),
		metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
		...timestamps
	},
	(table) => [
		index('auth_identities_user_id_idx').on(table.userId),
		uniqueIndex('auth_identities_provider_tenant_subject_unique').on(
			table.provider,
			table.tenantId,
			table.providerSubject
		)
	]
);

export const microsoftInvitations = pgTable(
	'microsoft_invitations',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		email: text('email').notNull(),
		isAdmin: boolean('is_admin').notNull().default(false),
		invitedByUserId: uuid('invited_by_user_id').references(() => users.id, {
			onDelete: 'set null'
		}),
		acceptedUserId: uuid('accepted_user_id').references(() => users.id, {
			onDelete: 'set null'
		}),
		acceptedAt: timestamp('accepted_at', { withTimezone: true }),
		revokedAt: timestamp('revoked_at', { withTimezone: true }),
		...timestamps
	},
	(table) => [
		uniqueIndex('microsoft_invitations_email_unique').on(table.email),
		index('microsoft_invitations_invited_by_user_id_idx').on(table.invitedByUserId),
		index('microsoft_invitations_accepted_user_id_idx').on(table.acceptedUserId),
		index('microsoft_invitations_revoked_at_idx').on(table.revokedAt)
	]
);

export const sessions = pgTable(
	'sessions',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		tokenHash: text('token_hash').notNull(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
		userAgent: text('user_agent'),
		ipAddress: text('ip_address')
	},
	(table) => [
		uniqueIndex('sessions_token_hash_unique').on(table.tokenHash),
		index('sessions_user_id_idx').on(table.userId),
		index('sessions_expires_at_idx').on(table.expiresAt)
	]
);

export const workspaces = pgTable(
	'workspaces',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		name: text('name').notNull(),
		metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
		...timestamps
	},
	(table) => [index('workspaces_name_idx').on(table.name)]
);

export const workspaceMemberships = pgTable(
	'workspace_memberships',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		workspaceId: uuid('workspace_id')
			.notNull()
			.references(() => workspaces.id, { onDelete: 'cascade' }),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		role: workspaceMemberRole('role').notNull().default('member'),
		...timestamps
	},
	(table) => [
		uniqueIndex('workspace_memberships_workspace_user_unique').on(table.workspaceId, table.userId),
		index('workspace_memberships_workspace_id_idx').on(table.workspaceId),
		index('workspace_memberships_user_id_idx').on(table.userId)
	]
);

export const hostGroups = pgTable(
	'host_groups',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
		...timestamps
	},
	(table) => [
		uniqueIndex('host_groups_user_name_unique').on(table.userId, table.name),
		index('host_groups_user_id_idx').on(table.userId)
	]
);

export const credentials = pgTable(
	'credentials',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
		name: text('name').notNull(),
		kind: credentialKind('kind').notNull(),
		username: text('username'),
		encryptedSecret: text('encrypted_secret').notNull(),
		encryptionMetadata: jsonb('encryption_metadata')
			.$type<{
				algorithm: 'aes-256-gcm';
				keyVersion: number;
				iv: string;
				authTag: string;
				salt: string;
			}>()
			.notNull(),
		metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
		...timestamps
	},
	(table) => [
		index('credentials_user_id_idx').on(table.userId),
		index('credentials_workspace_id_idx').on(table.workspaceId)
	]
);

export const hosts = pgTable(
	'hosts',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
		name: text('name').notNull(),
		protocol: hostProtocol('protocol').notNull(),
		hostname: text('hostname').notNull(),
		port: integer('port').notNull(),
		username: text('username'),
		credentialId: uuid('credential_id').references(() => credentials.id, { onDelete: 'set null' }),
		folder: text('folder'),
		tags: text('tags').array().notNull().default([]),
		notes: text('notes'),
		metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
		...timestamps
	},
	(table) => [
		index('hosts_user_id_idx').on(table.userId),
		index('hosts_workspace_id_idx').on(table.workspaceId),
		index('hosts_credential_id_idx').on(table.credentialId)
	]
);

export const hostShareInvitations = pgTable(
	'host_share_invitations',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		senderUserId: uuid('sender_user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		recipientUserId: uuid('recipient_user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		hostId: uuid('host_id').references(() => hosts.id, { onDelete: 'set null' }),
		credentialId: uuid('credential_id').references(() => credentials.id, { onDelete: 'set null' }),
		includeCredentials: boolean('include_credentials').notNull().default(false),
		status: text('status').notNull().default('pending'),
		hostSnapshot: jsonb('host_snapshot').$type<Record<string, unknown>>().notNull(),
		credentialName: text('credential_name'),
		respondedAt: timestamp('responded_at', { withTimezone: true }),
		...timestamps
	},
	(table) => [
		index('host_share_invitations_recipient_status_idx').on(table.recipientUserId, table.status),
		index('host_share_invitations_sender_user_id_idx').on(table.senderUserId),
		index('host_share_invitations_host_id_idx').on(table.hostId)
	]
);

export const hostGroupMembers = pgTable(
	'host_group_members',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		hostGroupId: uuid('host_group_id')
			.notNull()
			.references(() => hostGroups.id, { onDelete: 'cascade' }),
		hostId: uuid('host_id')
			.notNull()
			.references(() => hosts.id, { onDelete: 'cascade' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		uniqueIndex('host_group_members_group_host_unique').on(table.hostGroupId, table.hostId),
		index('host_group_members_group_id_idx').on(table.hostGroupId),
		index('host_group_members_host_id_idx').on(table.hostId)
	]
);

export const connectionSessions = pgTable(
	'connection_sessions',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
		hostId: uuid('host_id').references(() => hosts.id, { onDelete: 'set null' }),
		protocol: connectionProtocol('protocol').notNull(),
		status: connectionSessionStatus('status').notNull().default('starting'),
		startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
		endedAt: timestamp('ended_at', { withTimezone: true }),
		errorCode: text('error_code'),
		errorMessage: text('error_message'),
		errorDetails: jsonb('error_details').$type<Record<string, unknown>>(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		index('connection_sessions_user_id_idx').on(table.userId),
		index('connection_sessions_workspace_id_idx').on(table.workspaceId),
		index('connection_sessions_host_id_idx').on(table.hostId)
	]
);

export const sshTunnelProfiles = pgTable(
	'ssh_tunnel_profiles',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
		sshHostId: uuid('ssh_host_id')
			.notNull()
			.references(() => hosts.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		targetHost: text('target_host').notNull(),
		targetPort: integer('target_port').notNull(),
		description: text('description'),
		...timestamps
	},
	(table) => [
		index('ssh_tunnel_profiles_user_id_idx').on(table.userId),
		index('ssh_tunnel_profiles_workspace_id_idx').on(table.workspaceId),
		index('ssh_tunnel_profiles_ssh_host_id_idx').on(table.sshHostId)
	]
);

export const sshTunnelSessions = pgTable(
	'ssh_tunnel_sessions',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		profileId: uuid('profile_id').references(() => sshTunnelProfiles.id, { onDelete: 'set null' }),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
		sshHostId: uuid('ssh_host_id').references(() => hosts.id, { onDelete: 'set null' }),
		targetHost: text('target_host').notNull(),
		targetPort: integer('target_port').notNull(),
		publicPath: text('public_path').notNull(),
		status: sshTunnelSessionStatus('status').notNull().default('starting'),
		startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
		endedAt: timestamp('ended_at', { withTimezone: true }),
		lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
		errorCode: text('error_code'),
		errorMessage: text('error_message')
	},
	(table) => [
		index('ssh_tunnel_sessions_profile_id_idx').on(table.profileId),
		index('ssh_tunnel_sessions_user_id_idx').on(table.userId),
		index('ssh_tunnel_sessions_workspace_id_idx').on(table.workspaceId),
		index('ssh_tunnel_sessions_ssh_host_id_idx').on(table.sshHostId),
		index('ssh_tunnel_sessions_status_idx').on(table.status),
		index('ssh_tunnel_sessions_last_seen_at_idx').on(table.lastSeenAt)
	]
);

export const workspaceLayouts = pgTable(
	'workspace_layouts',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
		layoutKind: text('layout_kind').notNull(),
		panes: jsonb('panes').$type<Record<string, unknown>[]>().notNull().default([]),
		tree: jsonb('tree').$type<Record<string, unknown> | null>(),
		...timestamps
	},
	(table) => [
		index('workspace_layouts_user_id_idx').on(table.userId),
		index('workspace_layouts_workspace_id_idx').on(table.workspaceId)
	]
);

export const sessionTickets = pgTable(
	'session_tickets',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		hostId: uuid('host_id')
			.notNull()
			.references(() => hosts.id, { onDelete: 'cascade' }),
		protocol: hostProtocol('protocol').notNull(),
		ticketHash: text('ticket_hash').notNull(),
		target: jsonb('target').$type<Record<string, unknown>>().notNull().default({}),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		consumedAt: timestamp('consumed_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		uniqueIndex('session_tickets_ticket_hash_unique').on(table.ticketHash),
		index('session_tickets_expires_at_idx').on(table.expiresAt)
	]
);

export const sshLiveSessions = pgTable(
	'ssh_live_sessions',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		hostId: uuid('host_id')
			.notNull()
			.references(() => hosts.id, { onDelete: 'cascade' }),
		title: text('title').notNull(),
		status: sshLiveSessionStatus('status').notNull().default('starting'),
		startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
		lastAttachedAt: timestamp('last_attached_at', { withTimezone: true }),
		detachedAt: timestamp('detached_at', { withTimezone: true }),
		expiresAt: timestamp('expires_at', { withTimezone: true }),
		endedAt: timestamp('ended_at', { withTimezone: true }),
		errorCode: text('error_code'),
		errorMessage: text('error_message'),
		terminalCols: integer('terminal_cols').notNull(),
		terminalRows: integer('terminal_rows').notNull(),
		...timestamps
	},
	(table) => [
		index('ssh_live_sessions_user_id_idx').on(table.userId),
		index('ssh_live_sessions_host_id_idx').on(table.hostId),
		index('ssh_live_sessions_status_idx').on(table.status),
		index('ssh_live_sessions_expires_at_idx').on(table.expiresAt)
	]
);

export const sshAttachTickets = pgTable(
	'ssh_attach_tickets',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		sshLiveSessionId: uuid('ssh_live_session_id')
			.notNull()
			.references(() => sshLiveSessions.id, { onDelete: 'cascade' }),
		ticketHash: text('ticket_hash').notNull(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		consumedAt: timestamp('consumed_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		uniqueIndex('ssh_attach_tickets_ticket_hash_unique').on(table.ticketHash),
		index('ssh_attach_tickets_user_id_idx').on(table.userId),
		index('ssh_attach_tickets_ssh_live_session_id_idx').on(table.sshLiveSessionId),
		index('ssh_attach_tickets_expires_at_idx').on(table.expiresAt)
	]
);

export const rdpLiveSessions = pgTable(
	'rdp_live_sessions',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		hostId: uuid('host_id')
			.notNull()
			.references(() => hosts.id, { onDelete: 'cascade' }),
		title: text('title').notNull(),
		status: rdpLiveSessionStatus('status').notNull().default('detached'),
		startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
		lastAttachedAt: timestamp('last_attached_at', { withTimezone: true }),
		endedAt: timestamp('ended_at', { withTimezone: true }),
		errorCode: text('error_code'),
		errorMessage: text('error_message'),
		...timestamps
	},
	(table) => [
		index('rdp_live_sessions_user_id_idx').on(table.userId),
		index('rdp_live_sessions_host_id_idx').on(table.hostId),
		index('rdp_live_sessions_status_idx').on(table.status)
	]
);

export const terminalPreferences = pgTable(
	'terminal_preferences',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		hostId: uuid('host_id')
			.notNull()
			.references(() => hosts.id, { onDelete: 'cascade' }),
		fontSize: integer('font_size').notNull().default(13),
		theme: text('theme').notNull().default('system'),
		scrollbackLines: integer('scrollback_lines').notNull().default(2000),
		shellTitle: text('shell_title'),
		initialCols: integer('initial_cols').notNull().default(120),
		initialRows: integer('initial_rows').notNull().default(32),
		metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
		...timestamps
	},
	(table) => [
		uniqueIndex('terminal_preferences_user_host_unique').on(table.userId, table.hostId),
		index('terminal_preferences_user_id_idx').on(table.userId),
		index('terminal_preferences_host_id_idx').on(table.hostId)
	]
);

export const commandSnippets = pgTable(
	'command_snippets',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
		hostId: uuid('host_id').references(() => hosts.id, { onDelete: 'set null' }),
		name: text('name').notNull(),
		command: text('command').notNull(),
		description: text('description'),
		tags: text('tags').array().notNull().default([]),
		metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
		...timestamps
	},
	(table) => [
		index('command_snippets_user_id_idx').on(table.userId),
		index('command_snippets_workspace_id_idx').on(table.workspaceId),
		index('command_snippets_host_id_idx').on(table.hostId)
	]
);

export const terminalRecordings = pgTable(
	'terminal_recordings',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		hostId: uuid('host_id')
			.notNull()
			.references(() => hosts.id, { onDelete: 'cascade' }),
		connectionSessionId: uuid('connection_session_id').references(() => connectionSessions.id, {
			onDelete: 'set null'
		}),
		sshLiveSessionId: uuid('ssh_live_session_id').references(() => sshLiveSessions.id, {
			onDelete: 'set null'
		}),
		status: terminalRecordingStatus('status').notNull().default('recording'),
		storageKey: text('storage_key').notNull(),
		startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
		endedAt: timestamp('ended_at', { withTimezone: true }),
		retentionExpiresAt: timestamp('retention_expires_at', { withTimezone: true }),
		metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		index('terminal_recordings_user_id_idx').on(table.userId),
		index('terminal_recordings_host_id_idx').on(table.hostId),
		index('terminal_recordings_connection_session_id_idx').on(table.connectionSessionId),
		index('terminal_recordings_ssh_live_session_id_idx').on(table.sshLiveSessionId),
		index('terminal_recordings_status_idx').on(table.status),
		index('terminal_recordings_retention_expires_at_idx').on(table.retentionExpiresAt)
	]
);

export const fileBookmarks = pgTable(
	'file_bookmarks',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		hostId: uuid('host_id')
			.notNull()
			.references(() => hosts.id, { onDelete: 'cascade' }),
		protocol: fileTransferProtocol('protocol').notNull(),
		label: text('label').notNull(),
		remotePath: text('remote_path').notNull(),
		metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
		...timestamps
	},
	(table) => [
		uniqueIndex('file_bookmarks_user_host_path_unique').on(
			table.userId,
			table.hostId,
			table.remotePath
		),
		index('file_bookmarks_user_id_idx').on(table.userId),
		index('file_bookmarks_host_id_idx').on(table.hostId),
		index('file_bookmarks_protocol_idx').on(table.protocol)
	]
);

export const ftpsHostSettings = pgTable(
	'ftps_host_settings',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		hostId: uuid('host_id')
			.notNull()
			.references(() => hosts.id, { onDelete: 'cascade' }),
		mode: ftpsMode('mode').notNull().default('explicit'),
		rejectUnauthorized: boolean('reject_unauthorized').notNull().default(true),
		certificateHostname: text('certificate_hostname'),
		metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
		...timestamps
	},
	(table) => [
		uniqueIndex('ftps_host_settings_user_host_unique').on(table.userId, table.hostId),
		index('ftps_host_settings_user_id_idx').on(table.userId),
		index('ftps_host_settings_host_id_idx').on(table.hostId)
	]
);

export const rdpHostSettings = pgTable(
	'rdp_host_settings',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		hostId: uuid('host_id')
			.notNull()
			.references(() => hosts.id, { onDelete: 'cascade' }),
		display: jsonb('display').$type<Record<string, unknown>>().notNull().default({}),
		clipboard: jsonb('clipboard').$type<Record<string, unknown>>().notNull().default({}),
		audio: jsonb('audio').$type<Record<string, unknown>>().notNull().default({}),
		gateway: jsonb('gateway').$type<Record<string, unknown>>().notNull().default({}),
		metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
		...timestamps
	},
	(table) => [
		uniqueIndex('rdp_host_settings_user_host_unique').on(table.userId, table.hostId),
		index('rdp_host_settings_user_id_idx').on(table.userId),
		index('rdp_host_settings_host_id_idx').on(table.hostId)
	]
);

export const settings = pgTable('settings', {
	key: text('key').primaryKey(),
	value: jsonb('value').$type<unknown>().notNull(),
	...timestamps
});

export const importJobs = pgTable(
	'import_jobs',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		mode: text('mode', { enum: ['validate', 'import'] }).notNull(),
		status: text('status', {
			enum: [
				'pending',
				'validating',
				'validated',
				'importing',
				'completed',
				'completed_with_errors',
				'failed'
			]
		})
			.notNull()
			.default('pending'),
		sourceName: text('source_name').notNull(),
		sourceKind: text('source_kind', { enum: ['json', 'sqlite', 'unknown'] })
			.notNull()
			.default('unknown'),
		summary: jsonb('summary')
			.$type<{
				totalRecords: number;
				validHosts: number;
				validCredentials: number;
				importedHosts: number;
				importedCredentials: number;
				skippedRecords: number;
				warnings: number;
				failures: number;
			}>()
			.notNull()
			.default({
				totalRecords: 0,
				validHosts: 0,
				validCredentials: 0,
				importedHosts: 0,
				importedCredentials: 0,
				skippedRecords: 0,
				warnings: 0,
				failures: 0
			}),
		warnings: jsonb('warnings')
			.$type<Array<{ sourceId: string; code: string; message: string }>>()
			.notNull()
			.default([]),
		failures: jsonb('failures').$type<string[]>().notNull().default([]),
		startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
		finishedAt: timestamp('finished_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		index('import_jobs_user_id_idx').on(table.userId),
		index('import_jobs_status_idx').on(table.status)
	]
);

export const usersRelations = relations(users, ({ many }) => ({
	authIdentities: many(authIdentities),
	sentMicrosoftInvitations: many(microsoftInvitations, {
		relationName: 'microsoftInvitationInvitedBy'
	}),
	acceptedMicrosoftInvitations: many(microsoftInvitations, {
		relationName: 'microsoftInvitationAcceptedBy'
	}),
	sessions: many(sessions),
	workspaceMemberships: many(workspaceMemberships),
	hostGroups: many(hostGroups),
	hosts: many(hosts),
	sentHostShareInvitations: many(hostShareInvitations, {
		relationName: 'hostShareInvitationSender'
	}),
	receivedHostShareInvitations: many(hostShareInvitations, {
		relationName: 'hostShareInvitationRecipient'
	}),
	credentials: many(credentials),
	sshTunnelProfiles: many(sshTunnelProfiles),
	sshTunnelSessions: many(sshTunnelSessions),
	workspaceLayouts: many(workspaceLayouts),
	sshLiveSessions: many(sshLiveSessions),
	sshAttachTickets: many(sshAttachTickets),
	rdpLiveSessions: many(rdpLiveSessions),
	terminalPreferences: many(terminalPreferences),
	commandSnippets: many(commandSnippets),
	terminalRecordings: many(terminalRecordings),
	fileBookmarks: many(fileBookmarks),
	ftpsHostSettings: many(ftpsHostSettings),
	rdpHostSettings: many(rdpHostSettings),
	importJobs: many(importJobs)
}));

export const authIdentitiesRelations = relations(authIdentities, ({ one }) => ({
	user: one(users, { fields: [authIdentities.userId], references: [users.id] })
}));

export const microsoftInvitationsRelations = relations(microsoftInvitations, ({ one }) => ({
	invitedBy: one(users, {
		fields: [microsoftInvitations.invitedByUserId],
		references: [users.id],
		relationName: 'microsoftInvitationInvitedBy'
	}),
	acceptedUser: one(users, {
		fields: [microsoftInvitations.acceptedUserId],
		references: [users.id],
		relationName: 'microsoftInvitationAcceptedBy'
	})
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
	user: one(users, { fields: [sessions.userId], references: [users.id] })
}));

export const workspacesRelations = relations(workspaces, ({ many }) => ({
	memberships: many(workspaceMemberships),
	hosts: many(hosts),
	credentials: many(credentials),
	connectionSessions: many(connectionSessions),
	sshTunnelProfiles: many(sshTunnelProfiles),
	sshTunnelSessions: many(sshTunnelSessions),
	workspaceLayouts: many(workspaceLayouts),
	commandSnippets: many(commandSnippets)
}));

export const workspaceMembershipsRelations = relations(workspaceMemberships, ({ one }) => ({
	workspace: one(workspaces, {
		fields: [workspaceMemberships.workspaceId],
		references: [workspaces.id]
	}),
	user: one(users, { fields: [workspaceMemberships.userId], references: [users.id] })
}));

export const hostGroupsRelations = relations(hostGroups, ({ one, many }) => ({
	user: one(users, { fields: [hostGroups.userId], references: [users.id] }),
	members: many(hostGroupMembers)
}));

export const hostsRelations = relations(hosts, ({ one, many }) => ({
	user: one(users, { fields: [hosts.userId], references: [users.id] }),
	workspace: one(workspaces, { fields: [hosts.workspaceId], references: [workspaces.id] }),
	credential: one(credentials, { fields: [hosts.credentialId], references: [credentials.id] }),
	groupMemberships: many(hostGroupMembers),
	connectionSessions: many(connectionSessions),
	sessionTickets: many(sessionTickets),
	sshTunnelProfiles: many(sshTunnelProfiles),
	sshTunnelSessions: many(sshTunnelSessions),
	sshLiveSessions: many(sshLiveSessions),
	rdpLiveSessions: many(rdpLiveSessions),
	terminalPreferences: many(terminalPreferences),
	commandSnippets: many(commandSnippets),
	terminalRecordings: many(terminalRecordings),
	fileBookmarks: many(fileBookmarks),
	ftpsHostSettings: many(ftpsHostSettings),
	rdpHostSettings: many(rdpHostSettings)
}));

export const hostShareInvitationsRelations = relations(hostShareInvitations, ({ one }) => ({
	sender: one(users, {
		fields: [hostShareInvitations.senderUserId],
		references: [users.id],
		relationName: 'hostShareInvitationSender'
	}),
	recipient: one(users, {
		fields: [hostShareInvitations.recipientUserId],
		references: [users.id],
		relationName: 'hostShareInvitationRecipient'
	}),
	host: one(hosts, { fields: [hostShareInvitations.hostId], references: [hosts.id] }),
	credential: one(credentials, {
		fields: [hostShareInvitations.credentialId],
		references: [credentials.id]
	})
}));

export const hostGroupMembersRelations = relations(hostGroupMembers, ({ one }) => ({
	group: one(hostGroups, {
		fields: [hostGroupMembers.hostGroupId],
		references: [hostGroups.id]
	}),
	host: one(hosts, { fields: [hostGroupMembers.hostId], references: [hosts.id] })
}));

export const credentialsRelations = relations(credentials, ({ one, many }) => ({
	user: one(users, { fields: [credentials.userId], references: [users.id] }),
	workspace: one(workspaces, {
		fields: [credentials.workspaceId],
		references: [workspaces.id]
	}),
	hosts: many(hosts)
}));

export const connectionSessionsRelations = relations(connectionSessions, ({ one, many }) => ({
	user: one(users, { fields: [connectionSessions.userId], references: [users.id] }),
	workspace: one(workspaces, {
		fields: [connectionSessions.workspaceId],
		references: [workspaces.id]
	}),
	host: one(hosts, { fields: [connectionSessions.hostId], references: [hosts.id] }),
	terminalRecordings: many(terminalRecordings)
}));

export const sessionTicketsRelations = relations(sessionTickets, ({ one }) => ({
	user: one(users, { fields: [sessionTickets.userId], references: [users.id] }),
	host: one(hosts, { fields: [sessionTickets.hostId], references: [hosts.id] })
}));

export const sshTunnelProfilesRelations = relations(sshTunnelProfiles, ({ one, many }) => ({
	user: one(users, { fields: [sshTunnelProfiles.userId], references: [users.id] }),
	workspace: one(workspaces, {
		fields: [sshTunnelProfiles.workspaceId],
		references: [workspaces.id]
	}),
	sshHost: one(hosts, { fields: [sshTunnelProfiles.sshHostId], references: [hosts.id] }),
	sessions: many(sshTunnelSessions)
}));

export const sshTunnelSessionsRelations = relations(sshTunnelSessions, ({ one }) => ({
	profile: one(sshTunnelProfiles, {
		fields: [sshTunnelSessions.profileId],
		references: [sshTunnelProfiles.id]
	}),
	user: one(users, { fields: [sshTunnelSessions.userId], references: [users.id] }),
	workspace: one(workspaces, {
		fields: [sshTunnelSessions.workspaceId],
		references: [workspaces.id]
	}),
	sshHost: one(hosts, { fields: [sshTunnelSessions.sshHostId], references: [hosts.id] })
}));

export const workspaceLayoutsRelations = relations(workspaceLayouts, ({ one }) => ({
	user: one(users, { fields: [workspaceLayouts.userId], references: [users.id] }),
	workspace: one(workspaces, {
		fields: [workspaceLayouts.workspaceId],
		references: [workspaces.id]
	})
}));

export const sshLiveSessionsRelations = relations(sshLiveSessions, ({ one, many }) => ({
	user: one(users, { fields: [sshLiveSessions.userId], references: [users.id] }),
	host: one(hosts, { fields: [sshLiveSessions.hostId], references: [hosts.id] }),
	attachTickets: many(sshAttachTickets),
	terminalRecordings: many(terminalRecordings)
}));

export const sshAttachTicketsRelations = relations(sshAttachTickets, ({ one }) => ({
	user: one(users, { fields: [sshAttachTickets.userId], references: [users.id] }),
	sshLiveSession: one(sshLiveSessions, {
		fields: [sshAttachTickets.sshLiveSessionId],
		references: [sshLiveSessions.id]
	})
}));

export const rdpLiveSessionsRelations = relations(rdpLiveSessions, ({ one }) => ({
	user: one(users, { fields: [rdpLiveSessions.userId], references: [users.id] }),
	host: one(hosts, { fields: [rdpLiveSessions.hostId], references: [hosts.id] })
}));

export const terminalPreferencesRelations = relations(terminalPreferences, ({ one }) => ({
	user: one(users, { fields: [terminalPreferences.userId], references: [users.id] }),
	host: one(hosts, { fields: [terminalPreferences.hostId], references: [hosts.id] })
}));

export const commandSnippetsRelations = relations(commandSnippets, ({ one }) => ({
	user: one(users, { fields: [commandSnippets.userId], references: [users.id] }),
	workspace: one(workspaces, {
		fields: [commandSnippets.workspaceId],
		references: [workspaces.id]
	}),
	host: one(hosts, { fields: [commandSnippets.hostId], references: [hosts.id] })
}));

export const terminalRecordingsRelations = relations(terminalRecordings, ({ one }) => ({
	user: one(users, { fields: [terminalRecordings.userId], references: [users.id] }),
	host: one(hosts, { fields: [terminalRecordings.hostId], references: [hosts.id] }),
	connectionSession: one(connectionSessions, {
		fields: [terminalRecordings.connectionSessionId],
		references: [connectionSessions.id]
	}),
	sshLiveSession: one(sshLiveSessions, {
		fields: [terminalRecordings.sshLiveSessionId],
		references: [sshLiveSessions.id]
	})
}));

export const fileBookmarksRelations = relations(fileBookmarks, ({ one }) => ({
	user: one(users, { fields: [fileBookmarks.userId], references: [users.id] }),
	host: one(hosts, { fields: [fileBookmarks.hostId], references: [hosts.id] })
}));

export const ftpsHostSettingsRelations = relations(ftpsHostSettings, ({ one }) => ({
	user: one(users, { fields: [ftpsHostSettings.userId], references: [users.id] }),
	host: one(hosts, { fields: [ftpsHostSettings.hostId], references: [hosts.id] })
}));

export const rdpHostSettingsRelations = relations(rdpHostSettings, ({ one }) => ({
	user: one(users, { fields: [rdpHostSettings.userId], references: [users.id] }),
	host: one(hosts, { fields: [rdpHostSettings.hostId], references: [hosts.id] })
}));

export const importJobsRelations = relations(importJobs, ({ one }) => ({
	user: one(users, { fields: [importJobs.userId], references: [users.id] })
}));
