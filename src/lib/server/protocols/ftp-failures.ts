import {
	ServiceNotFoundError,
	ServicePayloadTooLargeError,
	ServiceValidationError
} from '$lib/server/services/errors';
import type { FtpActionName, FtpTarget } from './ftp';

export type FtpFailureCategory =
	| 'validation'
	| 'payload'
	| 'authentication'
	| 'authorization'
	| 'not_found'
	| 'tls'
	| 'network'
	| 'timeout'
	| 'protocol'
	| 'server';

export type FtpFailure = {
	code: string;
	category: FtpFailureCategory;
	message: string;
	status: number;
	details: Record<string, unknown>;
};

export class FtpOperationError extends Error {
	readonly status: number;
	readonly code: string;
	readonly category: FtpFailureCategory;
	readonly issues: string[];
	readonly details: Record<string, unknown>;

	constructor(failure: FtpFailure) {
		super(failure.message);
		this.name = 'FtpOperationError';
		this.status = failure.status;
		this.code = failure.code;
		this.category = failure.category;
		this.issues = [failure.message];
		this.details = failure.details;
	}
}

export function classifyFtpFailure(
	error: unknown,
	context: {
		action?: FtpActionName;
		target?: Pick<FtpTarget, 'protocol' | 'secureMode'>;
		path?: string;
	} = {}
): FtpFailure {
	const remoteCode = readNumber(error, 'code');
	const nodeCode = readString(error, 'code');
	const message = error instanceof Error ? error.message : String(error);
	const normalizedMessage = message.toLowerCase();
	const details = compactDetails({
		action: context.action,
		path: context.path,
		protocol: context.target?.protocol,
		ftpsMode: context.target?.secureMode,
		remoteCode,
		nodeCode,
		name: error instanceof Error ? error.name : undefined
	});

	if (error instanceof ServiceValidationError) {
		return {
			code: 'ftp_validation_failed',
			category: 'validation',
			message: error.message,
			status: error.status,
			details
		};
	}
	if (error instanceof ServicePayloadTooLargeError) {
		return {
			code: 'ftp_payload_too_large',
			category: 'payload',
			message: error.message,
			status: error.status,
			details
		};
	}
	if (error instanceof ServiceNotFoundError) {
		return {
			code: 'ftp_path_not_found',
			category: 'not_found',
			message: error.message,
			status: error.status,
			details
		};
	}

	if (isTlsCertificateError(nodeCode, normalizedMessage)) {
		return {
			code: 'ftp_tls_certificate_invalid',
			category: 'tls',
			message: 'FTPS certificate validation failed',
			status: 502,
			details
		};
	}

	if (nodeCode === 'ENOTFOUND' || nodeCode === 'EAI_AGAIN') {
		return {
			code: 'ftp_dns_failed',
			category: 'network',
			message: 'FTP host could not be resolved',
			status: 502,
			details
		};
	}
	if (nodeCode === 'ECONNREFUSED') {
		return {
			code: 'ftp_connection_refused',
			category: 'network',
			message: 'FTP connection was refused',
			status: 502,
			details
		};
	}
	if (nodeCode === 'ETIMEDOUT' || normalizedMessage.includes('timed out')) {
		return {
			code: 'ftp_connection_timeout',
			category: 'timeout',
			message: 'FTP connection timed out',
			status: 504,
			details
		};
	}
	if (nodeCode === 'ECONNRESET' || normalizedMessage.includes('connection reset')) {
		return {
			code: 'ftp_connection_reset',
			category: 'network',
			message: 'FTP connection was reset',
			status: 502,
			details
		};
	}

	if (remoteCode === 530 || normalizedMessage.includes('login incorrect')) {
		return {
			code: 'ftp_auth_failed',
			category: 'authentication',
			message: 'FTP authentication failed',
			status: 502,
			details
		};
	}
	if (remoteCode === 550 && /not found|no such|unavailable/.test(normalizedMessage)) {
		return {
			code: 'ftp_path_not_found',
			category: 'not_found',
			message: 'FTP path was not found',
			status: 404,
			details
		};
	}
	if (remoteCode === 550 || remoteCode === 553 || normalizedMessage.includes('permission denied')) {
		return {
			code: 'ftp_permission_denied',
			category: 'authorization',
			message: 'FTP permission denied',
			status: 403,
			details
		};
	}

	return {
		code: 'ftp_operation_failed',
		category: 'server',
		message: 'FTP operation failed',
		status: 502,
		details
	};
}

function isTlsCertificateError(code: string | undefined, message: string): boolean {
	return (
		code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
		code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
		code === 'CERT_HAS_EXPIRED' ||
		code === 'ERR_TLS_CERT_ALTNAME_INVALID' ||
		code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
		code === 'CERT_SIGNATURE_FAILURE' ||
		message.includes('certificate') ||
		message.includes('self signed')
	);
}

function compactDetails(input: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(input).filter((entry): entry is [string, string | number] => {
			const value = entry[1];
			return typeof value === 'string' || typeof value === 'number';
		})
	);
}

function readString(value: unknown, key: string): string | undefined {
	if (!isRecord(value)) return undefined;
	const field = value[key];
	return typeof field === 'string' ? field : undefined;
}

function readNumber(value: unknown, key: string): number | undefined {
	if (!isRecord(value)) return undefined;
	const field = value[key];
	return typeof field === 'number' ? field : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
