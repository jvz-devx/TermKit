<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import * as Card from '$lib/components/ui/card';
	import * as Tabs from '$lib/components/ui/tabs';
	import {
		createFleetAutomationTemplate,
		decideFleetApproval,
		getFleetOverview,
		queueFleetBulkOperation
	} from '$lib/fleet.remote';
	import { Activity, Bot, CheckCircle2, Server, ShieldAlert } from '@lucide/svelte';
	import AutomationTemplatesPanel from './AutomationTemplatesPanel.svelte';
	import BulkOperationsPanel from './BulkOperationsPanel.svelte';
	import {
		buildBulkOperationReview,
		filterFleetHosts,
		type FleetHealthStatus,
		type FleetHostFilters,
		type FleetOverview,
		uniqueFleetValues
	} from './fleet-data';
	import HostHealthInventoryPanel from './HostHealthInventoryPanel.svelte';
	import JobHistoryReporting from './JobHistoryReporting.svelte';
	import PolicyApprovalsPanel from './PolicyApprovalsPanel.svelte';

	let {
		overview,
		dataSourceLabel = 'remote functions'
	}: {
		overview: FleetOverview;
		dataSourceLabel?: string;
	} = $props();

	let activeTab = $state('operations');
	let search = $state('');
	let statusFilter = $state<FleetHostFilters['status']>('all');
	let workspaceFilter = $state('all');
	let regionFilter = $state('all');
	let patchFilter = $state<FleetHostFilters['patchState']>('all');
	let selectedTemplateId = $state('');
	let selectedOperationId = $state('');
	let selectedHostIds = $state<string[]>([]);
	let targetSelectionTouched = $state(false);

	const filters = $derived<FleetHostFilters>({
		search,
		status: statusFilter,
		workspace: workspaceFilter,
		region: regionFilter,
		patchState: patchFilter
	});
	const filteredHosts = $derived(filterFleetHosts(overview.hosts, filters));
	const defaultSelectedHostIds = $derived(
		overview.hosts
			.filter((host) => host.status !== 'offline' && host.environment === 'production')
			.slice(0, 3)
			.map((host) => host.id)
	);
	const effectiveSelectedHostIds = $derived(
		targetSelectionTouched ? selectedHostIds : defaultSelectedHostIds
	);
	const selectedHosts = $derived(
		overview.hosts.filter((host) => effectiveSelectedHostIds.includes(host.id))
	);
	const activeTemplateId = $derived(selectedTemplateId || overview.templates[0]?.id || '');
	const activeOperationId = $derived(selectedOperationId || overview.bulkOperations[0]?.id || '');
	const selectedOperation = $derived(
		overview.bulkOperations.find((operation) => operation.id === activeOperationId)
	);
	const targetReview = $derived(buildBulkOperationReview(selectedOperation, selectedHosts));
	const workspaces = $derived(uniqueFleetValues(overview.hosts.map((host) => host.workspace)));
	const regions = $derived(uniqueFleetValues(overview.hosts.map((host) => host.region)));
	const healthCounts = $derived({
		healthy: overview.hosts.filter((host) => host.status === 'healthy').length,
		degraded: overview.hosts.filter((host) => host.status === 'degraded').length,
		offline: overview.hosts.filter((host) => host.status === 'offline').length,
		maintenance: overview.hosts.filter((host) => host.status === 'maintenance').length
	});
	const pendingApprovals = $derived(
		overview.policies.filter((policy) => policy.status === 'pending').length
	);
	const runningJobs = $derived(
		overview.jobs.filter((job) => job.status === 'running' || job.status === 'queued').length
	);

	function setSearch(value: string) {
		search = value;
	}

	function setStatus(value: FleetHealthStatus | 'all') {
		statusFilter = value;
	}

	function toggleHost(hostId: string) {
		const currentHostIds = targetSelectionTouched ? selectedHostIds : defaultSelectedHostIds;
		selectedHostIds = currentHostIds.includes(hostId)
			? currentHostIds.filter((id) => id !== hostId)
			: [...currentHostIds, hostId];
		targetSelectionTouched = true;
	}

	function toggleVisibleHosts() {
		const currentHostIds = targetSelectionTouched ? selectedHostIds : defaultSelectedHostIds;
		const visibleIds = filteredHosts.map((host) => host.id);
		const allVisibleSelected = visibleIds.every((id) => currentHostIds.includes(id));
		selectedHostIds = allVisibleSelected
			? currentHostIds.filter((id) => !visibleIds.includes(id))
			: [...new Set([...currentHostIds, ...visibleIds])];
		targetSelectionTouched = true;
	}

	function clearFilters() {
		search = '';
		statusFilter = 'all';
		workspaceFilter = 'all';
		regionFilter = 'all';
		patchFilter = 'all';
	}

	async function createTemplate(input: {
		name: string;
		kind: string;
		visibility: string;
		body: string;
		variables: string;
		dangerous: boolean;
	}) {
		await createFleetAutomationTemplate(input).updates(getFleetOverview);
	}

	async function queueOperation(input: {
		operationId: string;
		targetHostIds: string[];
		reason: string;
		concurrencyLimit: number;
	}) {
		await queueFleetBulkOperation({
			...input,
			templateId: activeTemplateId
		}).updates(getFleetOverview);
	}

	async function decideApproval(approvalId: string, status: 'approved' | 'rejected') {
		await decideFleetApproval({ approvalId, status }).updates(getFleetOverview);
	}
</script>

<svelte:head>
	<title>Fleet Operations · TermixKit</title>
</svelte:head>

