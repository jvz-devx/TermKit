import type { Page, Request, Route } from '@playwright/test';

type FileManagerApiBase = 'sftp' | 'ftp';
type FileManagerRouteName = 'delete' | 'download' | 'list' | 'mkdir' | 'rename' | 'text' | 'upload';
type FileManagerCall = {
	route: FileManagerRouteName;
	method: string;
	path?: string;
	from?: string;
	to?: string;
	text?: string;
};
type FileManagerEntry = {
	name: string;
	path: string;
	type: 'directory' | 'file' | 'symlink' | 'other';
	size: number;
	mtime: string | null;
	mode?: number;
	link?: string;
};
type FileManagerFixture = {
	apiBase: FileManagerApiBase;
	callsFor: (route: FileManagerRouteName) => FileManagerCall[];
	releaseBlockedDownload: (path: string, action?: BlockedDownloadAction) => Promise<void>;
	dispose: () => Promise<void>;
};
type BlockedDownloadAction = 'abort' | 'fulfill';
type BlockedDownload = {
	promise: Promise<BlockedDownloadAction>;
	release: (action: BlockedDownloadAction) => void;
};
type FileManagerFixtureOptions = {
	blockedDownloads?: string[];
	extraEntries?: FileManagerEntry[];
	textFiles?: Record<string, string>;
};

export async function installFileManagerFixture(
	page: Page,
	apiBase: FileManagerApiBase,
	options: FileManagerFixtureOptions = {}
): Promise<FileManagerFixture> {
	const routePattern = new RegExp(
		`/api/${apiBase}/[^/]+/(list|mkdir|rename|delete|text|upload|download)(?:\\?|$)`
	);
	const calls: FileManagerCall[] = [];
	const blockedDownloadPaths = new Set(
		(options.blockedDownloads ?? []).map((path) => normalizeFixturePath(path))
	);
	const blockedDownloads = new Map<string, BlockedDownload>();
	const entries = new Map<string, FileManagerEntry[]>([
		[
			'/',
			[
				fileEntry('readme.txt', '/readme.txt', 48),
				fileEntry('stale.tmp', '/stale.tmp', 5),
				directoryEntry('logs', '/logs'),
				...(options.extraEntries ?? [])
			]
		],
		['/logs', [fileEntry('nested.log', '/logs/nested.log', 12)]]
	]);
	const textFiles = new Map<string, string>([
		['/readme.txt', 'Fixture readme for browser workflow coverage.']
	]);
	for (const [path, text] of Object.entries(options.textFiles ?? {})) {
		textFiles.set(normalizeFixturePath(path), text);
	}

	await page.route(routePattern, async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		const routeName = url.pathname.split('/').at(-1) as FileManagerRouteName;
		const method = request.method();
		const queryPath = normalizeFixturePath(url.searchParams.get('path') ?? '/');
		const body = await requestJson(request);
		const call: FileManagerCall = { route: routeName, method, path: queryPath };
		calls.push(call);

		if (routeName === 'list') {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ path: queryPath, entries: entries.get(queryPath) ?? [] })
			});
			return;
		}

		if (routeName === 'mkdir') {
			const path = normalizeFixturePath(stringBodyValue(body, 'path'));
			call.path = path;
			addEntry(entries, directoryEntry(basenameFixture(path), path));
			await jsonOk(route, { path });
			return;
		}

		if (routeName === 'rename') {
			const from = normalizeFixturePath(stringBodyValue(body, 'from'));
			const to = normalizeFixturePath(stringBodyValue(body, 'to'));
			call.from = from;
			call.to = to;
			renameEntry(entries, textFiles, from, to);
			await jsonOk(route, { from, to });
			return;
		}

		if (routeName === 'delete') {
			removeEntry(entries, queryPath);
			textFiles.delete(queryPath);
			await jsonOk(route, { path: queryPath });
			return;
		}

		if (routeName === 'text' && method === 'GET') {
			await jsonOk(route, {
				path: queryPath,
				text: textFiles.get(queryPath) ?? ''
			});
			return;
		}

		if (routeName === 'text' && method === 'PUT') {
			const path = normalizeFixturePath(stringBodyValue(body, 'path'));
			const text = stringBodyValue(body, 'text');
			call.path = path;
			call.text = text;
			textFiles.set(path, text);
			await jsonOk(route, { path, size: Buffer.byteLength(text, 'utf8') });
			return;
		}

		if (routeName === 'upload') {
			const name = basenameFixture(queryPath);
			addEntry(entries, fileEntry(name, queryPath, request.postDataBuffer()?.byteLength ?? 1));
			textFiles.set(queryPath, 'Uploaded through browser fixture.');
			await jsonOk(route, { path: queryPath, size: request.postDataBuffer()?.byteLength ?? 1 });
			return;
		}

		if (routeName === 'download') {
			if (blockedDownloadPaths.has(queryPath)) {
				const blocked = createBlockedDownload();
				blockedDownloads.set(queryPath, blocked);
				const action = await blocked.promise;
				blockedDownloads.delete(queryPath);
				if (action === 'abort') {
					await route.abort('aborted').catch(() => undefined);
					return;
				}
			}
			await route.fulfill({
				status: 200,
				contentType: 'text/plain',
				headers: {
					'content-disposition': `attachment; filename="${basenameFixture(queryPath)}"`
				},
				body: textFiles.get(queryPath) ?? 'downloaded fixture content'
			});
			return;
		}

		await route.continue();
	});

	return {
		apiBase,
		callsFor: (route) => calls.filter((call) => call.route === route),
		releaseBlockedDownload: async (path, action = 'fulfill') => {
			blockedDownloads.get(normalizeFixturePath(path))?.release(action);
		},
		dispose: async () => {
			for (const blocked of blockedDownloads.values()) blocked.release('abort');
			await page.unroute(routePattern);
		}
	};
}

