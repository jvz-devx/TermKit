<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import { Progress } from '$lib/components/ui/progress';
	import * as Table from '$lib/components/ui/table';
	import { Filter, Search, ServerCog, X } from '@lucide/svelte';
	import type { FleetHealthStatus, FleetHost, FleetHostFilters } from './fleet-data';
	import { explainFleetTargetHealth, fleetStatusLabel } from './fleet-data';

	let {
		hosts,
		filteredHosts,
		filters,
		workspaces,
		regions,
		selectedHostIds,
		onSearch,
		onStatusFilter,
		onWorkspaceFilter,
		onRegionFilter,
		onPatchFilter,
		onToggleHost,
		onToggleVisible,
		onClearFilters
	}: {
		hosts: FleetHost[];
		filteredHosts: FleetHost[];
		filters: FleetHostFilters;
		workspaces: string[];
		regions: string[];
		selectedHostIds: string[];
		onSearch: (value: string) => void;
		onStatusFilter: (value: FleetHostFilters['status']) => void;
		onWorkspaceFilter: (value: string) => void;
		onRegionFilter: (value: string) => void;
		onPatchFilter: (value: FleetHostFilters['patchState']) => void;
		onToggleHost: (hostId: string) => void;
		onToggleVisible: () => void;
		onClearFilters: () => void;
	} = $props();

	const healthFilters: Array<FleetHealthStatus | 'all'> = [
		'all',
		'healthy',
		'degraded',
		'offline',
		'maintenance'
	];
	const patchFilters: Array<FleetHostFilters['patchState']> = ['all', 'current', 'due', 'overdue'];
	const visibleSelectedCount = $derived(
		filteredHosts.filter((host) => selectedHostIds.includes(host.id)).length
	);
	const allVisibleSelected = $derived(
		filteredHosts.length > 0 && visibleSelectedCount === filteredHosts.length
	);
	const hasFilters = $derived(
		Boolean(filters.search.trim()) ||
			filters.status !== 'all' ||
			filters.workspace !== 'all' ||
			filters.region !== 'all' ||
			filters.patchState !== 'all'
	);

	function inputValue(event: Event) {
		return (event.currentTarget as HTMLInputElement).value;
	}

	function selectValue(event: Event) {
		return (event.currentTarget as HTMLSelectElement).value;
	}

	function statusTone(status: FleetHealthStatus) {
		if (status === 'healthy') return 'bg-emerald-500';
		if (status === 'degraded') return 'bg-amber-500';
		if (status === 'maintenance') return 'bg-sky-500';
		return 'bg-destructive';
	}
</script>

