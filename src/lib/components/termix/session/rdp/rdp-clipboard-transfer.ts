export type ClipboardTelemetry = {
	direction: 'client-to-remote' | 'remote-to-client';
	kind: 'text' | 'file' | 'mixed' | 'unknown';
	status: 'ready' | 'copying' | 'saving' | 'complete' | 'failed';
	detail: string;
	at: string;
};

export type FileTransferState = 'idle' | 'copying' | 'saving' | 'complete' | 'failed';

export type RdpClipboardData = {
	addBinary(mimeType: string, binary: Uint8Array): void;
	addText(mimeType: string, text: string): void;
	free?(): void;
};

export type RdpFileTransferUpdate = {
	state: FileTransferState;
	detail: string;
	telemetry: ClipboardTelemetry;
};

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

export async function copyLocalFileToRemoteClipboard({
	file,
	limitMiB,
	createClipboardData,
	paste,
	onUpdate
}: {
	file: File;
	limitMiB: number;
	createClipboardData: () => RdpClipboardData;
	paste: (content: RdpClipboardData) => Promise<void>;
	onUpdate: (update: RdpFileTransferUpdate) => void;
}) {
	if (fileExceedsClipboardPolicy(file, limitMiB)) {
		onUpdate({
			state: 'failed',
			detail: `Selected file exceeds the ${limitMiB} MiB policy limit.`,
			telemetry: createClipboardTelemetry({
				direction: 'client-to-remote',
				kind: 'file',
				status: 'failed',
				detail: `Rejected local file of ${formatBytes(file.size)} before clipboard transfer.`
			})
		});
		return;
	}

	onUpdate({
		state: 'copying',
		detail: `Copying local file payload (${formatBytes(file.size)}) to the remote clipboard.`,
		telemetry: createClipboardTelemetry({
			direction: 'client-to-remote',
			kind: 'file',
			status: 'copying',
			detail: `Copying local file payload (${formatBytes(file.size)}) to the remote clipboard.`
		})
	});

	const clipboardData = createClipboardData();
	try {
		clipboardData.addText('text/plain', file.name);
		clipboardData.addBinary(
			file.type || 'application/octet-stream',
			new Uint8Array(await file.arrayBuffer())
		);
		await paste(clipboardData);
		onUpdate({
			state: 'complete',
			detail: `Local file payload (${formatBytes(file.size)}) is available through the RDP clipboard.`,
			telemetry: createClipboardTelemetry({
				direction: 'client-to-remote',
				kind: 'file',
				status: 'complete',
				detail: `Local file payload (${formatBytes(file.size)}) reached the RDP clipboard.`
			})
		});
	} catch (caught) {
		onUpdate({
			state: 'failed',
			detail: `Could not copy local file payload: ${errorMessage(caught)}`,
			telemetry: createClipboardTelemetry({
				direction: 'client-to-remote',
				kind: 'file',
				status: 'failed',
				detail: `Local file clipboard transfer failed: ${errorMessage(caught)}`
			})
		});
	} finally {
		clipboardData.free?.();
	}
}

export async function saveRemoteClipboardToBrowser({
	save,
	onUpdate
}: {
	save: () => Promise<void>;
	onUpdate: (update: RdpFileTransferUpdate) => void;
}) {
	onUpdate({
		state: 'saving',
		detail: 'Saving the remote clipboard payload to the browser clipboard.',
		telemetry: createClipboardTelemetry({
			direction: 'remote-to-client',
			kind: 'unknown',
			status: 'saving',
			detail: 'Saving remote clipboard payload without inspecting contents.'
		})
	});

	try {
		await save();
		onUpdate({
			state: 'complete',
			detail: 'Remote clipboard payload was copied to the browser clipboard.',
			telemetry: createClipboardTelemetry({
				direction: 'remote-to-client',
				kind: 'unknown',
				status: 'complete',
				detail: 'Remote clipboard payload was copied to the browser clipboard.'
			})
		});
	} catch (caught) {
		onUpdate({
			state: 'failed',
			detail: `Could not save remote clipboard data: ${errorMessage(caught)}`,
			telemetry: createClipboardTelemetry({
				direction: 'remote-to-client',
				kind: 'unknown',
				status: 'failed',
				detail: `Remote clipboard save failed: ${errorMessage(caught)}`
			})
		});
	}
}

function errorMessage(caught: unknown) {
	return caught instanceof Error ? caught.message : String(caught);
}
