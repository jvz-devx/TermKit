import { firstResolvedSecret, resolveSecretValue, type SourceSecretValue } from './termix-secrets';

export type TermixSourceProtocol =
	| 'ssh'
	| 'rdp'
	| 'vnc'
	| 'telnet'
	| 'sftp'
	| 'ftp'
	| 'ftps'
	| 'guacamole'
	| string;

export type TermixSourceRecord = {
	id: string | number;
	name?: string | null;
	label?: string | null;
	protocol?: TermixSourceProtocol | null;
	connectionType?: TermixSourceProtocol | null;
	hostname?: string | null;
	host?: string | null;
	address?: string | null;
	ip?: string | null;
	port?: number | string | null;
	username?: string | null;
	user?: string | null;
	password?: SourceSecretValue | null;
	privateKey?: SourceSecretValue | null;
	sshKey?: SourceSecretValue | null;
	key?: SourceSecretValue | null;
	credentialSourceId?: string | number | null;
	credentialName?: string | null;
	credentialUsername?: string | null;
	domain?: string | null;
	folder?: string | null;
	tags?: string[] | string | null;
	notes?: string | null;
	snippetId?: string | number | null;
	guacamoleConfig?: Record<string, unknown> | null;
	serverStats?: unknown;
	dashboard?: unknown;
	dashboards?: unknown;
	dashboardId?: string | number | null;
	docker?: unknown;
	dockerSettings?: unknown;
	dockerIntegration?: unknown;
	sshTunnel?: unknown;
	sshTunnels?: unknown;
	tunnel?: unknown;
	tunnels?: unknown;
	rbac?: unknown;
	roles?: unknown;
	permissions?: unknown;
	sharing?: unknown;
	sharedWith?: unknown;
	audit?: unknown;
	auditLog?: unknown;
	auditLogs?: unknown;
	ownerId?: string | number | null;
	ownerEmail?: string | null;
	sourceUserId?: string | number | null;
	sourceUserEmail?: string | null;
	createdByUserId?: string | number | null;
	createdByEmail?: string | null;
	raw?: Record<string, unknown>;
};

export type ImportedHostProtocol = 'ssh' | 'rdp' | 'vnc' | 'telnet';
export type ImportedCredentialKind = 'password' | 'ssh_key';

export type ImportedHostDto = {
	sourceId: string;
	name: string;
	protocol: ImportedHostProtocol;
	hostname: string;
	port: number;
	username?: string;
	credentialRef?: string;
	folder?: string;
	tags: string[];
	notes?: string;
	metadata: Record<string, string>;
};

export type ImportedCredentialDto = {
	sourceId: string;
	name: string;
	kind: ImportedCredentialKind;
	username?: string;
	secret: string;
	metadata: Record<string, string>;
};

export type ImportWarning = {
	sourceId: string;
	code:
		| 'unsupported_protocol'
		| 'missing_hostname'
		| 'invalid_port'
		| 'unsupported_field'
		| 'unsupported_user_account'
		| 'credential_requires_decryption'
		| 'credential_decryption_failed'
		| 'unsupported_encrypted_credential';
	message: string;
};

export type ImportMappingOptions = {
	sourceSecret?: string;
};

export type ImportMappingResult = {
	hosts: ImportedHostDto[];
	credentials: ImportedCredentialDto[];
	warnings: ImportWarning[];
	summary: {
		createdHosts: number;
		createdCredentials: number;
		skippedRecords: number;
		warnings: number;
	};
};

const DEFAULT_PORT_BY_PROTOCOL = {
	ssh: 22,
	rdp: 3389,
	vnc: 5900,
	telnet: 23
} satisfies Record<ImportedHostProtocol, number>;

const SUPPORTED_PROTOCOLS = new Set<ImportedHostProtocol>(['ssh', 'rdp', 'vnc', 'telnet']);

