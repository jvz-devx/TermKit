import type { HostSummary, LiveSshSessionSummary } from '$lib/termix.remote';
import type { SessionPaneKind } from './workspace-layout';

export type WorkspaceProtocol = SessionPaneKind;

export function protocolsForHost(host: HostSummary): WorkspaceProtocol[] {
	return host.protocol === 'ssh' ? ['ssh', 'sftp', 'ssh-tunnel'] : [host.protocol];
}

export function isWorkspaceProtocol(value: string): value is WorkspaceProtocol {
	return ['ssh', 'sftp', 'rdp', 'vnc', 'telnet', 'ftp', 'ftps', 'ssh-tunnel'].includes(value);
}

export function isPaneProtocolAvailable(host: HostSummary, kind: SessionPaneKind) {
	if (kind === 'sftp') return host.protocol === 'ssh';
	if (kind === 'ssh-tunnel') return host.protocol === 'ssh';
	return host.protocol === kind;
}

export function canAttachLiveSshSession(session: LiveSshSessionSummary) {
	if (session.expiresAt && Date.now() >= new Date(session.expiresAt).getTime()) return false;
	return (
		session.status === 'attached' || session.status === 'detached' || session.status === 'starting'
	);
}

export function isSshHostKeyLaunchBlocked(host: HostSummary) {
	const trust = host.hostKeyTrust;
	return trust?.status === 'unknown' && trust.trustOnFirstUse === false;
}