function createBlockedDownload(): BlockedDownload {
	let release: (action: BlockedDownloadAction) => void = () => undefined;
	const promise = new Promise<BlockedDownloadAction>((resolve) => {
		release = resolve;
	});
	return { promise, release };
}

async function requestJson(request: Request) {
	try {
		return (await request.postDataJSON()) as Record<string, unknown>;
	} catch {
		return {};
	}
}

async function jsonOk(route: Route, body: unknown) {
	await route.fulfill({
		status: 200,
		contentType: 'application/json',
		body: JSON.stringify(body)
	});
}

function directoryEntry(name: string, path: string): FileManagerEntry {
	return {
		name,
		path,
		type: 'directory',
		size: 0,
		mtime: '2026-05-15T10:00:00.000Z',
		mode: 0o755
	};
}

export function fileEntry(name: string, path: string, size: number): FileManagerEntry {
	return {
		name,
		path,
		type: 'file',
		size,
		mtime: '2026-05-15T10:00:00.000Z',
		mode: 0o644
	};
}

function addEntry(entries: Map<string, FileManagerEntry[]>, entry: FileManagerEntry) {
	const directory = dirnameFixture(entry.path);
	const current = entries.get(directory) ?? [];
	entries.set(directory, [...current.filter((candidate) => candidate.path !== entry.path), entry]);
	if (entry.type === 'directory' && !entries.has(entry.path)) entries.set(entry.path, []);
}

function renameEntry(
	entries: Map<string, FileManagerEntry[]>,
	textFiles: Map<string, string>,
	from: string,
	to: string
) {
	const fromDirectory = dirnameFixture(from);
	const source = entries.get(fromDirectory)?.find((entry) => entry.path === from);
	if (!source) return;
	removeEntry(entries, from);
	addEntry(entries, { ...source, name: basenameFixture(to), path: to });
	const text = textFiles.get(from);
	if (typeof text === 'string') {
		textFiles.delete(from);
		textFiles.set(to, text);
	}
}

function removeEntry(entries: Map<string, FileManagerEntry[]>, path: string) {
	const directory = dirnameFixture(path);
	entries.set(
		directory,
		(entries.get(directory) ?? []).filter((entry) => entry.path !== path)
	);
	entries.delete(path);
}

function stringBodyValue(body: Record<string, unknown>, key: string) {
	const value = body[key];
	return typeof value === 'string' ? value : '';
}

function normalizeFixturePath(value: string) {
	const path = value.trim().startsWith('/') ? value.trim() : `/${value.trim()}`;
	return path.replace(/\/+/g, '/') || '/';
}

function dirnameFixture(path: string) {
	const parts = normalizeFixturePath(path).split('/').filter(Boolean);
	parts.pop();
	return parts.length ? `/${parts.join('/')}` : '/';
}

function basenameFixture(path: string) {
	return normalizeFixturePath(path).split('/').filter(Boolean).pop() ?? '/';
}