<section class="space-y-4 p-4">
	<div class="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
		<div>
			<div class="flex flex-wrap items-center gap-2">
				<h1 class="text-lg font-semibold">Fleet operations</h1>
				<Badge variant="outline">{dataSourceLabel}</Badge>
			</div>
			<p class="text-sm text-muted-foreground">
				Automation, bulk execution review, approvals, reporting, and inventory health.
			</p>
		</div>
		<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
			<Card.Root size="sm" class="min-w-32 gap-1 py-3">
				<Card.Content class="px-4">
					<div class="flex items-center gap-2 text-xs text-muted-foreground">
						<Server class="size-3.5" />
						Hosts
					</div>
					<div class="mt-1 text-xl font-semibold">{overview.hosts.length}</div>
				</Card.Content>
			</Card.Root>
			<Card.Root size="sm" class="min-w-32 gap-1 py-3">
				<Card.Content class="px-4">
					<div class="flex items-center gap-2 text-xs text-muted-foreground">
						<Activity class="size-3.5" />
						Healthy
					</div>
					<div class="mt-1 text-xl font-semibold">{healthCounts.healthy}</div>
				</Card.Content>
			</Card.Root>
			<Card.Root size="sm" class="min-w-32 gap-1 py-3">
				<Card.Content class="px-4">
					<div class="flex items-center gap-2 text-xs text-muted-foreground">
						<Bot class="size-3.5" />
						Running
					</div>
					<div class="mt-1 text-xl font-semibold">{runningJobs}</div>
				</Card.Content>
			</Card.Root>
			<Card.Root size="sm" class="min-w-32 gap-1 py-3">
				<Card.Content class="px-4">
					<div class="flex items-center gap-2 text-xs text-muted-foreground">
						<ShieldAlert class="size-3.5" />
						Approvals
					</div>
					<div class="mt-1 text-xl font-semibold">{pendingApprovals}</div>
				</Card.Content>
			</Card.Root>
		</div>
	</div>

	<Tabs.Root bind:value={activeTab}>
		<Tabs.List variant="line" class="w-full justify-start overflow-x-auto">
			<Tabs.Trigger value="operations">Operations</Tabs.Trigger>
			<Tabs.Trigger value="inventory">Inventory</Tabs.Trigger>
			<Tabs.Trigger value="reports">Reports</Tabs.Trigger>
			<Tabs.Trigger value="policies">Policies</Tabs.Trigger>
		</Tabs.List>

		<Tabs.Content value="operations" class="space-y-4">
			<div class="grid gap-4 2xl:grid-cols-[420px_1fr]">
				<AutomationTemplatesPanel
					templates={overview.templates}
					selectedTemplateId={activeTemplateId}
					onSelectTemplate={(templateId) => (selectedTemplateId = templateId)}
					onCreateTemplate={createTemplate}
				/>
				<BulkOperationsPanel
					operations={overview.bulkOperations}
					selectedOperationId={activeOperationId}
					targets={selectedHosts}
					review={targetReview}
					onSelectOperation={(operationId) => (selectedOperationId = operationId)}
					onQueueOperation={queueOperation}
				/>
			</div>
			<HostHealthInventoryPanel
				hosts={overview.hosts}
				{filteredHosts}
				{filters}
				{workspaces}
				{regions}
				selectedHostIds={effectiveSelectedHostIds}
				onSearch={setSearch}
				onStatusFilter={setStatus}
				onWorkspaceFilter={(value) => (workspaceFilter = value)}
				onRegionFilter={(value) => (regionFilter = value)}
				onPatchFilter={(value) => (patchFilter = value)}
				onToggleHost={toggleHost}
				onToggleVisible={toggleVisibleHosts}
				onClearFilters={clearFilters}
			/>
		</Tabs.Content>

		<Tabs.Content value="inventory" class="space-y-4">
			<HostHealthInventoryPanel
				hosts={overview.hosts}
				{filteredHosts}
				{filters}
				{workspaces}
				{regions}
				selectedHostIds={effectiveSelectedHostIds}
				onSearch={setSearch}
				onStatusFilter={setStatus}
				onWorkspaceFilter={(value) => (workspaceFilter = value)}
				onRegionFilter={(value) => (regionFilter = value)}
				onPatchFilter={(value) => (patchFilter = value)}
				onToggleHost={toggleHost}
				onToggleVisible={toggleVisibleHosts}
				onClearFilters={clearFilters}
			/>
		</Tabs.Content>

		<Tabs.Content value="reports" class="space-y-4">
			<div class="grid gap-4 xl:grid-cols-[1fr_320px]">
				<JobHistoryReporting jobs={overview.jobs} />
				<Card.Root size="sm">
					<Card.Header>
						<Card.Title class="flex items-center gap-2 text-base">
							<CheckCircle2 class="size-4" />
							Reporting summary
						</Card.Title>
						<Card.Description>Latest execution rollup.</Card.Description>
					</Card.Header>
					<Card.Content class="space-y-3 text-sm">
						<div class="flex justify-between">
							<span class="text-muted-foreground">Completed jobs</span>
							<span>{overview.jobs.filter((job) => job.status === 'completed').length}</span>
						</div>
						<div class="flex justify-between">
							<span class="text-muted-foreground">Failed targets</span>
							<span>{overview.jobs.reduce((total, job) => total + job.failed, 0)}</span>
						</div>
						<div class="flex justify-between">
							<span class="text-muted-foreground">Evidence reports</span>
							<span>{overview.jobs.length}</span>
						</div>
					</Card.Content>
				</Card.Root>
			</div>
		</Tabs.Content>

		<Tabs.Content value="policies" class="space-y-4">
			<PolicyApprovalsPanel policies={overview.policies} onDecideApproval={decideApproval} />
		</Tabs.Content>
	</Tabs.Root>
</section>
