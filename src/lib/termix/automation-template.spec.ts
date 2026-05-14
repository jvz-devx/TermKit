import { describe, expect, it } from 'vitest';
import {
	builtInAutomationTemplates,
	renderAutomationTemplatePreview,
	toAutomationTemplateSummary,
	type AutomationTemplate
} from './automation-template';

describe('automation templates', () => {
	it('ships one built-in template for every V6 automation kind', () => {
		expect.hasAssertions();

		expect(builtInAutomationTemplates.map((template) => template.kind).sort()).toEqual([
			'file_transfer',
			'operator_note',
			'rdp_checklist',
			'ssh_command',
			'ssh_tunnel'
		]);
	});

	it('includes privacy, workspace sharing, version, and author metadata in summaries', () => {
		expect.hasAssertions();

		const summary = toAutomationTemplateSummary(
			builtInAutomationTemplates.find((template) => template.id === 'builtin:ssh-command')!
		);

		expect(summary).toMatchObject({
			version: '1.0.0',
			author: 'TermixKit',
			visibility: 'workspace_shared',
			private: false,
			workspaceShared: true,
			workspaceId: null
		});
		expect(summary.requiredVariableCount).toBeGreaterThan(0);
	});

	it('renders previews with defaults and masks secret references', () => {
		expect.hasAssertions();

		const template = builtInAutomationTemplates.find(
			(candidate) => candidate.id === 'builtin:ssh-command'
		)!;
		const preview = renderAutomationTemplatePreview(template, {
			command: 'cat /run/secrets/termix-token',
			credential_ref: 'sops:prod/ssh/private-key'
		});

		expect(preview.valid).toBe(true);
		expect(preview.rendered).toContain('cat /run/secrets/termix-token');
		expect(preview.rendered).toContain('Credential: [secret reference masked]');
		expect(preview.logSafeRendered).not.toContain('sops:prod/ssh/private-key');
		expect(preview.variables.find((variable) => variable.key === 'credential_ref')).toMatchObject({
			secret: true,
			value: '[secret reference masked]',
			logSafeValue: '[secret reference masked]'
		});
	});

	it('validates required variables, enum values, patterns, and numeric ranges', () => {
		expect.hasAssertions();

		const template: AutomationTemplate = {
			id: 'test',
			name: 'Test',
			description: 'Test template',
			kind: 'ssh_tunnel',
			version: '0.1.0',
			author: 'Tester',
			visibility: 'private',
			workspaceId: null,
			tags: [],
			createdAt: '2026-05-14T00:00:00.000Z',
			updatedAt: '2026-05-14T00:00:00.000Z',
			body: '{{target}} {{port}} {{mode}} {{token}}',
			variables: [
				{ key: 'target', label: 'Target', type: 'string', required: true },
				{
					key: 'port',
					label: 'Port',
					type: 'number',
					required: true,
					defaultValue: 70000,
					validation: { min: 1, max: 65535 }
				},
				{
					key: 'mode',
					label: 'Mode',
					type: 'enum',
					required: true,
					defaultValue: 'invalid',
					validation: { options: ['safe'] }
				},
				{
					key: 'token',
					label: 'Token',
					type: 'secret_ref',
					required: true,
					defaultValue: 'vault:prod/token'
				},
				{
					key: 'screen',
					label: 'Screen',
					type: 'string',
					required: false,
					defaultValue: 'large',
					validation: { pattern: '^\\d+x\\d+$' }
				}
			]
		};

		const preview = renderAutomationTemplatePreview(template);

		expect(preview.valid).toBe(false);
		expect(preview.errors).toEqual([
			'Target: is required',
			'Port: must be at most 65535',
			'Mode: must be one of safe',
			'Screen: has an invalid format'
		]);
		expect(preview.rendered).toBe(' 70000 invalid [secret reference masked]');
	});

	it('renders the RDP checklist as log-safe operational text', () => {
		expect.hasAssertions();

		const template = builtInAutomationTemplates.find(
			(candidate) => candidate.id === 'builtin:rdp-checklist'
		)!;
		const preview = renderAutomationTemplatePreview(template, {
			host_name: 'rdp-prod-02',
			credential_ref: 'credential:rdp:break-glass'
		});

		expect(preview.rendered).toContain('- Host: rdp-prod-02');
		expect(preview.rendered).toContain('- Operator verified host ownership and session purpose.');
		expect(preview.logSafeRendered).not.toContain('credential:rdp:break-glass');
	});
});
