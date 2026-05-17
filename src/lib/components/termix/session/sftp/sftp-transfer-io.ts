import type { RemoteEntry } from './file-manager-state';
import { apiErrorMessage, readApiBody, responseError } from './sftp-api-response';

export type UploadFileInput = {
	url: string;
	file: globalThis.File;
	onProgress: (loaded: number) => void;
	onAbortReady: (abort: () => void) => void;
	onAbortClear: () => void;
};

export function uploadFile({
	url,
	file,
	onProgress,
	onAbortReady,
	onAbortClear
}: UploadFileInput): Promise<void> {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		onAbortReady(() => xhr.abort());

		xhr.upload.onprogress = (event) => {
			if (event.lengthComputable) onProgress(event.loaded);
		};
		xhr.onload = () => {
			onAbortClear();
			if (xhr.status >= 200 && xhr.status < 300) {
				onProgress(file.size);
				resolve();
				return;
			}
			reject(new Error(responseError(xhr.responseText, 'Could not upload file')));
		};
		xhr.onerror = () => {
			onAbortClear();
			reject(new Error('Could not upload file'));
		};
		xhr.onabort = () => {
			onAbortClear();
			reject(new DOMException('Transfer cancelled', 'AbortError'));
		};

		const form = new FormData();
		form.append('file', file);
		xhr.open('POST', url);
		xhr.send(form);
	});
}

export async function fetchDownloadBlob(
	entry: RemoteEntry,
	url: string,
	signal: AbortSignal,
	onProgress: (bytes: number) => void
): Promise<Blob> {
	const response = await fetch(url, { signal });
	if (!response.ok) {
		const body = await readApiBody(response, `Could not download ${entry.name}`);
		throw new Error(apiErrorMessage(body, `Could not download ${entry.name}`));
	}

	if (!response.body) {
		const blob = await response.blob();
		onProgress(blob.size);
		return blob;
	}

	const reader = response.body.getReader();
	const chunks: ArrayBuffer[] = [];
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (value) {
			chunks.push(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
			onProgress(value.byteLength);
		}
	}
	return new Blob(chunks, {
		type: response.headers.get('content-type') ?? 'application/octet-stream'
	});
}

export function saveDownloadedBlob(entry: RemoteEntry, blob: Blob) {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = entry.name;
	anchor.rel = 'noopener';
	document.body.append(anchor);
	anchor.click();
	anchor.remove();
	URL.revokeObjectURL(url);
}
