import { basename, normalizePath } from './file-manager-state';

export type BookmarkEntry = {
	id: string;
	path: string;
	label: string;
	createdAt: string;
};

export function bookmarkStorageKey(apiBase: string, hostId: string) {
	return `termkit:file-manager:${apiBase}:${hostId}:bookmarks`;
}

export function createBookmark(path: string, id: string = crypto.randomUUID(), now = new Date()) {
	const normalized = normalizePath(path);
	return {
		id,
		path: normalized,
		label: normalized === '/' ? '/' : basename(normalized),
		createdAt: now.toISOString()
	} satisfies BookmarkEntry;
}

export function addBookmarkEntry(bookmarks: BookmarkEntry[], path: string) {
	const normalized = normalizePath(path);
	if (bookmarks.some((bookmark) => bookmark.path === normalized)) return bookmarks;
	return [...bookmarks, createBookmark(normalized)];
}

export function removeBookmarkEntry(bookmarks: BookmarkEntry[], id: string) {
	return bookmarks.filter((bookmark) => bookmark.id !== id);
}

export function parseBookmarks(raw: string | null) {
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter(isBookmarkEntry) : [];
	} catch {
		return [];
	}
}

export function isBookmarkEntry(value: unknown): value is BookmarkEntry {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const candidate = value as Partial<BookmarkEntry>;
	return (
		typeof candidate.id === 'string' &&
		typeof candidate.path === 'string' &&
		typeof candidate.label === 'string' &&
		typeof candidate.createdAt === 'string'
	);
}
