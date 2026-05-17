import type { RemoteEntry } from '../file-manager-state';

export function formatModified(entry: RemoteEntry) {
	if (!entry.mtime) return entry.rawModifiedAt ?? '-';
	const date = new Date(entry.mtime);
	return Number.isNaN(date.getTime()) ? (entry.rawModifiedAt ?? '-') : date.toLocaleString();
}

export function modeLabel(entry: RemoteEntry) {
	if (typeof entry.mode !== 'number') return null;
	return `0${(entry.mode & 0o777).toString(8)}`;
}

export function symlinkTarget(entry: RemoteEntry) {
	if (entry.type !== 'symlink') return null;
	return entry.link ?? entry.longname ?? null;
}
