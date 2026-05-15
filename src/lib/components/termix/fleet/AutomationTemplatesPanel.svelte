<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Clock3, Plus, ShieldCheck, Workflow } from '@lucide/svelte';
	import type { FleetAutomationTemplate, FleetWorkspace } from './fleet-data';
	import { fleetRiskLabel } from './fleet-data';

	let {
		templates,
		workspaces = [],
		selectedTemplateId,
		onSelectTemplate,
		onCreateTemplate
	}: {
		templates: FleetAutomationTemplate[];
		workspaces?: FleetWorkspace[];
		selectedTemplateId: string;
		onSelectTemplate: (templateId: string) => void;
		onCreateTemplate: (input: {
			name: string;
			kind: string;
			visibility: string;
			workspaceId: string | null;
			body: string;
			variables: string;
			dangerous: boolean;
		}) => Promise<void>;
	} = $props();

	let createOpen = $state(false);
	let createName = $state('');
	let createKind = $state('ssh_command');
	let createVisibility = $state('private');
	let createWorkspaceId = $state('');
	let createVariables = $state('target, reason');
	let createBody = $state('Run {{target}} for {{reason}}');
	let createDangerous = $state(false);
	let createBusy = $state(false);
	let createError = $state<string | null>(null);
	let autoSelectedWorkspaceId = $state<string | null>(null);
	let workspaceCreateBlocked = $derived(
		createVisibility === 'workspace' && workspaces.length === 0
	);
	let selectedWorkspace = $derived(
		workspaces.find((workspace) => workspace.id === createWorkspaceId) ?? null
	);
	let workspaceSelectionMissing = $derived(createVisibility === 'workspace' && !selectedWorkspace);
	let createDisabled = $derived(createBusy || workspaceCreateBlocked || workspaceSelectionMissing);

	$effect(() => {
		if (createVisibility !== 'workspace') {
			autoSelectedWorkspaceId = null;
			return;
		}

		if (workspaces.length === 1) {
			const workspaceId = workspaces[0]?.id ?? '';
			if (workspaceId && createWorkspaceId !== workspaceId) {
				createWorkspaceId = workspaceId;
				autoSelectedWorkspaceId = workspaceId;
			}
			return;
		}

		if (autoSelectedWorkspaceId && createWorkspaceId === autoSelectedWorkspaceId) {
			createWorkspaceId = '';
		}
		autoSelectedWorkspaceId = null;
	});

	function changeVisibility(value: string) {
		createVisibility = value;
		if (value === 'workspace' && workspaces.length === 1) {
			createWorkspaceId = workspaces[0]?.id ?? '';
			autoSelectedWorkspaceId = createWorkspaceId || null;
			return;
		}
		createWorkspaceId = '';
		autoSelectedWorkspaceId = null;
	}

	function changeWorkspace(workspaceId: string) {
		createWorkspaceId = workspaceId;
		autoSelectedWorkspaceId = null;
	}

	function createWorkspaceInput() {
		return createVisibility === 'workspace' ? (selectedWorkspace?.id ?? null) : null;
	}

	async function submitCreate() {
		if (workspaceCreateBlocked) {
			createError = 'Create a workspace before saving a workspace runbook.';
			return;
		}
		if (workspaceSelectionMissing) {
			createError = 'Choose a workspace before saving this runbook.';
			return;
		}
		createBusy = true;
		createError = null;
		try {
			await onCreateTemplate({
				name: createName,
				kind: createKind,
				visibility: createVisibility,
				workspaceId: createWorkspaceInput(),
				body: createBody,
				variables: createVariables,
				dangerous: createDangerous
			});
			createOpen = false;
			createName = '';
			createKind = 'ssh_command';
			createVisibility = 'private';
			createWorkspaceId = '';
			createVariables = 'target, reason';
			createBody = 'Run {{target}} for {{reason}}';
			createDangerous = false;
		} catch (caught) {
			createError = caught instanceof Error ? caught.message : 'Could not create template';
		} finally {
			createBusy = false;
		}
	}
</script>