export function mapTermixRecords(
	records: TermixSourceRecord[],
	options: ImportMappingOptions = {}
): ImportMappingResult {
	const hosts: ImportedHostDto[] = [];
	const credentials: ImportedCredentialDto[] = [];
	const credentialSourceIds = new Set<string>();
	const warnings: ImportWarning[] = [];
	let skippedRecords = 0;

	for (const record of records) {
		const sourceId = String(record.id);
		const sourceAccountWarningRecorded = collectSourceAccountWarning(record, sourceId, warnings);
		const protocol = normalizeProtocol(record.protocol ?? record.connectionType);

		if (!protocol || !SUPPORTED_PROTOCOLS.has(protocol)) {
			if (!sourceAccountWarningRecorded) {
				warnings.push({
					sourceId,
					code: 'unsupported_protocol',
					message: `Record uses unsupported protocol "${record.protocol ?? record.connectionType ?? 'unknown'}".`
				});
			}
			skippedRecords += 1;
			continue;
		}

		const hostname = firstPresent(record.hostname, record.host, record.address, record.ip);
		if (!hostname) {
			warnings.push({
				sourceId,
				code: 'missing_hostname',
				message: 'Record does not include a hostname or address.'
			});
			skippedRecords += 1;
			continue;
		}

		const port = parsePort(record.port, DEFAULT_PORT_BY_PROTOCOL[protocol]);
		if (port === undefined) {
			warnings.push({
				sourceId,
				code: 'invalid_port',
				message: `Record has an invalid port "${String(record.port)}".`
			});
			skippedRecords += 1;
			continue;
		}

		const username = firstPresent(record.username, record.user);
		const credential = mapCredential(record, sourceId, username, options, warnings);
		if (credential) {
			if (!credentialSourceIds.has(credential.sourceId)) {
				credentialSourceIds.add(credential.sourceId);
				credentials.push(credential);
			}
		}

		collectUnsupportedWarnings(record, sourceId, warnings);
		const metadata = collectHostMetadata(record);

		hosts.push({
			sourceId,
			name: recordDisplayName(record, sourceId, hostname),
			protocol,
			hostname,
			port,
			username: username || undefined,
			credentialRef: credential?.sourceId,
			folder: record.folder?.trim() || undefined,
			tags: normalizeTags(record.tags),
			notes: record.notes?.trim() || undefined,
			metadata
		});
	}

	return {
		hosts,
		credentials,
		warnings,
		summary: {
			createdHosts: hosts.length,
			createdCredentials: credentials.length,
			skippedRecords,
			warnings: warnings.length
		}
	};
}

function normalizeProtocol(protocol: TermixSourceProtocol | null | undefined) {
	const normalized = protocol?.toLowerCase().trim();
	if (normalized === 'sftp') return 'ssh';
	return normalized as ImportedHostProtocol | undefined;
}

function firstPresent(...values: Array<string | null | undefined>) {
	return values.map((value) => value?.trim()).find((value) => value && value.length > 0);
}

function parsePort(port: TermixSourceRecord['port'], fallback: number) {
	if (port === null || port === undefined || port === '') return fallback;

	const parsed = typeof port === 'number' ? port : Number.parseInt(port, 10);
	if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) return undefined;

	return parsed;
}

function normalizeTags(tags: TermixSourceRecord['tags']) {
	if (!tags) return [];
	if (Array.isArray(tags)) return tags.map((tag) => tag.trim()).filter(Boolean);

	return tags
		.split(',')
		.map((tag) => tag.trim())
		.filter(Boolean);
}

function recordDisplayName(
	record: TermixSourceRecord,
	sourceId: string,
	hostname?: string
): string {
	return (
		firstPresent(
			record.name,
			record.label,
			hostname,
			record.hostname,
			record.host,
			record.address,
			record.ip
		) ?? sourceId
	);
}

function mapCredential(
	record: TermixSourceRecord,
	sourceId: string,
	username: string | undefined,
	options: ImportMappingOptions,
	warnings: ImportWarning[]
): ImportedCredentialDto | undefined {
	const privateKey = firstResolvedSecret(
		[
			{ fieldName: 'privateKey', value: record.privateKey },
			{ fieldName: 'key', value: record.key },
			{ fieldName: 'sshKey', value: record.sshKey }
		],
		sourceId,
		options,
		warnings
	);
	const credentialSourceId =
		firstPresent(String(record.credentialSourceId ?? ''), sourceId) ?? sourceId;
	const credentialUsername = firstPresent(record.credentialUsername, username);
	const metadata = credentialMetadata(sourceId, credentialSourceId);
	if (privateKey) {
		return {
			sourceId: `${credentialSourceId}:ssh-key`,
			name: firstPresent(record.credentialName) ?? `${recordDisplayName(record, sourceId)} SSH key`,
			kind: 'ssh_key',
			username: credentialUsername || undefined,
			secret: privateKey,
			metadata
		};
	}

	const password = resolveSecretValue(record.password, 'password', sourceId, options, warnings);
	if (!password) return undefined;

	return {
		sourceId: `${credentialSourceId}:password`,
		name: firstPresent(record.credentialName) ?? `${recordDisplayName(record, sourceId)} password`,
		kind: 'password',
		username: credentialUsername || undefined,
		secret: password,
		metadata
	};
}

