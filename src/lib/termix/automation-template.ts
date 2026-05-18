export const automationTemplateKinds = [
	'ssh_command',
	'file_transfer',
	'ssh_tunnel',
	'rdp_checklist',
	'operator_note'
] as const;

export type AutomationTemplateKind = (typeof automationTemplateKinds)[number];

export const automationVariableTypes = [
	'string',
	'multiline',
	'number',
	'boolean',
	'enum',
	'path',
	'host_ref',
	'credential_ref',
	'secret_ref'
] as const;

export type AutomationVariableType = (typeof automationVariableTypes)[number];

export type AutomationTemplateVisibility = 'private' | 'workspace_shared';

export type AutomationVariableValidation = {
	pattern?: string;
	minLength?: number;
	maxLength?: number;
	min?: number;
	max?: number;
	options?: string[];
};

export type AutomationTemplateVariable = {
	key: string;
	label: string;
	type: AutomationVariableType;
	required: boolean;
	defaultValue?: AutomationVariableValue;
	description?: string;
	placeholder?: string;
	validation?: AutomationVariableValidation;
};

export type AutomationVariableValue = string | number | boolean | null;

export type AutomationTemplate = {
	id: string;
	name: string;
	description: string;
	kind: AutomationTemplateKind;
	version: string;
	author: string;
	visibility: AutomationTemplateVisibility;
	workspaceId: string | null;
	tags: string[];
	variables: AutomationTemplateVariable[];
	body: string;
	createdAt: string;
	updatedAt: string;
};

export type AutomationTemplateSummary = {
	id: string;
	name: string;
	description: string;
	kind: AutomationTemplateKind;
	version: string;
	author: string;
	visibility: AutomationTemplateVisibility;
	private: boolean;
	workspaceShared: boolean;
	workspaceId: string | null;
	tags: string[];
	variableCount: number;
	requiredVariableCount: number;
	createdAt: string;
	updatedAt: string;
};

export type AutomationTemplatePreviewVariable = {
	key: string;
	label: string;
	type: AutomationVariableType;
	required: boolean;
	secret: boolean;
	source: 'provided' | 'default' | 'empty';
	value: string;
	logSafeValue: string;
	errors: string[];
};

export type AutomationTemplatePreview = {
	templateId: string;
	name: string;
	kind: AutomationTemplateKind;
	version: string;
	author: string;
	visibility: AutomationTemplateVisibility;
	private: boolean;
	workspaceShared: boolean;
	workspaceId: string | null;
	rendered: string;
	logSafeRendered: string;
	variables: AutomationTemplatePreviewVariable[];
	errors: string[];
	valid: boolean;
};

export type AutomationTemplatePreviewInput = {
	templateId?: unknown;
	values?: unknown;
};

export type AutomationTemplateValues = Record<string, unknown>;

const timestamp = '2026-05-14T00:00:00.000Z';
const secretMask = '[secret reference masked]';
const placeholderPattern = /\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g;

