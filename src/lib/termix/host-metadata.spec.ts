import { describe, expect, it } from 'vitest';
import {
	DEFAULT_TERMINAL_PREFERENCES,
	normalizeHostMetadata,
	terminalFontSize,
	toSshJumpHostConfig
} from './host-metadata';

describe('host metadata helpers', () => {
	it('normalizes V5.1 terminal preferences and jump-host metadata', () => {
		expect(
			normalizeHostMetadata({
				terminalPreferences: {
					fontSize: '16',
					scrollback: '12000',
					cursorBlink: false,
					theme: 'system'
				},
				sshJumpHost: {
					enabled: true,
					hostId: ' jump-host-1 '
				},
				ftps: {
					mode: 'implicit',
					rejectUnauthorized: false,
					certificateHostname: ' edge.example.test '
				}
			})
		).toEqual({
			terminalPreferences: {
				fontSize: 16,
				scrollback: 12000,
				cursorBlink: false,
				theme: 'system'
			},
			sshJumpHost: {
				enabled: true,
				hostId: 'jump-host-1'
			},
			ftps: {
				mode: 'implicit',
				rejectUnauthorized: false,
				certificateHostname: 'edge.example.test'
			}
		});
	});

	it('falls back instead of accepting malformed terminal output storage fields', () => {
		const metadata = normalizeHostMetadata({
			terminalPreferences: {
				fontSize: 100,
				scrollback: 1_000_000,
				cursorBlink: 'yes',
				theme: 'purple'
			},
			sshJumpHost: {
				enabled: true,
				hostId: ''
			},
			rdpProfile: { quality: 'balanced' },
			scrollbackOutput: 'must not be persisted'
		});

		expect(metadata.terminalPreferences).toEqual(DEFAULT_TERMINAL_PREFERENCES);
		expect(metadata.sshJumpHost).toEqual({ enabled: false, hostId: null });
		expect(metadata.ftps).toEqual({
			mode: 'explicit',
			rejectUnauthorized: true,
			certificateHostname: null
		});
		expect(metadata.rdpProfile).toEqual({ quality: 'balanced' });
		expect(metadata.scrollbackOutput).toBeUndefined();
		expect(terminalFontSize(metadata.terminalPreferences, 13)).toBe(13);
		expect(toSshJumpHostConfig(metadata.sshJumpHost)).toBeNull();
	});

	it('normalizes FTPS settings from legacy and nested host metadata', () => {
		expect(
			normalizeHostMetadata({
				ftpsMode: 'implicit',
				ftpsRejectUnauthorized: false,
				ftpsCertificateHostname: ' legacy.example.test '
			}).ftps
		).toEqual({
			mode: 'implicit',
			rejectUnauthorized: false,
			certificateHostname: 'legacy.example.test'
		});

		expect(
			normalizeHostMetadata({
				ftps: {
					mode: 'explicit',
					rejectUnauthorized: false,
					certificateHostname: 'cert.example.test'
				}
			}).ftps
		).toEqual({
			mode: 'explicit',
			rejectUnauthorized: false,
			certificateHostname: 'cert.example.test'
		});
	});
});
