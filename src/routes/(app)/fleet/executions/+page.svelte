<script lang="ts">
	import FleetExecutionsPage from '$lib/components/termix/fleet/FleetExecutionsPage.svelte';
	import { getFleetExecutions } from '$lib/fleet.remote';
</script>

<FleetExecutionsPage executions={await getFleetExecutions()} />