export const builtInAutomationTemplates: AutomationTemplate[] = [
	{
		id: 'builtin:ssh-command',
		name: 'SSH command',
		description: 'Run a reviewed command against an SSH host.',
		kind: 'ssh_command',
		version: '1.0.0',
		author: 'TermKit',
		visibility: 'workspace_shared',
		workspaceId: null,
		tags: ['ssh', 'command'],
		variables: [
			textVariable('host_name', 'Host name', { required: true, defaultValue: 'production-web-01' }),
			textVariable('hostname', 'Hostname', {
				required: true,
				defaultValue: 'web-01.internal',
				validation: { minLength: 2, maxLength: 255 }
			}),
			textVariable('username', 'Username', { required: true, defaultValue: 'deploy' }),
			numberVariable('port', 'SSH port', { required: true, defaultValue: 22, min: 1, max: 65535 }),
			{
				key: 'command',
				label: 'Command',
				type: 'multiline',
				required: true,
				defaultValue: 'systemctl status termix-agent --no-pager',
				validation: { minLength: 1, maxLength: 4000 }
			},
			enumVariable('sudo_mode', 'Privilege mode', ['none', 'sudo', 'sudo -iu root'], 'none'),
			secretVariable('credential_ref', 'Credential reference', 'credential:ssh-key:primary')
		],
		body: [
			'# SSH command',
			'Host: {{host_name}} ({{username}}@{{hostname}}:{{port}})',
			'Privilege mode: {{sudo_mode}}',
			'Credential: {{credential_ref}}',
			'',
			'```sh',
			'{{command}}',
			'```'
		].join('\n'),
		createdAt: timestamp,
		updatedAt: timestamp
	},
	{
		id: 'builtin:file-transfer',
		name: 'File transfer',
		description: 'Prepare an upload or download with source and destination paths.',
		kind: 'file_transfer',
		version: '1.0.0',
		author: 'TermKit',
		visibility: 'private',
		workspaceId: null,
		tags: ['files', 'sftp'],
		variables: [
			enumVariable('direction', 'Direction', ['upload', 'download'], 'upload'),
			enumVariable('protocol', 'Protocol', ['sftp', 'ftp', 'ftps'], 'sftp'),
			textVariable('host_name', 'Host name', { required: true, defaultValue: 'artifact-node-01' }),
			pathVariable('source_path', 'Source path', './release.tar.gz'),
			pathVariable('destination_path', 'Destination path', '/srv/releases/release.tar.gz'),
			secretVariable('credential_ref', 'Credential reference', 'credential:file-transfer:primary')
		],
		body: [
			'# File transfer',
			'Direction: {{direction}}',
			'Protocol: {{protocol}}',
			'Host: {{host_name}}',
			'Source: {{source_path}}',
			'Destination: {{destination_path}}',
			'Credential: {{credential_ref}}'
		].join('\n'),
		createdAt: timestamp,
		updatedAt: timestamp
	},
	{
		id: 'builtin:ssh-tunnel',
		name: 'SSH tunnel',
		description: 'Open a local SSH tunnel to a remote target.',
		kind: 'ssh_tunnel',
		version: '1.0.0',
		author: 'TermKit',
		visibility: 'workspace_shared',
		workspaceId: null,
		tags: ['ssh', 'tunnel'],
		variables: [
			textVariable('host_name', 'SSH host', { required: true, defaultValue: 'bastion-01' }),
			textVariable('target_host', 'Target host', {
				required: true,
				defaultValue: 'postgres.internal'
			}),
			numberVariable('target_port', 'Target port', {
				required: true,
				defaultValue: 5432,
				min: 1,
				max: 65535
			}),
			numberVariable('local_port', 'Local port', {
				required: true,
				defaultValue: 15432,
				min: 1,
				max: 65535
			}),
			textVariable('bind_address', 'Bind address', {
				required: true,
				defaultValue: '127.0.0.1',
				validation: { pattern: '^(127\\.0\\.0\\.1|localhost|0\\.0\\.0\\.0)$' }
			}),
			secretVariable('credential_ref', 'Credential reference', 'credential:ssh-key:bastion')
		],
		body: [
			'# SSH tunnel',
			'Jump host: {{host_name}}',
			'Local bind: {{bind_address}}:{{local_port}}',
			'Remote target: {{target_host}}:{{target_port}}',
			'Credential: {{credential_ref}}'
		].join('\n'),
		createdAt: timestamp,
		updatedAt: timestamp
	},
	{
		id: 'builtin:rdp-checklist',
		name: 'RDP checklist',
		description: 'Confirm RDP launch settings before connecting.',
		kind: 'rdp_checklist',
		version: '1.0.0',
		author: 'TermKit',
		visibility: 'workspace_shared',
		workspaceId: null,
		tags: ['rdp', 'checklist'],
		variables: [
			textVariable('host_name', 'RDP host', { required: true, defaultValue: 'win-admin-01' }),
			textVariable('username', 'Username', { required: true, defaultValue: 'Administrator' }),
			enumVariable(
				'clipboard_policy',
				'Clipboard policy',
				['disabled', 'text_only', 'bidirectional'],
				'text_only'
			),
			enumVariable('drive_redirection', 'Drive redirection', ['disabled', 'read_only'], 'disabled'),
			textVariable('screen_size', 'Screen size', {
				required: true,
				defaultValue: '1920x1080',
				validation: { pattern: '^\\d{3,5}x\\d{3,5}$' }
			}),
			secretVariable('credential_ref', 'Credential reference', 'credential:rdp:admin')
		],
		body: [
			'# RDP checklist',
			'- Host: {{host_name}}',
			'- User: {{username}}',
			'- Screen: {{screen_size}}',
			'- Clipboard: {{clipboard_policy}}',
			'- Drive redirection: {{drive_redirection}}',
			'- Credential: {{credential_ref}}',
			'- Operator verified host ownership and session purpose.'
		].join('\n'),
		createdAt: timestamp,
		updatedAt: timestamp
	},
	{
		id: 'builtin:operator-note',
		name: 'Operator note',
		description: 'Write a structured log-safe operator note.',
		kind: 'operator_note',
		version: '1.0.0',
		author: 'TermKit',
		visibility: 'private',
		workspaceId: null,
		tags: ['ops', 'notes'],
		variables: [
			textVariable('summary', 'Summary', {
				required: true,
				defaultValue: 'Restarted service after deploy',
				validation: { minLength: 3, maxLength: 160 }
			}),
			enumVariable('impact', 'Impact', ['none', 'low', 'medium', 'high'], 'low'),
			{
				key: 'details',
				label: 'Details',
				type: 'multiline',
				required: true,
				defaultValue: 'Observed elevated errors, restarted the service, and verified recovery.',
				validation: { minLength: 3, maxLength: 4000 }
			},
			textVariable('ticket', 'Ticket', {
				required: false,
				defaultValue: 'OPS-1234',
				validation: { maxLength: 80 }
			}),
			secretVariable('secret_ref', 'Related secret reference', 'sops:termix/service-token')
		],
		body: [
			'# Operator note',
			'Summary: {{summary}}',
			'Impact: {{impact}}',
			'Ticket: {{ticket}}',
			'Related secret: {{secret_ref}}',
			'',
			'{{details}}'
		].join('\n'),
		createdAt: timestamp,
		updatedAt: timestamp
	}
];

