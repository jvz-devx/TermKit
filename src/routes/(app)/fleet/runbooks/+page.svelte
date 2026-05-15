<script lang="ts">
	import FleetRunbooksPage from '$lib/components/termix/fleet/FleetRunbooksPage.svelte';
	import { getFleetRunbooks } from '$lib/fleet.remote';
</script>

<FleetRunbooksPage runbooks={await getFleetRunbooks()} />
