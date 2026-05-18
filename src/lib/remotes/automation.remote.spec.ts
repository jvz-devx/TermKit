import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceUnauthorizedError, ServiceValidationError } from '$lib/server/services/errors';
import {
	listAutomationTemplates,
	previewAutomationTemplate,
	type AutomationTemplate
} from './automation.remote';

const appServer = vi.hoisted(() => ({
	event: {
		locals: { user: { id: 'user-1', username: 'ada' } } as {
			user?: { id: string; username: string };
		},
		url: new URL('https://termix.test/automation')
	}
}));

vi.mock('$app/server', () => {
	function remoteCallable(type: 'command' | 'query', fn: (input?: unknown) => unknown) {
		const wrapper = vi.fn((input?: unknown) => {
			const promise = Promise.resolve(fn(input)) as Promise<unknown> & { refresh: () => void };
			promise.refresh = vi.fn();
			return promise;
		});
		Object.defineProperty(wrapper, '__', { value: { type } });
		return wrapper;
	}

	return {
		getRequestEvent: () => appServer.event,
		query: (fn: () => unknown) => remoteCallable('query', fn),
		command: (_validation: unknown, fn: (input?: unknown) => unknown) =>
			remoteCallable('command', fn)
	};
});

vi.mock('$lib/termix/automation-template', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/termix/automation-template')>();
	const template: AutomationTemplate = {
		id: 'template-ssh',
		name: 'Deploy',
		description: 'Deploy service',
		kind: 'ssh_command',
		version: '1.0.0',
		author: 'TermKit',
		visibility: 'private',
		workspaceId: null,
		tags: ['deploy'],
		variables: [
			{
				key: 'command',
				label: 'Command',
				type: 'string',
				required: true
			},
			{
				key: 'credential_ref',
				label: 'Credential',
				type: 'secret_ref',
				required: true
			}
		],
		body: 'run {{command}} with {{credential_ref}}',
		createdAt: '2026-05-14T00:00:00.000Z',
		updatedAt: '2026-05-14T00:00:00.000Z'
	};

	return {
		...actual,
		builtInAutomationTemplates: [template]
	};
});

describe('automation remote functions', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		appServer.event = {
			locals: { user: { id: 'user-1', username: 'ada' } },
			url: new URL('https://termix.test/automation')
		};
	});

	it('lists built-in template summaries for the signed-in user', async () => {
		await expect(listAutomationTemplates()).resolves.toEqual([
			expect.objectContaining({
				id: 'template-ssh',
				name: 'Deploy',
				variableCount: 2,
				requiredVariableCount: 2
			})
		]);
		expect(listAutomationTemplates).toHaveBeenCalledOnce();
	});

	it('rejects unauthenticated template listing before service access', async () => {
		appServer.event = {
			locals: {},
			url: new URL('https://termix.test/automation')
		};

		await expect(listAutomationTemplates()).rejects.toBeInstanceOf(ServiceUnauthorizedError);
		expect(listAutomationTemplates).toHaveBeenCalledOnce();
	});

	it('validates preview template ids before service lookup', async () => {
		await expect(previewAutomationTemplate({ templateId: '' })).rejects.toBeInstanceOf(
			ServiceValidationError
		);
		expect(previewAutomationTemplate).toHaveBeenCalledWith({ templateId: '' });
	});

	it('renders previews without exposing secret references in rendered output', async () => {
		const preview = await previewAutomationTemplate({
			templateId: 'template-ssh',
			values: {
				command: 'systemctl restart termix',
				credential_ref: 'credential:ssh-key:production'
			}
		});

		expect(preview.rendered).toContain('systemctl restart termix');
		expect(preview.rendered).not.toContain('credential:ssh-key:production');
		expect(preview.logSafeRendered).not.toContain('credential:ssh-key:production');
		expect(preview.variables.find((variable) => variable.key === 'credential_ref')).toMatchObject({
			secret: true,
			value: '[secret reference masked]'
		});
	});
});
