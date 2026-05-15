<script lang="ts">
	import {
		filterFleetHosts,
		type FleetHealthStatus,
		type FleetHost,
		type FleetHostFilters,
		uniqueFleetValues
	} from './fleet-data';
	import HostHealthInventoryPanel from './HostHealthInventoryPanel.svelte';

	let { targets }: { targets: FleetHost[] } = $props();

	let search = $state('');
	let statusFilter = $state<FleetHostFilters['status']>('all');
	let workspaceFilter = $state('all');
	let regionFilter = $state('all');
	let patchFilter = $state<FleetHostFilters['patchState']>('all');
	let selectedHostIds = $state<string[]>([]);

	const filters = $derived<FleetHostFilters>({
		search,
		status: statusFilter,
		workspace: workspaceFilter,
		region: regionFilter,
		patchState: patchFilter
	});
	const filteredHosts = $derived(filterFleetHosts(targets, filters));
	const workspaces = $derived(uniqueFleetValues(targets.map((target) => target.workspace)));
	const regions = $derived(uniqueFleetValues(targets.map((target) => target.region)));

	function toggleHost(hostId: string) {
		selectedHostIds = selectedHostIds.includes(hostId)
			? selectedHostIds.filter((id) => id !== hostId)
			: [...selectedHostIds, hostId];
	}

	function toggleVisibleHosts() {
		const visibleIds = filteredHosts.map((target) => target.id);
		const allVisibleSelected = visibleIds.every((id) => selectedHostIds.includes(id));
		selectedHostIds = allVisibleSelected
			? selectedHostIds.filter((id) => !visibleIds.includes(id))
			: [...new Set([...selectedHostIds, ...visibleIds])];
	}

	function clearFilters() {
		search = '';
		statusFilter = 'all';
		workspaceFilter = 'all';
		regionFilter = 'all';
		patchFilter = 'all';
	}
</script>

<svelte:head>
	<title>Fleet Targets · TermixKit</title>
</svelte:head>

<section class="space-y-4 p-4">
	<div>
		<h1 class="text-lg font-semibold">Targets</h1>
		<p class="text-sm text-muted-foreground">
			Browse health, reachability, credentials, risk, and inferred action state.
		</p>
	</div>
	<HostHealthInventoryPanel
		hosts={targets}
		{filteredHosts}
		{filters}
		{workspaces}
		{regions}
		{selectedHostIds}
		onSearch={(value) => (search = value)}
		onStatusFilter={(value: FleetHealthStatus | 'all') => (statusFilter = value)}
		onWorkspaceFilter={(value) => (workspaceFilter = value)}
		onRegionFilter={(value) => (regionFilter = value)}
		onPatchFilter={(value) => (patchFilter = value)}
		onToggleHost={toggleHost}
		onToggleVisible={toggleVisibleHosts}
		onClearFilters={clearFilters}
	/>
</section>
