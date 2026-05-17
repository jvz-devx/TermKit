import { command, getRequestEvent, query } from '$app/server';
import { ServiceUnauthorizedError, ServiceValidationError } from '$lib/server/services/errors';
import {
	builtInAutomationTemplates,
	renderAutomationTemplatePreview,
	toAutomationTemplateSummary,
	type AutomationTemplate,
	type AutomationTemplatePreview,
	type AutomationTemplatePreviewInput,
	type AutomationTemplateSummary
} from '$lib/termix/automation-template';

export type {
	AutomationTemplate,
	AutomationTemplateKind,
	AutomationTemplatePreview,
	AutomationTemplateSummary,
	AutomationTemplateVariable,
	AutomationTemplateVisibility,
	AutomationVariableType,
	AutomationVariableValue
} from '$lib/termix/automation-template';

export type AutomationTemplateService = {
	list(userId: string): Promise<AutomationTemplate[]>;
	get(userId: string, templateId: string): Promise<AutomationTemplate | null>;
};

const builtInAutomationTemplateService: AutomationTemplateService = {
	async list() {
		return builtInAutomationTemplates;
	},
	async get(_userId, templateId) {
		return builtInAutomationTemplates.find((template) => template.id === templateId) ?? null;
	}
};

const automationTemplateService: AutomationTemplateService = builtInAutomationTemplateService;

export const listAutomationTemplates = query(async (): Promise<AutomationTemplateSummary[]> => {
	const userId = requireRemoteUser();
	const templates = await automationTemplateService.list(userId);

	return templates
		.map(toAutomationTemplateSummary)
		.sort(
			(left, right) =>
				left.kind.localeCompare(right.kind) ||
				left.name.localeCompare(right.name) ||
				left.version.localeCompare(right.version)
		);
});

export const previewAutomationTemplate = command<
	AutomationTemplatePreviewInput,
	AutomationTemplatePreview
>('unchecked', async (input) => {
	const userId = requireRemoteUser();
	const templateId = typeof input.templateId === 'string' ? input.templateId : '';
	if (!templateId) throw new ServiceValidationError(['templateId is required']);

	const template = await automationTemplateService.get(userId, templateId);
	if (!template) throw new ServiceValidationError(['templateId is invalid']);

	const values = isRecord(input.values) ? input.values : {};
	return renderAutomationTemplatePreview(template, values);
});

function requireRemoteUser(): string {
	const userId = getRequestEvent().locals.user?.id;
	if (!userId) throw new ServiceUnauthorizedError();
	return userId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
