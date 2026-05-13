import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { env as privateEnv } from '$env/dynamic/private';
import type { ConsumedTicket } from '$lib/server/protocols';

export type RdpGatewayConfig = {
	gatewayUrl: string;
	gatewayPublicUrl: string;
	provisionerSubject: string;
	provisionerKey: string;
	sessionLifetimeSeconds: number;
	desktop: {
		width: number;
		height: number;
	};
};

export type RdpGatewayBootstrap = {
	provider: 'devolutions-gateway';
	protocol: 'rdp';
	sessionId: string;
	destination: string;
	gatewayUrl: string;
	gatewayPublicUrl: string;
	associationToken: string;
	preconnectionBlob: string;
	expiresAt: string;
	desktop: {
		width: number;
		height: number;
	};
	identity: {
		username: string | null;
		domain: string | null;
	};
	credential: {
		kind: 'password';
		username: string | null;
		password: string;
	} | null;
};

export class RdpGatewayConfigurationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'RdpGatewayConfigurationError';
	}
}

export class RdpGatewayProvisioningError extends Error {
	constructor(
		message: string,
		readonly status?: number
	) {
		super(message);
		this.name = 'RdpGatewayProvisioningError';
	}
}

type GatewayFetch = (
	input: string | URL,
	init?: RequestInit
) => Promise<Pick<Response, 'ok' | 'status' | 'statusText' | 'text'>>;

export class RdpGatewayBootstrapper {
	constructor(
		private readonly config: RdpGatewayConfig = loadRdpGatewayConfig(),
		private readonly gatewayFetch: GatewayFetch = fetch
	) {}

	async bootstrap(ticket: ConsumedTicket): Promise<RdpGatewayBootstrap> {
		if (ticket.protocol !== 'rdp') {
			throw new RdpGatewayConfigurationError('RDP Gateway bootstrap requires an RDP ticket');
		}

		const sessionId = randomUUID();
		const destination = toTcpTarget(ticket.target.host, ticket.target.port);
		const appToken = await this.signAppToken(ticket.userId);
		const associationToken = await this.signSessionToken({
			appToken,
			destination,
			sessionId
		});
		const expiresAt = new Date(Date.now() + this.config.sessionLifetimeSeconds * 1000);
		const credential = toRdpCredential(ticket);

		return {
			provider: 'devolutions-gateway',
			protocol: 'rdp',
			sessionId,
			destination,
			gatewayUrl: this.config.gatewayUrl,
			gatewayPublicUrl: this.config.gatewayPublicUrl,
			associationToken,
			preconnectionBlob: associationToken,
			expiresAt: expiresAt.toISOString(),
			desktop: this.config.desktop,
			identity: {
				username: ticket.target.username ?? credential?.username ?? null,
				domain: readStringMetadata(ticket.metadata, 'domain')
			},
			credential
		};
	}

	private async signAppToken(userId: string): Promise<string> {
		return this.postText('/jet/webapp/app-token', {
			headers: {
				Authorization: `Basic ${Buffer.from(
					`${this.config.provisionerSubject}:${this.config.provisionerKey}`
				).toString('base64')}`
			},
			body: {
				content_type: 'WEBAPP',
				subject: userId
			},
			errorLabel: 'app-token'
		});
	}

	private async signSessionToken({
		appToken,
		destination,
		sessionId
	}: {
		appToken: string;
		destination: string;
		sessionId: string;
	}): Promise<string> {
		return this.postText('/jet/webapp/session-token', {
			headers: {
				Authorization: `Bearer ${appToken}`
			},
			body: {
				content_type: 'ASSOCIATION',
				protocol: 'rdp',
				destination,
				lifetime: this.config.sessionLifetimeSeconds,
				session_id: sessionId
			},
			errorLabel: 'session-token'
		});
	}

