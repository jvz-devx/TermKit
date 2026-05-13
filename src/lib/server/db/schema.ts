import { relations } from 'drizzle-orm';
import {
	boolean,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';

export const hostProtocol = pgEnum('host_protocol', ['ssh', 'rdp', 'vnc', 'telnet']);
export const credentialKind = pgEnum('credential_kind', ['password', 'ssh_key']);
export const connectionSessionStatus = pgEnum('connection_session_status', [
	'starting',
	'active',
	'ended',
	'failed'
]);

const timestamps = {
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
};

export const users = pgTable(
	'users',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		username: text('username').notNull(),
		passwordHash: text('password_hash').notNull(),
		isAdmin: boolean('is_admin').notNull().default(false),
		...timestamps
	},
	(table) => [uniqueIndex('users_username_unique').on(table.username)]
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

export const credentials = pgTable(
	'credentials',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
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
	(table) => [index('credentials_user_id_idx').on(table.userId)]
);

export const hosts = pgTable(
	'hosts',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		name: text('name').notNull(),
		protocol: hostProtocol('protocol').notNull(),
		hostname: text('hostname').notNull(),
		port: integer('port').notNull(),
		username: text('username'),
		credentialId: uuid('credential_id').references(() => credentials.id, { onDelete: 'set null' }),
		folder: text('folder'),
		tags: text('tags').array().notNull().default([]),
		notes: text('notes'),
		...timestamps
	},
	(table) => [
		index('hosts_user_id_idx').on(table.userId),
		index('hosts_credential_id_idx').on(table.credentialId)
	]
);

export const connectionSessions = pgTable(
	'connection_sessions',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		hostId: uuid('host_id').references(() => hosts.id, { onDelete: 'set null' }),
		protocol: hostProtocol('protocol').notNull(),
		status: connectionSessionStatus('status').notNull().default('starting'),
		startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
		endedAt: timestamp('ended_at', { withTimezone: true }),
		errorCode: text('error_code'),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(table) => [
		index('connection_sessions_user_id_idx').on(table.userId),
		index('connection_sessions_host_id_idx').on(table.hostId)
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
	sessions: many(sessions),
	hosts: many(hosts),
	credentials: many(credentials),
	importJobs: many(importJobs)
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
	user: one(users, { fields: [sessions.userId], references: [users.id] })
}));

export const hostsRelations = relations(hosts, ({ one, many }) => ({
	user: one(users, { fields: [hosts.userId], references: [users.id] }),
	credential: one(credentials, { fields: [hosts.credentialId], references: [credentials.id] }),
	connectionSessions: many(connectionSessions),
	sessionTickets: many(sessionTickets)
}));

export const credentialsRelations = relations(credentials, ({ one, many }) => ({
	user: one(users, { fields: [credentials.userId], references: [users.id] }),
	hosts: many(hosts)
}));

export const connectionSessionsRelations = relations(connectionSessions, ({ one }) => ({
	user: one(users, { fields: [connectionSessions.userId], references: [users.id] }),
	host: one(hosts, { fields: [connectionSessions.hostId], references: [hosts.id] })
}));

export const sessionTicketsRelations = relations(sessionTickets, ({ one }) => ({
	user: one(users, { fields: [sessionTickets.userId], references: [users.id] }),
	host: one(hosts, { fields: [sessionTickets.hostId], references: [hosts.id] })
}));

export const importJobsRelations = relations(importJobs, ({ one }) => ({
	user: one(users, { fields: [importJobs.userId], references: [users.id] })
}));