export function toAutomationTemplateSummary(
	template: AutomationTemplate
): AutomationTemplateSummary {
	return {
		id: template.id,
		name: template.name,
		description: template.description,
		kind: template.kind,
		version: template.version,
		author: template.author,
		visibility: template.visibility,
		private: template.visibility === 'private',
		workspaceShared: template.visibility === 'workspace_shared',
		workspaceId: template.workspaceId,
		tags: [...template.tags],
		variableCount: template.variables.length,
		requiredVariableCount: template.variables.filter((variable) => variable.required).length,
		createdAt: template.createdAt,
		updatedAt: template.updatedAt
	};
}

export function renderAutomationTemplatePreview(
	template: AutomationTemplate,
	values: AutomationTemplateValues = {}
): AutomationTemplatePreview {
	const variables = template.variables.map((variable) => resolvePreviewVariable(variable, values));
	const variableMap = new Map(variables.map((variable) => [variable.key, variable]));
	const errors = variables.flatMap((variable) =>
		variable.errors.map((error) => `${variable.label}: ${error}`)
	);
	const rendered = renderBody(template.body, variableMap, false);
	const logSafeRendered = renderBody(template.body, variableMap, true);

	return {
		templateId: template.id,
		name: template.name,
		kind: template.kind,
		version: template.version,
		author: template.author,
		visibility: template.visibility,
		private: template.visibility === 'private',
		workspaceShared: template.visibility === 'workspace_shared',
		workspaceId: template.workspaceId,
		rendered,
		logSafeRendered,
		variables,
		errors,
		valid: errors.length === 0
	};
}

function resolvePreviewVariable(
	variable: AutomationTemplateVariable,
	values: AutomationTemplateValues
): AutomationTemplatePreviewVariable {
	const hasProvidedValue = Object.hasOwn(values, variable.key);
	const hasDefaultValue = variable.defaultValue !== undefined;
	const rawValue = hasProvidedValue
		? values[variable.key]
		: hasDefaultValue
			? variable.defaultValue
			: null;
	const source = hasProvidedValue ? 'provided' : hasDefaultValue ? 'default' : 'empty';
	const errors = validateVariableValue(variable, rawValue);
	const value = stringifyVariableValue(variable, rawValue);
	const logSafeValue = isSecretVariable(variable) ? secretMask : value;

	return {
		key: variable.key,
		label: variable.label,
		type: variable.type,
		required: variable.required,
		secret: isSecretVariable(variable),
		source,
		value: isSecretVariable(variable) ? secretMask : value,
		logSafeValue,
		errors
	};
}

