<script lang="ts">
	import FleetExecutionBuilder from '$lib/components/termix/fleet/FleetExecutionBuilder.svelte';
	import { getFleetOverview } from '$lib/remotes/fleet.remote';
</script>

<FleetExecutionBuilder overview={await getFleetOverview()} />
