<script lang="ts">
	import FleetTargetsPage from '$lib/components/termix/fleet/FleetTargetsPage.svelte';
	import { getFleetTargets } from '$lib/fleet.remote';
</script>

<FleetTargetsPage targets={await getFleetTargets()} />
