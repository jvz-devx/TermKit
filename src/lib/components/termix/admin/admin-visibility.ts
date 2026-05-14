import type { AdminConnectionProtocol, AdminFailureReason } from '$lib/admin.remote';

export const adminProtocolLabels: Record<AdminConnectionProtocol, string> = {
	ssh: 'SSH',
	rdp: 'RDP',
	vnc: 'VNC',
	telnet: 'Telnet',
	ssh_tunnel: 'SSH tunnel',
	ftp: 'FTP',
	ftps: 'FTPS'
};

export function adminProtocolLabel(protocol: AdminConnectionProtocol | string): string {
	return protocol in adminProtocolLabels
		? adminProtocolLabels[protocol as AdminConnectionProtocol]
		: protocol.toUpperCase();
}

export function adminFailureTitle(reason: AdminFailureReason | null, fallbackCode?: string | null) {
	if (!reason) return fallbackCode ? humanizeCode(fallbackCode) : 'None';
	return reason.message;
}

export function adminFailureDetail(
	reason: AdminFailureReason | null,
	fallbackCode?: string | null
) {
	if (!reason) return fallbackCode ?? null;
	return `${reason.category}: ${reason.code}`;
}

export function formatAdminDuration(value: number | null) {
	if (value === null) return 'In progress';
	const totalSeconds = Math.max(0, Math.round(value / 1000));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	if (hours) return `${hours}h ${minutes}m`;
	if (minutes) return `${minutes}m ${seconds}s`;
	return `${seconds}s`;
}

export function isV4AdminProtocol(protocol: string) {
	return protocol === 'ssh_tunnel' || protocol === 'ftp' || protocol === 'ftps';
}

function humanizeCode(value: string) {
	return value.replaceAll('_', ' ').replaceAll('-', ' ');
}
