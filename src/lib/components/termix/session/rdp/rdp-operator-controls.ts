import type { RdpClipboardPolicy, RdpPerformancePreset } from '$lib/remotes/settings.remote';

export type RdpDesktopSize = { width: number; height: number };
export type RdpScaleMode = 'fit' | 'fill' | 'real';
export type RdpFailureKind =
	| 'gateway-expired'
	| 'remote-disconnect'
	| 'client-error'
	| 'credential-failure';

export type RdpFailureState = {
	kind: RdpFailureKind;
	code: string;
	title: string;
	detail: string;
	reconnectLabel: string;
};

export type RdpDisplayPreset = {
	id: RdpPerformancePreset;
	label: string;
	detail: string;
	maxDesktop: RdpDesktopSize;
	resizeDebounceMs: number;
	scale: RdpScaleMode;
};

export const defaultRdpClipboardPolicy: RdpClipboardPolicy = {
	text: true,
	files: true,
	clientToRemote: true,
	remoteToClient: true,
	fileTransferSizeLimitMiB: 16
};

export const rdpDisplayPresets: Record<RdpPerformancePreset, RdpDisplayPreset> = {
	balanced: {
		id: 'balanced',
		label: 'Balanced',
		detail: 'Responsive resizing with a 1920 x 1200 desktop cap.',
		maxDesktop: { width: 1920, height: 1200 },
		resizeDebounceMs: 120,
		scale: 'fit'
	},
	performance: {
		id: 'performance',
		label: 'Performance',
		detail: 'Bandwidth-sensitive resizing with a 1366 x 768 desktop cap.',
		maxDesktop: { width: 1366, height: 768 },
		resizeDebounceMs: 220,
		scale: 'fit'
	},
	quality: {
		id: 'quality',
		label: 'Quality',
		detail: 'Sharper resizing with a 3840 x 2160 desktop cap.',
		maxDesktop: { width: 3840, height: 2160 },
		resizeDebounceMs: 50,
		scale: 'fit'
	}
};

export const rdpScaleValues: Record<RdpScaleMode, 1 | 2 | 3> = {
	fit: 1,
	fill: 2,
	real: 3
};

export function isRdpPerformancePreset(value: unknown): value is RdpPerformancePreset {
	return value === 'balanced' || value === 'performance' || value === 'quality';
}

export function normalizeRdpClipboardPolicy(
	policy: RdpClipboardPolicy | undefined,
	legacyClipboardSync: boolean
): RdpClipboardPolicy {
	const normalizedPolicy = policy ?? {
		...defaultRdpClipboardPolicy,
		text: legacyClipboardSync,
		files: legacyClipboardSync && defaultRdpClipboardPolicy.files,
		clientToRemote: legacyClipboardSync,
		remoteToClient: legacyClipboardSync
	};
	const hasPayloads = normalizedPolicy.text || normalizedPolicy.files;
	if (!hasPayloads) {
		return {
			...normalizedPolicy,
			clientToRemote: false,
			remoteToClient: false
		};
	}

	return normalizedPolicy;
}

export function canEnableAutomaticClipboard(policy: RdpClipboardPolicy): boolean {
	return policy.text && policy.clientToRemote && policy.remoteToClient;
}

export function formatClipboardPolicyDetail(policy: RdpClipboardPolicy): string {
	if (!policy.text && !policy.files) return 'Clipboard is disabled by application policy.';

	const parts = [
		policy.text ? 'Text clipboard allowed.' : 'Text clipboard disabled.',
		policy.files
			? `File clipboard reserved with a ${policy.fileTransferSizeLimitMiB} MiB limit.`
			: 'File clipboard disabled.'
	];

	if (!policy.clientToRemote) parts.push('Client to remote is blocked.');
	if (!policy.remoteToClient) parts.push('Remote to client is blocked.');
	if (!canEnableAutomaticClipboard(policy)) {
		parts.push('Automatic clipboard sync is off while restrictions are active.');
	}

	return parts.join(' ');
}

export function applyRdpDisplayPreset(
	size: RdpDesktopSize,
	preset: RdpPerformancePreset
): RdpDesktopSize {
	const maxDesktop = rdpDisplayPresets[preset].maxDesktop;
	return {
		width: Math.min(size.width, maxDesktop.width),
		height: Math.min(size.height, maxDesktop.height)
	};
}

export function normalizeDesktopDimension(
	value: number,
	minimum: number,
	maximum: number,
	requireEven: boolean
): number {
	const clamped = Math.min(maximum, Math.max(minimum, Math.round(value)));
	return requireEven && clamped % 2 === 1 ? clamped - 1 : clamped;
}

export function classifyRdpFailure(
	value: unknown,
	context: { gatewayExpired?: boolean; phase?: 'connect' | 'run' | 'client' } = {}
): RdpFailureState {
	const message = errorMessage(value);
	const lower = message.toLowerCase();

	if (context.phase === 'connect' && lower.includes('could not create rdp launch')) {
		return {
			kind: 'gateway-expired',
			code: 'rdp_launch_failed',
			title: 'RDP launch failed',
			detail:
				'RDP could not create the browser launch through the Gateway. Retry the launch, then check Gateway availability and RDP host configuration if it repeats.',
			reconnectLabel: 'Retry RDP'
		};
	}

	if (context.gatewayExpired || /\b(expired)\b/.test(lower)) {
		return {
			kind: 'gateway-expired',
			code: 'rdp_gateway_expired',
			title: 'Gateway session expired',
			detail: 'The short-lived Gateway association expired. Reconnect to request a new token.',
			reconnectLabel: 'Reconnect'
		};
	}

	if (/\b(token|association|gateway)\b/.test(lower)) {
		return {
			kind: 'gateway-expired',
			code: 'rdp_gateway_failed',
			title: 'Gateway session failed',
			detail:
				'RDP could not get or use the short-lived Gateway session. Reconnect to request a new token, and check Gateway availability if it repeats.',
			reconnectLabel: 'Retry Gateway'
		};
	}

	if (
		/\b(wrong password|logon failure|access denied|credential|credentials|authentication)\b/.test(
			lower
		)
	) {
		return {
			kind: 'credential-failure',
			code: 'rdp_credential_failed',
			title: 'Credential check failed',
			detail:
				'The RDP target rejected the supplied username or password. Reconnect after updating the credentials.',
			reconnectLabel: 'Retry credentials'
		};
	}

	if (
		context.phase === 'run' ||
		/\b(disconnect|disconnected|closed|terminated|ended)\b/.test(lower)
	) {
		return {
			kind: 'remote-disconnect',
			code: 'rdp_remote_disconnected',
			title: 'Remote disconnected',
			detail: message ? `The remote session ended: ${message}` : 'The remote session ended.',
			reconnectLabel: 'Reconnect'
		};
	}

	return {
		kind: 'client-error',
		code: rdpClientErrorCode(value),
		title: 'RDP client error',
		detail: message
			? `The browser RDP client failed: ${message}`
			: 'The browser RDP client failed.',
		reconnectLabel: 'Retry'
	};
}

export function rdpClientErrorCode(value: unknown): string {
	const message = errorMessage(value)
		.toLowerCase()
		.replace(/[^a-z0-9_:-]+/g, '_');
	return `rdp_client_${message}`.slice(0, 120);
}

export function errorMessage(value: unknown): string {
	if (value instanceof Error) return value.message;
	if (isIronError(value)) return String(value.kind());
	return String(value ?? '');
}

function isIronError(value: unknown): value is { kind: () => unknown } {
	return (
		Boolean(value) &&
		typeof value === 'object' &&
		typeof (value as { kind?: unknown }).kind === 'function'
	);
}