function credentialMetadata(sourceId: string, credentialSourceId: string): Record<string, string> {
	return credentialSourceId === sourceId
		? { sourceRecordId: sourceId }
		: { sourceRecordId: sourceId, sourceCredentialId: credentialSourceId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collectUnsupportedWarnings(
	record: TermixSourceRecord,
	sourceId: string,
	warnings: ImportWarning[]
) {
	if (record.guacamoleConfig && Object.keys(record.guacamoleConfig).length > 0) {
		addUnsupportedWarning(warnings, sourceId, 'Guacamole-specific configuration was ignored.');
	}

	if (record.snippetId !== null && record.snippetId !== undefined) {
		addUnsupportedWarning(warnings, sourceId, 'Snippet reference was ignored.');
	}

	if (record.serverStats !== null && record.serverStats !== undefined) {
		addUnsupportedWarning(warnings, sourceId, 'Server statistics were ignored.');
	}

	if (hasAnySourceValue(record, ['dashboard', 'dashboards', 'dashboardId', 'dashboard_id'])) {
		addUnsupportedWarning(warnings, sourceId, 'Dashboard data was ignored.');
	}

	if (
		hasAnySourceValue(record, [
			'docker',
			'dockerSettings',
			'docker_settings',
			'dockerIntegration',
			'docker_integration'
		])
	) {
		addUnsupportedWarning(warnings, sourceId, 'Docker integration settings were ignored.');
	}

	if (
		hasAnySourceValue(record, [
			'sshTunnel',
			'ssh_tunnel',
			'sshTunnels',
			'ssh_tunnels',
			'tunnel',
			'tunnels'
		])
	) {
		addUnsupportedWarning(warnings, sourceId, 'SSH tunnel settings were ignored.');
	}

	if (hasAnySourceValue(record, ['rbac', 'roles', 'permissions'])) {
		addUnsupportedWarning(warnings, sourceId, 'RBAC records were ignored.');
	}

	if (hasAnySourceValue(record, ['sharing', 'sharedWith', 'shared_with'])) {
		addUnsupportedWarning(warnings, sourceId, 'Sharing records were ignored.');
	}

	if (hasAnySourceValue(record, ['audit', 'auditLog', 'audit_log', 'auditLogs', 'audit_logs'])) {
		addUnsupportedWarning(warnings, sourceId, 'Audit records were ignored.');
	}
}

function collectSourceAccountWarning(
	record: TermixSourceRecord,
	sourceId: string,
	warnings: ImportWarning[]
): boolean {
	if (
		!hasAnySourceValue(record, [
			'sourceUserPasswordHash',
			'source_user_password_hash',
			'ownerPasswordHash',
			'owner_password_hash',
			'userPasswordHash',
			'user_password_hash',
			'authPasswordHash',
			'auth_password_hash',
			'passwordHash',
			'password_hash',
			'users',
			'userAccounts',
			'user_accounts',
			'accounts'
		])
	) {
		return false;
	}

	warnings.push({
		sourceId,
		code: 'unsupported_user_account',
		message:
			'Source user accounts or password hashes were not imported; TermKit imports hosts into the signed-in user and requires new local or Microsoft auth.'
	});
	return true;
}

function collectHostMetadata(record: TermixSourceRecord): Record<string, string> {
	const metadata: Record<string, string> = {};
	const domain = firstPresent(record.domain);
	if (domain) metadata.domain = domain;

	const sourceUserId = firstPresentUnknown(
		record.sourceUserId,
		record.ownerId,
		record.createdByUserId,
		record.raw?.source_user_id,
		record.raw?.sourceUserId,
		record.raw?.owner_id,
		record.raw?.ownerId,
		record.raw?.created_by_user_id,
		record.raw?.createdByUserId
	);
	if (sourceUserId) metadata.sourceUserId = sourceUserId;

	const sourceUserEmail = firstPresent(
		record.sourceUserEmail,
		record.ownerEmail,
		record.createdByEmail,
		stringFromUnknown(record.raw?.source_user_email),
		stringFromUnknown(record.raw?.sourceUserEmail),
		stringFromUnknown(record.raw?.owner_email),
		stringFromUnknown(record.raw?.ownerEmail),
		stringFromUnknown(record.raw?.created_by_email),
		stringFromUnknown(record.raw?.createdByEmail)
	);
	if (sourceUserEmail) metadata.sourceUserEmail = sourceUserEmail;

	return metadata;
}

function addUnsupportedWarning(warnings: ImportWarning[], sourceId: string, message: string) {
	warnings.push({
		sourceId,
		code: 'unsupported_field',
		message
	});
}

function hasAnySourceValue(record: TermixSourceRecord, keys: string[]): boolean {
	return keys.some((key) =>
		hasSourceValue(record[key as keyof TermixSourceRecord] ?? record.raw?.[key])
	);
}

function hasSourceValue(value: unknown): boolean {
	if (value === null || value === undefined) return false;
	if (typeof value === 'string') return value.trim().length > 0;
	if (typeof value === 'boolean') return value;
	if (Array.isArray(value)) return value.length > 0;
	if (isRecord(value)) return Object.keys(value).length > 0;
	return true;
}

function firstPresentUnknown(...values: unknown[]) {
	return values.map(stringFromUnknown).find((value) => value && value.length > 0);
}

function stringFromUnknown(value: unknown): string | undefined {
	if (typeof value === 'string') return value.trim() || undefined;
	if (typeof value === 'number' && Number.isFinite(value)) return String(value);
	return undefined;
}
