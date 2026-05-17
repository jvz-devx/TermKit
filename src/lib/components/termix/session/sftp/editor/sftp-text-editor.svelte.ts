import type { RemoteEntry } from '../state/file-manager-state';
import type { createSftpClient } from '../api/sftp-client';

type SftpClient = ReturnType<typeof createSftpClient>;

export type SftpTextEditorOptions = {
	client: Pick<SftpClient, 'readText'>;
	request: (
		route: string,
		init: RequestInit,
		fallback: string,
		ignoreFailure?: boolean
	) => Promise<boolean>;
	getCurrentPath: () => string;
	loadDirectory: (path: string) => Promise<void>;
	setLoading: (loading: boolean) => void;
	setError: (message: string | null) => void;
	setLastRetry: (retry: (() => Promise<void>) | null) => void;
};

export function saveTextRequest(path: string, text: string): RequestInit {
	return {
		method: 'PUT',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ path, text })
	};
}

export function createSftpTextEditor({
	client,
	request,
	getCurrentPath,
	loadDirectory,
	setLoading,
	setError,
	setLastRetry
}: SftpTextEditorOptions) {
	let textPath = $state<string | null>(null);
	let textValue = $state('');
	let textDirty = $state(false);

	async function openText(entry: RemoteEntry | null) {
		if (!entry || entry.type !== 'file') return;
		setLoading(true);
		setError(null);
		setLastRetry(() => openText(entry));
		try {
			textPath = entry.path;
			textValue = await client.readText(entry);
			textDirty = false;
			setLastRetry(null);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : 'Could not read text file');
		} finally {
			setLoading(false);
		}
	}

	async function saveText() {
		if (!textPath) return;
		const saved = await request(
			'/text',
			saveTextRequest(textPath, textValue),
			'Could not save text file'
		);
		if (saved) {
			textDirty = false;
			await loadDirectory(getCurrentPath());
		}
	}

	return {
		get textPath() {
			return textPath;
		},
		set textPath(value) {
			textPath = value;
		},
		get textValue() {
			return textValue;
		},
		set textValue(value) {
			textValue = value;
		},
		get textDirty() {
			return textDirty;
		},
		set textDirty(value) {
			textDirty = value;
		},
		get openText() {
			return openText;
		},
		get saveText() {
			return saveText;
		}
	};
}
