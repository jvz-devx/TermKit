<script lang="ts">
	import FleetDashboard from '$lib/components/termix/fleet/FleetDashboard.svelte';
	import { getFleetOverview } from '$lib/remotes/fleet.remote';
</script>

<FleetDashboard overview={await getFleetOverview()} dataSourceLabel="remote functions" />
