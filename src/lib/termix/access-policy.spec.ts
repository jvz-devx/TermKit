import { describe, expect, it } from 'vitest';
import {
	canRolePerformAction,
	evaluateAccessPolicy,
	isDangerousTemplate,
	isRiskyTransfer,
	isSensitiveHost
} from './access-policy';

describe('access policy helpers', () => {
	it('maps V6 workspace roles to action permissions', () => {
		expect(canRolePerformAction('viewer', 'view')).toBe(true);
		expect(canRolePerformAction('viewer', 'launch')).toBe(false);
		expect(canRolePerformAction('operator', 'transfer')).toBe(true);
		expect(canRolePerformAction('operator', 'tunnel')).toBe(false);
		expect(canRolePerformAction('maintainer', 'bulkJobs')).toBe(true);
		expect(canRolePerformAction('owner', 'record')).toBe(true);
	});

	it('returns server-side blocked decisions shaped for matching UI states', () => {
		const decision = evaluateAccessPolicy({
			action: 'record',
			role: 'operator',
			policy: {
				actionRules: {
					record: { minRole: 'maintainer' }
				}
			}
		});

		expect(decision).toMatchObject({
			allowed: false,
			state: 'blocked',
			code: 'policy_role_denied',
			requiredRole: 'maintainer',
			ui: {
				blocked: true,
				state: 'blocked',
				title: 'Record terminals'
			}
		});
		expect(decision.requirements).toContainEqual({
			kind: 'role',
			code: 'role_required',
			message: 'Requires maintainer role or higher.',
			satisfied: false
		});
	});

	it('requires reasons for sensitive hosts by default and approval when policy enables it', () => {
		const blocked = evaluateAccessPolicy({
			action: 'launch',
			role: 'operator',
			host: {
				name: 'prod-db',
				tags: ['sensitive']
			},
			policy: {
				sensitiveHosts: {
					requireApproval: true
				}
			}
		});

		expect(blocked.allowed).toBe(false);
		expect(blocked.state).toBe('approval_required');
		expect(blocked.requirements).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: 'sensitive_host_approval_required',
					satisfied: false
				}),
				expect.objectContaining({
					code: 'sensitive_host_reason_required',
					satisfied: false
				})
			])
		);

		const allowed = evaluateAccessPolicy({
			action: 'launch',
			role: 'operator',
			host: {
				metadata: {
					classification: 'sensitive'
				}
			},
			policy: {
				sensitiveHosts: {
					requireApproval: false
				}
			},
			reason: 'scheduled maintenance'
		});

		expect(allowed).toMatchObject({
			allowed: true,
			state: 'allowed',
			ui: { blocked: false }
		});
	});

	it('gates dangerous templates with approval and reason requirements', () => {
		const decision = evaluateAccessPolicy({
			action: 'templates',
			role: 'maintainer',
			template: {
				name: 'restart database cluster',
				riskLevel: 'critical'
			}
		});

		expect(isDangerousTemplate({ metadata: { riskLevel: 'critical' } })).toBe(true);
		expect(decision).toMatchObject({
			allowed: false,
			state: 'approval_required',
			code: 'dangerous_template_approval_required'
		});
		expect(decision.ui.requirements).toEqual([
			'Approval is required by workspace policy.',
			'A reason is required by workspace policy.'
		]);

		expect(
			evaluateAccessPolicy({
				action: 'templates',
				role: 'maintainer',
				template: {
					dangerous: true
				},
				approval: { approved: true },
				reason: 'approved change window'
			})
		).toMatchObject({
			allowed: true,
			state: 'allowed',
			ui: { blocked: false }
		});
	});

	it('blocks hidden bulk hosts and gates high host counts', () => {
		const decision = evaluateAccessPolicy({
			action: 'bulkJobs',
			role: 'maintainer',
			selection: {
				hostCount: 51,
				hiddenHostCount: 1
			},
			policy: {
				bulkJobs: {
					highHostCountThreshold: 50,
					maxHostCount: 100
				}
			}
		});

		expect(decision.allowed).toBe(false);
		expect(decision.requirements).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					kind: 'review',
					code: 'hidden_hosts_blocked',
					satisfied: false
				}),
				expect.objectContaining({
					kind: 'approval',
					code: 'high_host_count_approval_required',
					satisfied: false
				}),
				expect.objectContaining({
					kind: 'reason',
					code: 'high_host_count_reason_required',
					satisfied: false
				})
			])
		);
	});

	it('gates risky transfers by path, overwrite, executable, or size policy', () => {
		expect(
			isRiskyTransfer(
				{
					path: '/etc/systemd/system/app.service',
					overwritesExisting: true
				},
				null
			)
		).toBe(true);

		const decision = evaluateAccessPolicy({
			action: 'transfer',
			role: 'operator',
			transfer: {
				path: '/tmp/release.bin',
				bytes: 300_000_000,
				executable: true
			},
			policy: {
				transfers: {
					maxBytes: 100_000_000
				}
			}
		});

		expect(decision).toMatchObject({
			allowed: false,
			state: 'approval_required',
			code: 'risky_transfer_approval_required'
		});
	});

	it('detects sensitive host markers across explicit flags, tags, and metadata', () => {
		expect(isSensitiveHost({ sensitive: true })).toBe(true);
		expect(isSensitiveHost({ tags: ['Sensitive'] })).toBe(true);
		expect(isSensitiveHost({ metadata: { criticality: 'high' } })).toBe(true);
		expect(isSensitiveHost({ tags: ['dev'] })).toBe(false);
	});
});
