<script lang="ts">
	import { getFleetOverview, queueFleetBulkOperation } from '$lib/fleet.remote';
	import BulkOperationsPanel from './BulkOperationsPanel.svelte';
	import {
		buildBulkOperationSummary,
		filterFleetHosts,
		type FleetHealthStatus,
		type FleetHostFilters,
		type FleetOverview,
		uniqueFleetValues
	} from './fleet-data';
	import HostHealthInventoryPanel from './HostHealthInventoryPanel.svelte';

	let { overview }: { overview: FleetOverview } = $props();

	let selectedRunbookId = $state('');
	let selectedOperationId = $state('');
	let selectedHostIds = $state<string[]>([]);
	let search = $state('');
	let statusFilter = $state<FleetHostFilters['status']>('all');
	let workspaceFilter = $state('all');
	let regionFilter = $state('all');
	let patchFilter = $state<FleetHostFilters['patchState']>('all');

	const selectedRunbook = $derived(
		overview.templates.find((template) => template.id === selectedRunbookId) ?? null
	);
	const selectedOperation = $derived(
		overview.bulkOperations.find((operation) => operation.id === selectedOperationId) ?? null
	);
	const selectedHosts = $derived(
		overview.hosts.filter((host) => selectedHostIds.includes(host.id))
	);
	const summary = $derived(
		buildBulkOperationSummary(selectedOperation, selectedRunbook, selectedHosts)
	);
	const filters = $derived<FleetHostFilters>({
		search,
		status: statusFilter,
		workspace: workspaceFilter,
		region: regionFilter,
		patchState: patchFilter
	});
	const filteredHosts = $derived(filterFleetHosts(overview.hosts, filters));
	const workspaces = $derived(uniqueFleetValues(overview.hosts.map((host) => host.workspace)));
	const regions = $derived(uniqueFleetValues(overview.hosts.map((host) => host.region)));

	function toggleHost(hostId: string) {
		selectedHostIds = selectedHostIds.includes(hostId)
			? selectedHostIds.filter((id) => id !== hostId)
			: [...selectedHostIds, hostId];
	}

	function toggleVisibleHosts() {
		const visibleIds = filteredHosts.map((host) => host.id);
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
	<title>New Fleet Execution · TermixKit</title>
</svelte:head>

<section class="space-y-4 p-4">
	<div>
		<h1 class="text-lg font-semibold">New execution</h1>
		<p class="text-sm text-muted-foreground">
			Pick an action, pick hosts, confirm the target count, and run.
		</p>
	</div>
	<BulkOperationsPanel
		runbooks={overview.templates}
		{selectedRunbookId}
		operations={overview.bulkOperations}
		{selectedOperationId}
		targets={selectedHosts}
		{summary}
		onSelectRunbook={(runbookId) => (selectedRunbookId = runbookId)}
		onSelectOperation={(operationId) => (selectedOperationId = operationId)}
		onQueueOperation={async (input) => queueFleetBulkOperation(input).updates(getFleetOverview)}
	/>
	<HostHealthInventoryPanel
		hosts={overview.hosts}
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
