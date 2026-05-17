<script lang="ts">
	import { createFleetAutomationTemplate, getFleetRunbooks } from '$lib/remotes/fleet.remote';
	import AutomationTemplatesPanel from './AutomationTemplatesPanel.svelte';

	const runbooksQuery = getFleetRunbooks();

	let selectedRunbookId = $state('');
	let runbooks = $derived(runbooksQuery.current?.templates ?? []);
	let workspaces = $derived(runbooksQuery.current?.workspaces ?? []);

	async function createRunbook(input: {
		name: string;
		kind: string;
		visibility: string;
		workspaceId: string | null;
		body: string;
		variables: string;
		dangerous: boolean;
	}) {
		const created = await createFleetAutomationTemplate(input).updates(getFleetRunbooks);
		selectedRunbookId = created.id;
	}
</script>

<svelte:head>
	<title>Fleet Runbooks · TermixKit</title>
</svelte:head>

<section class="space-y-4 p-4">
	<div>
		<h1 class="text-lg font-semibold">Runbooks</h1>
		<p class="text-sm text-muted-foreground">
			Reusable workflows operators can deliberately choose before running across targets.
		</p>
	</div>
	<AutomationTemplatesPanel
		templates={runbooks}
		{workspaces}
		selectedTemplateId={selectedRunbookId}
		onSelectTemplate={(runbookId) => (selectedRunbookId = runbookId)}
		onCreateTemplate={createRunbook}
	/>
</section>
