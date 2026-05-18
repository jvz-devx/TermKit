import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	addBookmarkEntry,
	bookmarkStorageKey,
	createBookmark,
	parseBookmarks,
	removeBookmarkEntry
} from './sftp-bookmarks';

describe('SFTP bookmarks', () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('builds a stable per-protocol host storage key', () => {
		expect(bookmarkStorageKey('sftp', 'host-1')).toBe('termkit:file-manager:sftp:host-1:bookmarks');
	});

	it('creates normalized bookmark labels', () => {
		const now = new Date('2026-01-02T03:04:05.000Z');

		expect(createBookmark('/var/log/', 'id-1', now)).toEqual({
			id: 'id-1',
			path: '/var/log',
			label: 'log',
			createdAt: '2026-01-02T03:04:05.000Z'
		});
		expect(createBookmark('/', 'id-2', now).label).toBe('/');
	});

	it('adds bookmarks once and removes by id', () => {
		vi.useFakeTimers();
		vi.spyOn(crypto, 'randomUUID').mockReturnValue(
			'bookmark-id' as ReturnType<Crypto['randomUUID']>
		);
		vi.setSystemTime(new Date('2026-01-02T03:04:05.000Z'));

		const added = addBookmarkEntry([], '/tmp//logs');

		expect(addBookmarkEntry(added, '/tmp/logs')).toBe(added);
		expect(removeBookmarkEntry(added, 'bookmark-id')).toEqual([]);
		expect(added).toEqual([
			{
				id: 'bookmark-id',
				path: '/tmp/logs',
				label: 'logs',
				createdAt: '2026-01-02T03:04:05.000Z'
			}
		]);
	});

	it('parses only valid bookmark entries', () => {
		const raw = JSON.stringify([
			{ id: '1', path: '/', label: '/', createdAt: 'now' },
			{ id: '2', path: '/missing-created-at', label: 'bad' },
			null
		]);

		expect(parseBookmarks(raw)).toEqual([{ id: '1', path: '/', label: '/', createdAt: 'now' }]);
		expect(parseBookmarks('not json')).toEqual([]);
		expect(parseBookmarks(null)).toEqual([]);
	});
});
