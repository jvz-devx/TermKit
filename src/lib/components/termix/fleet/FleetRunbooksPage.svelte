<script lang="ts">
	import { createFleetAutomationTemplate, getFleetRunbooks } from '$lib/fleet.remote';
	import AutomationTemplatesPanel from './AutomationTemplatesPanel.svelte';
	import type { FleetAutomationTemplate } from './fleet-data';

	let { runbooks }: { runbooks: FleetAutomationTemplate[] } = $props();

	let selectedRunbookId = $state('');

	async function createRunbook(input: {
		name: string;
		kind: string;
		visibility: string;
		body: string;
		variables: string;
		dangerous: boolean;
	}) {
		await createFleetAutomationTemplate(input).updates(getFleetRunbooks);
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
		selectedTemplateId={selectedRunbookId}
		onSelectTemplate={(runbookId) => (selectedRunbookId = runbookId)}
		onCreateTemplate={createRunbook}
	/>
</section>