<Card.Root size="sm">
	<Card.Header>
		<Card.Title class="flex items-center gap-2 text-base">
			<Workflow class="size-4" />
			Runbooks
		</Card.Title>
		<Card.Description>Reusable operator workflows prepared for fleet execution.</Card.Description>
	</Card.Header>
	<Card.Content class="space-y-3">
		{#each templates as template (template.id)}
			<button
				type="button"
				class="w-full rounded-md border p-3 text-left transition-colors hover:bg-accent/50 data-[active=true]:border-primary data-[active=true]:bg-primary/5"
				data-active={template.id === selectedTemplateId}
				onclick={() => onSelectTemplate(template.id)}
			>
				<div class="flex flex-wrap items-start justify-between gap-2">
					<div class="min-w-0">
						<div class="font-medium">{template.name}</div>
						<div class="mt-1 text-xs text-muted-foreground">{template.description}</div>
					</div>
					<Badge variant={template.risk === 'high' ? 'destructive' : 'outline'}>
						{fleetRiskLabel(template.risk)}
					</Badge>
				</div>
				<div class="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
					<span class="inline-flex items-center gap-1">
						<Clock3 class="size-3.5" />
						{template.estimatedDuration}
					</span>
					<span class="inline-flex items-center gap-1">
						<ShieldCheck class="size-3.5" />
						{fleetRiskLabel(template.risk)} risk
					</span>
					<span>{template.category}</span>
				</div>
			</button>
		{/each}
	</Card.Content>
	<Card.Footer class="flex items-center justify-between border-t pt-4">
		<div class="text-xs text-muted-foreground">
			{templates.find((template) => template.id === selectedTemplateId)?.parameters.join(', ')}
		</div>
		<Dialog.Root bind:open={createOpen}>
			<Dialog.Trigger>
				{#snippet child({ props })}
					<Button size="sm" {...props}>
						<Plus class="size-4" />
						Create
					</Button>
				{/snippet}
			</Dialog.Trigger>
			<Dialog.Content class="max-w-lg">
				<Dialog.Header>
					<Dialog.Title>Create runbook</Dialog.Title>
					<Dialog.Description>
						Save a private or workspace-ready runbook with typed placeholders.
					</Dialog.Description>
				</Dialog.Header>
				<form class="space-y-4" onsubmit={(event) => (event.preventDefault(), submitCreate())}>
					<div class="grid gap-2">
						<Label for="fleet-template-name">Name</Label>
						<Input id="fleet-template-name" bind:value={createName} required />
					</div>
					<div class="grid gap-3 sm:grid-cols-2">
						<div class="grid gap-2">
							<Label for="fleet-template-kind">Kind</Label>
							<Select.Root type="single" bind:value={createKind}>
								<Select.Trigger id="fleet-template-kind" class="w-full">
									{createKind.replaceAll('_', ' ')}
								</Select.Trigger>
								<Select.Content>
									<Select.Item value="ssh_command">SSH command</Select.Item>
									<Select.Item value="file_transfer">File transfer</Select.Item>
									<Select.Item value="ssh_tunnel">SSH tunnel</Select.Item>
									<Select.Item value="rdp_checklist">RDP checklist</Select.Item>
									<Select.Item value="operator_note">Operator note</Select.Item>
								</Select.Content>
							</Select.Root>
						</div>
						<div class="grid gap-2">
							<Label for="fleet-template-visibility">Visibility</Label>
							<Select.Root type="single" value={createVisibility} onValueChange={changeVisibility}>
								<Select.Trigger id="fleet-template-visibility" class="w-full">
									{createVisibility}
								</Select.Trigger>
								<Select.Content>
									<Select.Item value="private">Private</Select.Item>
									<Select.Item value="workspace" disabled={workspaces.length === 0}
										>Workspace</Select.Item
									>
								</Select.Content>
							</Select.Root>
						</div>
					</div>
					{#if createVisibility === 'workspace'}
						<div class="grid gap-2">
							<Label for="fleet-template-workspace">Workspace</Label>
							<Select.Root type="single" value={createWorkspaceId} onValueChange={changeWorkspace}>
								<Select.Trigger id="fleet-template-workspace" class="w-full">
									{selectedWorkspace?.name ?? 'Choose workspace'}
								</Select.Trigger>
								<Select.Content>
									{#each workspaces as workspace (workspace.id)}
										<Select.Item value={workspace.id}>{workspace.name}</Select.Item>
									{/each}
								</Select.Content>
							</Select.Root>
							{#if workspaceSelectionMissing}
								<p class="text-xs text-destructive">
									Choose a workspace before creating this runbook.
								</p>
							{/if}
						</div>
					{/if}
					<div class="grid gap-2">
						<Label for="fleet-template-variables">Variables</Label>
						<Input id="fleet-template-variables" bind:value={createVariables} />
					</div>
					<div class="grid gap-2">
						<Label for="fleet-template-body">Preview body</Label>
						<Textarea id="fleet-template-body" bind:value={createBody} rows={5} />
					</div>
					<label class="flex items-center gap-2 text-sm">
						<Checkbox bind:checked={createDangerous} />
						Mark as high risk
					</label>
					{#if createError}
						<p class="text-sm text-destructive">{createError}</p>
					{/if}
					<Dialog.Footer>
						<Button type="button" variant="outline" onclick={() => (createOpen = false)}>
							Cancel
						</Button>
						<Button type="submit" disabled={createDisabled}>
							{createBusy ? 'Creating...' : 'Create runbook'}
						</Button>
					</Dialog.Footer>
				</form>
			</Dialog.Content>
		</Dialog.Root>
	</Card.Footer>
</Card.Root>
