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
	port?: number | string | null;
	username?: string | null;
	user?: string | null;
	password?: string | null;
	privateKey?: string | null;
	sshKey?: string | null;
	domain?: string | null;
	folder?: string | null;
	tags?: string[] | string | null;
	notes?: string | null;
	snippetId?: string | number | null;
	guacamoleConfig?: Record<string, unknown> | null;
	serverStats?: unknown;
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
		| 'credential_requires_decryption';
	message: string;
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

export function mapTermixRecords(records: TermixSourceRecord[]): ImportMappingResult {
	const hosts: ImportedHostDto[] = [];
	const credentials: ImportedCredentialDto[] = [];
	const warnings: ImportWarning[] = [];
	let skippedRecords = 0;

	for (const record of records) {
		const sourceId = String(record.id);
		const protocol = normalizeProtocol(record.protocol ?? record.connectionType);

		if (!protocol || !SUPPORTED_PROTOCOLS.has(protocol)) {
			warnings.push({
				sourceId,
				code: 'unsupported_protocol',
				message: `Record uses unsupported protocol "${record.protocol ?? record.connectionType ?? 'unknown'}".`
			});
			skippedRecords += 1;
			continue;
		}

		const hostname = firstPresent(record.hostname, record.host, record.address);
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
		const credential = mapCredential(record, sourceId, username);
		if (credential) {
			credentials.push(credential);
		}

		collectUnsupportedWarnings(record, sourceId, warnings);

		hosts.push({
			sourceId,
			name: firstPresent(record.name, record.label) ?? hostname,
			protocol,
			hostname,
			port,
			username: username || undefined,
			credentialRef: credential?.sourceId,
			folder: record.folder?.trim() || undefined,
			tags: normalizeTags(record.tags),
			notes: record.notes?.trim() || undefined,
			metadata: record.domain?.trim() ? { domain: record.domain.trim() } : {}
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

function mapCredential(
	record: TermixSourceRecord,
	sourceId: string,
	username: string | undefined
): ImportedCredentialDto | undefined {
	const privateKey = firstPresent(record.privateKey, record.sshKey);
	if (privateKey) {
		return {
			sourceId: `${sourceId}:ssh-key`,
			name: `${firstPresent(record.name, record.label) ?? record.hostname ?? sourceId} SSH key`,
			kind: 'ssh_key',
			username: username || undefined,
			secret: privateKey,
			metadata: { sourceRecordId: sourceId }
		};
	}

	const password = record.password?.trim();
	if (!password) return undefined;

	if (password.startsWith('encrypted:')) {
		return undefined;
	}

	return {
		sourceId: `${sourceId}:password`,
		name: `${firstPresent(record.name, record.label) ?? record.hostname ?? sourceId} password`,
		kind: 'password',
		username: username || undefined,
		secret: password,
		metadata: { sourceRecordId: sourceId }
	};
}

function collectUnsupportedWarnings(
	record: TermixSourceRecord,
	sourceId: string,
	warnings: ImportWarning[]
) {
	if (record.password?.trim().startsWith('encrypted:')) {
		warnings.push({
			sourceId,
			code: 'credential_requires_decryption',
			message:
				'Encrypted credential was not imported because no source decryption hook is configured.'
		});
	}

	if (record.guacamoleConfig && Object.keys(record.guacamoleConfig).length > 0) {
		warnings.push({
			sourceId,
			code: 'unsupported_field',
			message: 'Guacamole-specific configuration was ignored.'
		});
	}

	if (record.snippetId !== null && record.snippetId !== undefined) {
		warnings.push({
			sourceId,
			code: 'unsupported_field',
			message: 'Snippet reference was ignored.'
		});
	}

	if (record.serverStats !== null && record.serverStats !== undefined) {
		warnings.push({
			sourceId,
			code: 'unsupported_field',
			message: 'Server statistics were ignored.'
		});
	}
}
