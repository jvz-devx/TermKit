import { normalizePath, type RemoteEntry } from '../state/file-manager-state';
import { apiErrorMessage, readApiBody } from './sftp-api-response';

export type ApiBase = 'sftp' | 'ftp';

export function createSftpClient(apiBase: ApiBase, hostId: string) {
	function url(route: string) {
		return `/api/${apiBase}/${encodeURIComponent(hostId)}${route}`;
	}

	async function list(remotePath: string, signal?: AbortSignal) {
		const response = await fetch(
			url(`/list?path=${encodeURIComponent(normalizePath(remotePath))}`),
			{
				signal
			}
		);
		const body = await readApiBody(response, 'Could not list directory');
		if (!response.ok) throw new Error(apiErrorMessage(body, 'Could not list directory'));
		return {
			path: typeof body.path === 'string' ? body.path : normalizePath(remotePath),
			entries: Array.isArray(body.entries) ? (body.entries as RemoteEntry[]) : []
		};
	}

	async function request(
		route: string,
		init: RequestInit,
		fallback: string,
		signal?: AbortSignal,
		ignoreFailure = false
	) {
		const response = await fetch(url(route), { ...init, signal });
		const body = await readApiBody(response, fallback);
		if (!response.ok) {
			if (ignoreFailure) return false;
			throw new Error(apiErrorMessage(body, fallback));
		}
		return true;
	}

	function downloadUrl(entry: RemoteEntry) {
		return url(`/download?path=${encodeURIComponent(entry.path)}`);
	}

	function uploadUrl(remotePath: string) {
		return url(`/upload?path=${encodeURIComponent(remotePath)}`);
	}

	async function readText(entry: RemoteEntry) {
		const response = await fetch(url(`/text?path=${encodeURIComponent(entry.path)}`));
		const body = await readApiBody(response, 'Could not read text file');
		if (!response.ok) throw new Error(apiErrorMessage(body, 'Could not read text file'));
		return typeof body.content === 'string' ? body.content : '';
	}

	return { url, list, request, downloadUrl, uploadUrl, readText };
}
