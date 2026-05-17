import type { BadgeVariant } from '$lib/components/ui/badge';
import type { SessionLaunch } from '$lib/remotes/sessions.remote';
import type { RdpClipboardPolicy } from '$lib/remotes/settings.remote';
import type { RdpFailureState } from './rdp-operator-controls';

export type RdpConnectionState =
	| 'loading'
	| 'ready'
	| 'connecting'
	| 'connected'
	| 'error'
	| 'disconnected';

export type RdpGatewayFeatures = {
	audioRedirection?: boolean;
	audioRedirectionDisabledByEnv?: boolean;
	multiMonitor?: boolean;
};

export type RdpBootstrapWithFeatures = NonNullable<SessionLaunch['rdp']> & {
	features?: RdpGatewayFeatures;
};

type RdpCredentials = SessionLaunch['rdpCredentials'];

export function rdpStatusLabel(error: string | null, connectionState: RdpConnectionState): string {
	if (error) return 'Launch failed';

	switch (connectionState) {
		case 'connected':
			return 'Connected';
		case 'connecting':
			return 'Connecting';
		case 'ready':
			return 'Gateway ready';
		case 'disconnected':
			return 'Disconnected';
		case 'error':
			return 'Client error';
		case 'loading':
			return 'Loading client';
	}
}

export function rdpStatusVariant(
	error: string | null,
	connectionState: RdpConnectionState
): BadgeVariant {
	if (error || connectionState === 'error') return 'destructive';
	if (connectionState === 'connected' || connectionState === 'ready') return 'secondary';
	return 'outline';
}

export function rdpStatusTitle(lastFailure: RdpFailureState | null, statusLabel: string): string {
	return lastFailure?.title ?? statusLabel;
}

export function rdpReconnectLabel(lastFailure: RdpFailureState | null): string {
	return lastFailure?.reconnectLabel ?? 'Retry';
}

export function rdpAudioStatusLabel(
	audioRedirection: boolean,
	gatewayFeatures: RdpGatewayFeatures | undefined
): string {
	if (gatewayFeatures?.audioRedirectionDisabledByEnv) return 'Audio disabled by deployment';
	if (audioRedirection && gatewayFeatures?.audioRedirection) return 'Audio requested';
	if (audioRedirection) return 'Audio unavailable';
	return 'Audio off';
}

export function rdpMultiMonitorLabel(gatewayFeatures: RdpGatewayFeatures | undefined): string {
	return gatewayFeatures?.multiMonitor ? 'Multi-monitor ready' : 'Single monitor fallback';
}

export function rdpClipboardStatusLabel(
	automaticClipboardEnabled: boolean,
	effectiveClipboardPolicy: RdpClipboardPolicy
): string {
	if (automaticClipboardEnabled) return 'Clipboard on';
	if (effectiveClipboardPolicy.text || effectiveClipboardPolicy.files)
		return 'Clipboard restricted';
	return 'Clipboard off';
}

export function rdpClipboardStatusVariant(
	automaticClipboardEnabled: boolean,
	effectiveClipboardPolicy: RdpClipboardPolicy
): BadgeVariant {
	if (automaticClipboardEnabled) return 'secondary';
	if (effectiveClipboardPolicy.text || effectiveClipboardPolicy.files) return 'outline';
	return 'destructive';
}

export function rdpSavedPasswordAvailable(
	rdpCredentials: RdpCredentials,
	stagedSavedPassword: string | null,
	savedPasswordCleared: boolean
): boolean {
	return (
		rdpCredentials?.source === 'saved-password' &&
		Boolean(stagedSavedPassword) &&
		!savedPasswordCleared
	);
}

export function rdpTargetCredentialState({
	bootstrap,
	rdpCredentials,
	savedPasswordAvailable
}: {
	bootstrap: SessionLaunch['rdp'] | null;
	rdpCredentials: RdpCredentials;
	savedPasswordAvailable: boolean;
}): string {
	if (savedPasswordAvailable) {
		return 'Saved RDP password is staged for this tab and will be cleared after connect.';
	}

	if (rdpCredentials?.unavailableReason) return rdpCredentials.unavailableReason;
	if (rdpCredentials?.source === 'saved-password') {
		return 'Saved RDP password is no longer staged; enter it locally to reconnect.';
	}

	return bootstrap?.credentialHint
		? 'Saved password is held server-side; enter it locally to connect.'
		: 'Enter the target RDP password locally to connect.';
}

export function canStartRdpConnection({
	bootstrap,
	api,
	rdpModule,
	sessionPassword,
	stagedSavedPassword,
	connectionState
}: {
	bootstrap: SessionLaunch['rdp'] | null;
	api: unknown;
	rdpModule: unknown;
	sessionPassword: string;
	stagedSavedPassword: string | null;
	connectionState: RdpConnectionState;
}): boolean {
	return Boolean(
		bootstrap &&
		api &&
		rdpModule &&
		(sessionPassword || stagedSavedPassword) &&
		connectionState !== 'connecting' &&
		connectionState !== 'connected'
	);
}

export function rdpFileTransferBusy(fileTransferState: string): boolean {
	return fileTransferState === 'copying' || fileTransferState === 'saving';
}

export function canCopyFileToRemoteClipboard({
	effectiveClipboardPolicy,
	connectionState,
	rdpModule,
	activeClipboardSession,
	fileTransferBusy
}: {
	effectiveClipboardPolicy: RdpClipboardPolicy;
	connectionState: RdpConnectionState;
	rdpModule: unknown;
	activeClipboardSession: unknown;
	fileTransferBusy: boolean;
}): boolean {
	return Boolean(
		effectiveClipboardPolicy.files &&
		effectiveClipboardPolicy.clientToRemote &&
		connectionState === 'connected' &&
		rdpModule &&
		activeClipboardSession &&
		!fileTransferBusy
	);
}

export function canSaveRemoteClipboardLocally({
	effectiveClipboardPolicy,
	connectionState,
	api,
	fileTransferBusy
}: {
	effectiveClipboardPolicy: RdpClipboardPolicy;
	connectionState: RdpConnectionState;
	api: unknown;
	fileTransferBusy: boolean;
}): boolean {
	return Boolean(
		effectiveClipboardPolicy.files &&
		effectiveClipboardPolicy.remoteToClient &&
		connectionState === 'connected' &&
		api &&
		!fileTransferBusy
	);
}
