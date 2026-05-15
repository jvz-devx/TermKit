export type FailureCopy = {
	title: string;
	detail: string;
	nextStep: string;
	diagnostic: string | null;
};

export function protocolLabel(protocol: string | null | undefined): string {
	if (!protocol) return 'Session';
	if (protocol === 'ssh_tunnel' || protocol === 'ssh-tunnel') return 'SSH tunnel';
	return protocol.toUpperCase();
}

export function failureCopy({
	protocol,
	code,
	message,
	fallbackTitle
}: {
	protocol?: string | null;
	code?: string | null;
	message?: string | null;
	fallbackTitle?: string;
}): FailureCopy {
	const label = protocolLabel(protocol);
	const normalized = `${code ?? ''} ${message ?? ''}`.toLowerCase();
	const normalizedText = normalized.replaceAll('_', ' ').replaceAll('-', ' ');
	const diagnostic = diagnosticText(code, message);

	if (normalizedText.includes('host key') || normalizedText.includes('fingerprint')) {
		return {
			title: 'Host key is not trusted',
			detail: `${label} stopped before credentials were sent because the host key is not enrolled.`,
			nextStep: 'Enroll the host key for this host, then reconnect.',
			diagnostic
		};
	}

	if (
		normalized.includes('auth') ||
		normalized.includes('credential') ||
		normalized.includes('password') ||
		normalized.includes('logon failure') ||
		normalized.includes('access denied')
	) {
		return {
			title: 'Authentication failed',
			detail: `${label} reached the target, but the supplied credentials were rejected.`,
			nextStep: 'Update the saved credential or enter a valid one, then retry.',
			diagnostic
		};
	}

	if (
		normalized.includes('gateway') ||
		normalized.includes('association') ||
		normalized.includes('token') ||
		normalized.includes('no available server') ||
		normalized.includes('service unavailable') ||
		normalized.includes('bad gateway') ||
		normalized.includes('upstream') ||
		normalized.includes('traefik')
	) {
		return {
			title: 'Gateway session failed',
			detail: `${label} could not reach the app backend or use the short-lived Gateway session.`,
			nextStep:
				'Retry after the service is healthy. If it repeats, check Traefik, Gateway, and backend availability.',
			diagnostic
		};
	}

	if (normalized.includes('timeout') || normalized.includes('timed out')) {
		return {
			title: 'Connection timed out',
			detail: `${label} did not receive a response from the target before the timeout.`,
			nextStep: 'Check the host, port, VPN/firewall path, and target service before retrying.',
			diagnostic
		};
	}

	if (
		normalized.includes('unreachable') ||
		normalized.includes('refused') ||
		normalized.includes('target connection') ||
		normalized.includes('websocket_close_1011') ||
		normalized.includes('proxy_closed') ||
		normalized.includes('connection failed')
	) {
		return {
			title: 'Target connection failed',
			detail: `${label} could not establish the network connection to the target service.`,
			nextStep:
				'Verify the host address, port, routing, firewall, and that the service is running.',
			diagnostic
		};
	}

	if (normalized.includes('shell')) {
		return {
			title: 'Shell failed to open',
			detail: 'SSH connected, but the target did not provide an interactive shell.',
			nextStep: 'Check the account shell, login policy, and server-side SSH logs before retrying.',
			diagnostic
		};
	}

	if (normalized.includes('ticket')) {
		return {
			title: 'Session ticket failed',
			detail: `${label} could not create or consume the short-lived browser launch ticket.`,
			nextStep: 'Retry the launch. If it repeats, refresh the page and check the app logs.',
			diagnostic
		};
	}

	if (
		normalized.includes('policy') ||
		normalized.includes('blocked') ||
		normalized.includes('forbidden')
	) {
		return {
			title: 'Action blocked',
			detail: `${label} was blocked by access policy or permissions.`,
			nextStep: 'Check the workspace policy, host ownership, and your account permissions.',
			diagnostic
		};
	}

	return {
		title: fallbackTitle ?? `${label} failed`,
		detail:
			message && !looksLikeCode(message) ? message : `${label} failed before it became usable.`,
		nextStep: 'Retry the action. If it repeats, use the diagnostic detail with server logs.',
		diagnostic
	};
}

export function failureDetail(copy: FailureCopy): string {
	return `${copy.detail} ${copy.nextStep}`;
}

export function humanizeCode(value: string | null | undefined): string {
	if (!value) return 'No diagnostic code recorded';
	return value.replaceAll('_', ' ').replaceAll('-', ' ');
}

function diagnosticText(code?: string | null, message?: string | null): string | null {
	const parts = [
		code ? `code: ${code}` : null,
		message && message !== code ? `message: ${message}` : null
	].filter(Boolean);
	return parts.length ? parts.join(' | ') : null;
}

function looksLikeCode(value: string): boolean {
	return /^[a-z0-9_-]+$/.test(value.trim());
}
