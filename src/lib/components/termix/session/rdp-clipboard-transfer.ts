export type ClipboardTelemetry = {
	direction: 'client-to-remote' | 'remote-to-client';
	kind: 'text' | 'file' | 'mixed' | 'unknown';
	status: 'ready' | 'copying' | 'saving' | 'complete' | 'failed';
	detail: string;
	at: string;
};

export type FileTransferState = 'idle' | 'copying' | 'saving' | 'complete' | 'failed';

export function createClipboardTelemetry(
	entry: Omit<ClipboardTelemetry, 'at'>,
	now: Date = new Date()
): ClipboardTelemetry {
	return { ...entry, at: now.toISOString() };
}

export function nextClipboardTelemetry(
	entries: ClipboardTelemetry[],
	entry: ClipboardTelemetry,
	limit = 4
) {
	return [entry, ...entries].slice(0, limit);
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const mib = bytes / 1024 / 1024;
	return `${mib.toFixed(mib >= 10 ? 0 : 1)} MiB`;
}

export function fileExceedsClipboardPolicy(file: File, limitMiB: number) {
	return file.size > limitMiB * 1024 * 1024;
}