<section class="space-y-3">
	<div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
		<div>
			<h2 class="flex items-center gap-2 text-base font-semibold">
				<ServerCog class="size-4" />
				Targets
			</h2>
			<p class="text-sm text-muted-foreground">
				{filteredHosts.length} of {hosts.length} targets match the current filters.
			</p>
		</div>
		<div class="flex flex-wrap gap-2">
			<Button
				size="sm"
				variant={allVisibleSelected ? 'secondary' : 'outline'}
				onclick={onToggleVisible}
				disabled={!filteredHosts.length}
			>
				<Filter class="size-4" />
				{allVisibleSelected ? 'Clear visible' : 'Select visible'}
			</Button>
			{#if hasFilters}
				<Button size="sm" variant="ghost" onclick={onClearFilters}>
					<X class="size-4" />
					Clear filters
				</Button>
			{/if}
		</div>
	</div>

	<div class="grid gap-2 md:grid-cols-[minmax(220px,1fr)_repeat(4,minmax(130px,auto))]">
		<div class="relative">
			<Search class="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
			<Input
				class="pl-8"
				placeholder="Search host, owner, tag, OS"
				value={filters.search}
				oninput={(event) => onSearch(inputValue(event))}
			/>
		</div>
		<select
			class="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
			value={filters.status}
			aria-label="Filter by health"
			onchange={(event) => onStatusFilter(selectValue(event) as FleetHostFilters['status'])}
		>
			{#each healthFilters as status (status)}
				<option value={status}>{status === 'all' ? 'All health' : fleetStatusLabel(status)}</option>
			{/each}
		</select>
		<select
			class="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
			value={filters.workspace}
			aria-label="Filter by workspace"
			onchange={(event) => onWorkspaceFilter(selectValue(event))}
		>
			<option value="all">All workspaces</option>
			{#each workspaces as workspace (workspace)}
				<option value={workspace}>{workspace}</option>
			{/each}
		</select>
		<select
			class="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
			value={filters.region}
			aria-label="Filter by region"
			onchange={(event) => onRegionFilter(selectValue(event))}
		>
			<option value="all">All regions</option>
			{#each regions as region (region)}
				<option value={region}>{region.toUpperCase()}</option>
			{/each}
		</select>
		<select
			class="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
			value={filters.patchState}
			aria-label="Filter by patch state"
			onchange={(event) => onPatchFilter(selectValue(event) as FleetHostFilters['patchState'])}
		>
			{#each patchFilters as patchState (patchState)}
				<option value={patchState}>
					{patchState === 'all' ? 'All patch states' : patchState}
				</option>
			{/each}
		</select>
	</div>

	<div class="overflow-hidden rounded-md border">
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head class="w-10">Use</Table.Head>
					<Table.Head>Target</Table.Head>
					<Table.Head>Status</Table.Head>
					<Table.Head>Workspace</Table.Head>
					<Table.Head>Load</Table.Head>
					<Table.Head>Action state</Table.Head>
					<Table.Head>Last check</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each filteredHosts as host (host.id)}
					{@const health = explainFleetTargetHealth(host)}
					<Table.Row data-state={selectedHostIds.includes(host.id) ? 'selected' : undefined}>
						<Table.Cell>
							<Checkbox
								checked={selectedHostIds.includes(host.id)}
								aria-label={`Select ${host.name}`}
								onclick={() => onToggleHost(host.id)}
							/>
						</Table.Cell>
						<Table.Cell>
							<div class="font-medium">{host.name}</div>
							<div class="text-xs text-muted-foreground">
								{host.hostname} · {host.os}
							</div>
							<div class="mt-1 flex flex-wrap gap-1">
								{#each host.protocols as protocol (protocol)}
									<Badge variant="outline" class="h-4 px-1.5 text-[10px]">
										{protocol.toUpperCase()}
									</Badge>
								{/each}
							</div>
						</Table.Cell>
						<Table.Cell>
							<div class="flex items-center gap-2">
								<span class={`size-2 rounded-full ${statusTone(host.status)}`}></span>
								<span>{health.label}</span>
							</div>
							<div class="max-w-56 text-xs text-muted-foreground">{health.reason}</div>
							<div class="mt-1 flex flex-wrap gap-1">
								<Badge
									variant={host.riskScore >= 70 ? 'destructive' : 'outline'}
									class="h-4 px-1.5 text-[10px]"
								>
									Risk {host.riskScore}
								</Badge>
								<Badge variant="outline" class="h-4 px-1.5 text-[10px]">
									{health.credentialSignal === 'failed'
										? 'Credential failed'
										: `Credential ${health.credentialSignal}`}
								</Badge>
							</div>
						</Table.Cell>
						<Table.Cell>
							<div>{host.workspace}</div>
							<div class="text-xs text-muted-foreground">
								{host.owner} · {host.region.toUpperCase()}
							</div>
						</Table.Cell>
						<Table.Cell class="min-w-36">
							<div class="mb-1 flex justify-between text-xs text-muted-foreground">
								<span>CPU {host.cpuLoad}%</span>
								<span>MEM {host.memoryLoad}%</span>
							</div>
							<Progress value={Math.max(host.cpuLoad, host.memoryLoad)} />
						</Table.Cell>
						<Table.Cell>
							<Badge variant={host.patchState === 'overdue' ? 'destructive' : 'outline'}>
								Inferred {host.patchState}
							</Badge>
						</Table.Cell>
						<Table.Cell class="text-sm text-muted-foreground">
							<div>{health.lastCheckedAt ?? `${host.lastSeenMinutes}m ago`}</div>
							<div class="text-xs">Next {health.nextCheckAt ?? 'not scheduled'}</div>
						</Table.Cell>
					</Table.Row>
				{:else}
					<Table.Row>
						<Table.Cell colspan={7} class="h-24 text-center text-muted-foreground">
							No hosts match these filters.
						</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	</div>
</section>
