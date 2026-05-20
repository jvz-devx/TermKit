import { describe, expect, it } from 'vitest';
import {
	canCopyFileToRemoteClipboard,
	canSaveRemoteClipboardLocally,
	canStartRdpConnection,
	copyFileToRemoteClipboardDisabledReason,
	rdpAudioStatusLabel,
	rdpClipboardStatusLabel,
	rdpClipboardStatusVariant,
	rdpMultiMonitorLabel,
	saveRemoteClipboardLocallyDisabledReason,
	rdpSavedPasswordAvailable,
	rdpStatusLabel,
	rdpStatusVariant,
	rdpTargetCredentialState
} from './rdp-pane-state';
import type { RdpClipboardPolicy } from '$lib/remotes/settings.remote';
import type { SessionLaunch } from '$lib/remotes/sessions.remote';

const openClipboardPolicy: RdpClipboardPolicy = {
	text: true,
	files: true,
	clientToRemote: true,
	remoteToClient: true,
	fileTransferSizeLimitMiB: 16
};

describe('RDP pane state helpers', () => {
	it('maps connection state into status labels and variants', () => {
		expect(rdpStatusLabel(null, 'loading')).toBe('Loading client');
		expect(rdpStatusLabel(null, 'ready')).toBe('Gateway ready');
		expect(rdpStatusLabel(null, 'connected')).toBe('Connected');
		expect(rdpStatusLabel('launch failed', 'connected')).toBe('Launch failed');

		expect(rdpStatusVariant(null, 'loading')).toBe('outline');
		expect(rdpStatusVariant(null, 'ready')).toBe('secondary');
		expect(rdpStatusVariant(null, 'connected')).toBe('secondary');
		expect(rdpStatusVariant(null, 'error')).toBe('destructive');
		expect(rdpStatusVariant('launch failed', 'ready')).toBe('destructive');
	});

	it('summarizes gateway and clipboard toolbar state', () => {
		expect(rdpAudioStatusLabel(false, { audioRedirection: true })).toBe('Audio off');
		expect(rdpAudioStatusLabel(true, { audioRedirection: true })).toBe('Audio requested');
		expect(rdpAudioStatusLabel(true, { audioRedirection: false })).toBe('Audio unavailable');
		expect(rdpAudioStatusLabel(true, { audioRedirectionDisabledByEnv: true })).toBe(
			'Audio disabled by deployment'
		);

		expect(rdpMultiMonitorLabel({ multiMonitor: true })).toBe('Multi-monitor ready');
		expect(rdpMultiMonitorLabel({ multiMonitor: false })).toBe('Single monitor fallback');

		expect(rdpClipboardStatusLabel(true, openClipboardPolicy)).toBe('Clipboard on');
		expect(rdpClipboardStatusVariant(true, openClipboardPolicy)).toBe('secondary');
		expect(rdpClipboardStatusLabel(false, openClipboardPolicy)).toBe('Clipboard restricted');
		expect(rdpClipboardStatusVariant(false, openClipboardPolicy)).toBe('outline');
		expect(
			rdpClipboardStatusLabel(false, { ...openClipboardPolicy, text: false, files: false })
		).toBe('Clipboard off');
		expect(
			rdpClipboardStatusVariant(false, { ...openClipboardPolicy, text: false, files: false })
		).toBe('destructive');
	});

	it('describes saved credential bootstrap states', () => {
		const savedCredentials = {
			source: 'saved-password',
			username: 'jens',
			domain: null,
			password: 'secret'
		} as NonNullable<SessionLaunch['rdpCredentials']>;
		const hintedBootstrap = { credentialHint: true } as unknown as SessionLaunch['rdp'];

		expect(rdpSavedPasswordAvailable(savedCredentials, 'secret', false)).toBe(true);
		expect(rdpSavedPasswordAvailable(savedCredentials, null, false)).toBe(false);
		expect(
			rdpTargetCredentialState({
				bootstrap: hintedBootstrap,
				rdpCredentials: savedCredentials,
				savedPasswordAvailable: true
			})
		).toBe('Saved RDP password is staged for this tab and will be cleared after connect.');
		expect(
			rdpTargetCredentialState({
				bootstrap: hintedBootstrap,
				rdpCredentials: { ...savedCredentials, unavailableReason: 'Vault denied access.' },
				savedPasswordAvailable: false
			})
		).toBe('Vault denied access.');
		expect(
			rdpTargetCredentialState({
				bootstrap: hintedBootstrap,
				rdpCredentials: savedCredentials,
				savedPasswordAvailable: false
			})
		).toBe('Saved RDP password is no longer staged; enter it locally to reconnect.');
		expect(
			rdpTargetCredentialState({
				bootstrap: hintedBootstrap,
				rdpCredentials: null,
				savedPasswordAvailable: false
			})
		).toBe('Saved password is held server-side; enter it locally to connect.');
	});

	it('guards connect and clipboard actions against incomplete runtime state', () => {
		const bootstrap = {} as SessionLaunch['rdp'];

		expect(
			canStartRdpConnection({
				bootstrap,
				api: {},
				rdpModule: {},
				sessionPassword: 'typed',
				stagedSavedPassword: null,
				connectionState: 'ready'
			})
		).toBe(true);
		expect(
			canStartRdpConnection({
				bootstrap,
				api: {},
				rdpModule: {},
				sessionPassword: 'typed',
				stagedSavedPassword: null,
				connectionState: 'connected'
			})
		).toBe(false);

		expect(
			canCopyFileToRemoteClipboard({
				effectiveClipboardPolicy: openClipboardPolicy,
				connectionState: 'connected',
				rdpModule: {},
				activeClipboardSession: {},
				fileTransferBusy: false
			})
		).toBe(true);
		expect(
			canSaveRemoteClipboardLocally({
				effectiveClipboardPolicy: openClipboardPolicy,
				connectionState: 'connected',
				api: {},
				fileTransferBusy: false
			})
		).toBe(true);
	});

	it('explains why RDP file clipboard actions are disabled', () => {
		expect(
			copyFileToRemoteClipboardDisabledReason({
				effectiveClipboardPolicy: { ...openClipboardPolicy, files: false },
				connectionState: 'connected',
				rdpModule: {},
				activeClipboardSession: {},
				fileTransferBusy: false
			})
		).toBe('File clipboard is disabled in Settings.');
		expect(
			copyFileToRemoteClipboardDisabledReason({
				effectiveClipboardPolicy: { ...openClipboardPolicy, clientToRemote: false },
				connectionState: 'connected',
				rdpModule: {},
				activeClipboardSession: {},
				fileTransferBusy: false
			})
		).toBe('Client to remote clipboard is blocked in Settings.');
		expect(
			copyFileToRemoteClipboardDisabledReason({
				effectiveClipboardPolicy: openClipboardPolicy,
				connectionState: 'connected',
				rdpModule: {},
				activeClipboardSession: null,
				fileTransferBusy: false
			})
		).toBe('Waiting for the RDP file clipboard bridge.');
		expect(
			copyFileToRemoteClipboardDisabledReason({
				effectiveClipboardPolicy: openClipboardPolicy,
				connectionState: 'connected',
				rdpModule: {},
				activeClipboardSession: {},
				fileTransferBusy: false
			})
		).toBeNull();

		expect(
			saveRemoteClipboardLocallyDisabledReason({
				effectiveClipboardPolicy: { ...openClipboardPolicy, remoteToClient: false },
				connectionState: 'connected',
				api: {},
				fileTransferBusy: false
			})
		).toBe('Remote to client clipboard is blocked in Settings.');
		expect(
			saveRemoteClipboardLocallyDisabledReason({
				effectiveClipboardPolicy: openClipboardPolicy,
				connectionState: 'connected',
				api: {},
				fileTransferBusy: true
			})
		).toBe('A file clipboard transfer is already running.');
	});
});
