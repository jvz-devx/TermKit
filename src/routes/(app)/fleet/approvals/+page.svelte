<script lang="ts">
	import FleetApprovalsPage from '$lib/components/termix/fleet/FleetApprovalsPage.svelte';
	import { getFleetApprovals } from '$lib/fleet.remote';
</script>

<FleetApprovalsPage approvals={await getFleetApprovals()} />
