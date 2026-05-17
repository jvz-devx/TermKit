import type {
	HostSummary,
	LiveSshAttach,
	LiveSshSessionSummary
} from '$lib/remotes/sessions.remote';
import { failureCopy, failureDetail } from '$lib/termix/failure-copy';
import { canAttachLiveSshSession } from './session-workspace-protocols';

export type LiveSshAction = 'create' | 'attach' | 'rename' | 'close';
export type LiveSshErrorState = {
	action: LiveSshAction;
	message: string;
	hostId: string | null;
	sessionId: string | null;
};

export function liveSshSessionsForHost(sessions: LiveSshSessionSummary[], hostId: string) {
	return sessions.filter((session) => session.hostId === hostId);
}

export function attachableLiveSshSessionsForHost({
	sessions,
	attachments,
	hostId
}: {
	sessions: LiveSshSessionSummary[];
	attachments: Record<string, LiveSshAttach>;
	hostId: string;
}) {
	const attachedSessionIds = new Set(Object.values(attachments).map((attach) => attach.session.id));
	return liveSshSessionsForHost(sessions, hostId).filter(
		(session) => canAttachLiveSshSession(session) && !attachedSessionIds.has(session.id)
	);
}

export function liveSshErrorForHost(error: LiveSshErrorState | null, hostId: string) {
	if (!error) return null;
	return !error.hostId || error.hostId === hostId ? error : null;
}

export function liveSshActionTitle(error: LiveSshErrorState) {
	if (error.action === 'create') return 'Could not create SSH tab';
	if (error.action === 'attach') return 'Could not attach SSH tab';
	if (error.action === 'rename') return 'Could not rename SSH tab';
	return 'Could not close SSH tab';
}

export function liveSshActionDetail(error: LiveSshErrorState) {
	const copy = failureCopy({ protocol: 'ssh', message: error.message });
	return `${failureDetail(copy)} Diagnostic: ${copy.diagnostic ?? error.message}`;
}

export function isHostKeyTrustFailure(error: LiveSshErrorState) {
	return error.message.toLowerCase().includes('host key');
}

export function sshWelcome(host: HostSummary, hostname: string) {
	return [
		`$ ssh ${hostname}`,
		host.sshJumpHost.enabled && host.sshJumpHost.hostId
			? `Using jump host ${host.sshJumpHost.hostId}`
			: 'Direct SSH target',
		'Attaching live SSH session...',
		''
	];
}