	private async postText(
		path: string,
		{
			headers,
			body,
			errorLabel
		}: {
			headers: Record<string, string>;
			body: Record<string, unknown>;
			errorLabel: string;
		}
	): Promise<string> {
		const response = await this.gatewayFetch(new URL(path, `${this.config.gatewayUrl}/`), {
			method: 'POST',
			headers: {
				Accept: 'text/plain',
				'Content-Type': 'application/json',
				...headers
			},
			body: JSON.stringify(body)
		}).catch((error: unknown) => {
			throw new RdpGatewayProvisioningError(
				`Could not reach Devolutions Gateway ${errorLabel}: ${errorMessage(error)}`
			);
		});

		const text = await response.text();
		if (!response.ok) {
			throw new RdpGatewayProvisioningError(
				`Devolutions Gateway ${errorLabel} failed (${response.status} ${response.statusText})${formatGatewayBody(
					text
				)}`,
				response.status
			);
		}

		const token = text.trim();
		if (!token) {
			throw new RdpGatewayProvisioningError(
				`Devolutions Gateway ${errorLabel} returned an empty token`,
				response.status
			);
		}

		return token;
	}
}

export function loadRdpGatewayConfig(
	env: Partial<Record<string, string | undefined>> = privateEnv
): RdpGatewayConfig {
	const gatewayUrl = normalizeUrl(env.GATEWAY_URL);
	const gatewayPublicUrl = normalizeUrl(env.GATEWAY_PUBLIC_URL) ?? gatewayUrl;
	const provisionerKey = env.GATEWAY_PROVISIONER_KEY?.trim();
	const provisionerSubject = env.GATEWAY_PROVISIONER_SUBJECT?.trim() || 'TermixKit';
	const sessionLifetimeSeconds = readPositiveInteger(
		env.GATEWAY_RDP_SESSION_TTL_SECONDS,
		60,
		7200,
		60
	);
	const width = readPositiveInteger(env.GATEWAY_RDP_WIDTH, 640, 7680, 1440);
	const height = readPositiveInteger(env.GATEWAY_RDP_HEIGHT, 480, 4320, 900);
	const issues: string[] = [];

	if (!gatewayUrl) issues.push('GATEWAY_URL is required for RDP launches');
	if (!provisionerKey) issues.push('GATEWAY_PROVISIONER_KEY is required for RDP launches');
	if (issues.length > 0) throw new RdpGatewayConfigurationError(issues.join('; '));

	return {
		gatewayUrl: gatewayUrl!,
		gatewayPublicUrl: gatewayPublicUrl!,
		provisionerSubject,
		provisionerKey: provisionerKey!,
		sessionLifetimeSeconds,
		desktop: {
			width,
			height
		}
	};
}

function toRdpCredential(ticket: ConsumedTicket): RdpGatewayBootstrap['credential'] {
	const credential = ticket.target.credential;
	if (!credential) return null;
	if (credential.kind !== 'password') {
		throw new RdpGatewayConfigurationError('RDP launch requires a password credential');
	}

	return {
		kind: 'password',
		username: credential.username ?? ticket.target.username ?? null,
		password: credential.password
	};
}

function toTcpTarget(host: string, port: number): string {
	const bracketedHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
	return `tcp://${bracketedHost}:${port}`;
}

function readStringMetadata(
	metadata: Record<string, unknown> | undefined,
	key: string
): string | null {
	const value = metadata?.[key];
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeUrl(value: string | undefined): string | null {
	const trimmed = value?.trim();
	if (!trimmed) return null;

	try {
		const url = new URL(trimmed);
		return url.toString().replace(/\/$/, '');
	} catch {
		throw new RdpGatewayConfigurationError(`${trimmed} is not a valid Gateway URL`);
	}
}

function readPositiveInteger(
	value: string | undefined,
	minimum: number,
	maximum: number,
	fallback: number
): number {
	const number = value ? Number(value) : fallback;
	if (!Number.isInteger(number) || number < minimum || number > maximum) return fallback;
	return number;
}

function formatGatewayBody(body: string): string {
	const trimmed = body.trim();
	if (!trimmed) return '';
	return `: ${trimmed.slice(0, 300)}`;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
