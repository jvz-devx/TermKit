import { describe, expect, it } from 'vitest';
import { formatModified, modeLabel, symlinkTarget } from './sftp-entry-format';
import type { RemoteEntry } from '../state/file-manager-state';

describe('SFTP entry formatting', () => {
	it('formats modified timestamps with raw fallbacks', () => {
		expect(formatModified(entry({ mtime: null, rawModifiedAt: 'raw' }))).toBe('raw');
		expect(formatModified(entry({ mtime: 'not-a-date', rawModifiedAt: 'bad-date' }))).toBe(
			'bad-date'
		);
		expect(formatModified(entry({ mtime: '2026-05-15T00:00:00.000Z' }))).not.toBe('-');
	});

	it('formats mode bits as octal permissions', () => {
		expect(modeLabel(entry({ mode: 0o100755 }))).toBe('0755');
		expect(modeLabel(entry({ mode: undefined }))).toBeNull();
	});

	it('returns symlink targets only for symlink entries', () => {
		expect(symlinkTarget(entry({ type: 'symlink', link: '/target' }))).toBe('/target');
		expect(symlinkTarget(entry({ type: 'symlink', longname: 'target from longname' }))).toBe(
			'target from longname'
		);
		expect(symlinkTarget(entry({ type: 'file', link: '/target' }))).toBeNull();
	});
});

function entry(overrides: Partial<RemoteEntry>): RemoteEntry {
	return {
		name: 'entry',
		path: '/entry',
		type: 'file',
		size: 0,
		mtime: null,
		...overrides
	};
}