function validateVariableValue(variable: AutomationTemplateVariable, value: unknown): string[] {
	const errors: string[] = [];
	const empty = value === null || value === undefined || value === '';

	if (variable.required && empty) {
		errors.push('is required');
		return errors;
	}
	if (empty) return errors;

	if (variable.type === 'number') {
		const numberValue = typeof value === 'number' ? value : Number(value);
		if (!Number.isFinite(numberValue)) {
			errors.push('must be a number');
			return errors;
		}
		if (variable.validation?.min !== undefined && numberValue < variable.validation.min) {
			errors.push(`must be at least ${variable.validation.min}`);
		}
		if (variable.validation?.max !== undefined && numberValue > variable.validation.max) {
			errors.push(`must be at most ${variable.validation.max}`);
		}
		return errors;
	}

	if (variable.type === 'boolean') {
		if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
			errors.push('must be true or false');
		}
		return errors;
	}

	const stringValue = String(value);
	if (
		variable.validation?.minLength !== undefined &&
		stringValue.length < variable.validation.minLength
	) {
		errors.push(`must be at least ${variable.validation.minLength} characters`);
	}
	if (
		variable.validation?.maxLength !== undefined &&
		stringValue.length > variable.validation.maxLength
	) {
		errors.push(`must be at most ${variable.validation.maxLength} characters`);
	}
	if (variable.validation?.options && !variable.validation.options.includes(stringValue)) {
		errors.push(`must be one of ${variable.validation.options.join(', ')}`);
	}
	if (variable.validation?.pattern) {
		const pattern = new RegExp(variable.validation.pattern);
		if (!pattern.test(stringValue)) errors.push('has an invalid format');
	}

	return errors;
}

function renderBody(
	body: string,
	variableMap: Map<string, AutomationTemplatePreviewVariable>,
	logSafe: boolean
): string {
	return body.replace(placeholderPattern, (_match, key: string) => {
		const variable = variableMap.get(key);
		if (!variable) return '';
		return logSafe ? variable.logSafeValue : variable.value;
	});
}

function stringifyVariableValue(
	variable: AutomationTemplateVariable,
	value: AutomationVariableValue | unknown
): string {
	if (value === null || value === undefined) return '';
	if (variable.type === 'boolean') {
		if (typeof value === 'boolean') return value ? 'true' : 'false';
		return value === 'true' ? 'true' : 'false';
	}
	if (variable.type === 'number') {
		const numberValue = typeof value === 'number' ? value : Number(value);
		return Number.isFinite(numberValue) ? String(numberValue) : String(value);
	}
	return String(value);
}

function isSecretVariable(variable: AutomationTemplateVariable): boolean {
	return variable.type === 'secret_ref';
}

function textVariable(
	key: string,
	label: string,
	options: {
		required: boolean;
		defaultValue?: string;
		validation?: AutomationVariableValidation;
	}
): AutomationTemplateVariable {
	return {
		key,
		label,
		type: 'string',
		required: options.required,
		defaultValue: options.defaultValue,
		validation: options.validation
	};
}

function numberVariable(
	key: string,
	label: string,
	options: {
		required: boolean;
		defaultValue: number;
		min: number;
		max: number;
	}
): AutomationTemplateVariable {
	return {
		key,
		label,
		type: 'number',
		required: options.required,
		defaultValue: options.defaultValue,
		validation: { min: options.min, max: options.max }
	};
}

function enumVariable(
	key: string,
	label: string,
	options: string[],
	defaultValue: string
): AutomationTemplateVariable {
	return {
		key,
		label,
		type: 'enum',
		required: true,
		defaultValue,
		validation: { options }
	};
}

function pathVariable(
	key: string,
	label: string,
	defaultValue: string
): AutomationTemplateVariable {
	return {
		key,
		label,
		type: 'path',
		required: true,
		defaultValue,
		validation: { minLength: 1, maxLength: 4096 }
	};
}

function secretVariable(
	key: string,
	label: string,
	defaultValue: string
): AutomationTemplateVariable {
	return {
		key,
		label,
		type: 'secret_ref',
		required: true,
		defaultValue,
		validation: { minLength: 1, maxLength: 512 }
	};
}
