<script lang="ts">
	import { page } from '$app/state';
	import FleetExecutionDetailPage from '$lib/components/termix/fleet/FleetExecutionDetailPage.svelte';
	import { getFleetExecutions } from '$lib/fleet.remote';

	const executions = await getFleetExecutions();
	const execution = executions.find((candidate) => candidate.id === page.params.executionId) ?? null;
</script>

<FleetExecutionDetailPage {execution} />
