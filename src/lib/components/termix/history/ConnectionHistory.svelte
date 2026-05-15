<script lang="ts">
	import { AlertCircle, CalendarDays, History, RotateCcw, Search, X } from '@lucide/svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as NativeSelect from '$lib/components/ui/native-select';
	import * as Table from '$lib/components/ui/table';
	import { listConnectionHistory, type ConnectionHistorySummary } from '$lib/termix.remote';
	import { failureCopy, humanizeCode } from '$lib/termix/failure-copy';
	import StatePanel from '../StatePanel.svelte';

	type ProtocolFilter = ConnectionHistorySummary['protocol'] | 'all';
	type StatusFilter = ConnectionHistorySummary['status'] | 'all';

	const historyQuery = listConnectionHistory();
	const protocolOptions: ProtocolFilter[] = ['all', 'ssh', 'rdp', 'vnc', 'telnet'];
	const statusOptions: StatusFilter[] = ['all', 'starting', 'active', 'ended', 'failed'];

	let search = $state('');
	let userFilter = $state('all');
	let workspaceFilter = $state('all');
	let protocolFilter = $state<ProtocolFilter>('all');
	let hostFilter = $state('all');
	let statusFilter = $state<StatusFilter>('all');
	let startedAfter = $state('');
	let startedBefore = $state('');

	let rows = $derived(historyQuery.current ?? []);
	let userOptions = $derived(uniqueOptions(rows.map((row) => [row.userId, row.user])));
	let workspaceOptions = $derived(
		uniqueOptions(rows.map((row) => [row.workspaceId ?? 'personal', row.workspace]))
	);
	let hostOptions = $derived(
		uniqueOptions(rows.map((row) => [hostKey(row), `${row.host} (${row.hostname})`]))
	);
	let failedCount = $derived(rows.filter((row) => row.status === 'failed').length);
	let activeCount = $derived(
		rows.filter((row) => row.status === 'active' || row.status === 'starting').length
	);
	let filteredRows = $derived.by(() => {
		const needle = search.trim().toLowerCase();

		return rows.filter((row) => {
			if (userFilter !== 'all' && row.userId !== userFilter) return false;
			if (workspaceFilter !== 'all' && (row.workspaceId ?? 'personal') !== workspaceFilter) {
				return false;
			}
			if (protocolFilter !== 'all' && row.protocol !== protocolFilter) return false;
			if (hostFilter !== 'all' && hostKey(row) !== hostFilter) return false;
			if (statusFilter !== 'all' && row.status !== statusFilter) return false;
			if (!matchesDateRange(row.startedAt)) return false;
			if (!needle) return true;

			return [
				row.protocol,
				row.host,
				row.hostname,
				row.hostUser,
				row.user,
				row.workspace,
				row.status,
				row.errorReason
			]
				.filter(Boolean)
				.join(' ')
				.toLowerCase()
				.includes(needle);
		});
	});
	let activeFilterCount = $derived(
		[
			search.trim(),
			userFilter !== 'all',
			workspaceFilter !== 'all',
			protocolFilter !== 'all',
			hostFilter !== 'all',
			statusFilter !== 'all',
			startedAfter,
			startedBefore
		].filter(Boolean).length
	);

	function clearFilters() {
		search = '';
		userFilter = 'all';
		workspaceFilter = 'all';
		protocolFilter = 'all';
		hostFilter = 'all';
		statusFilter = 'all';
		startedAfter = '';
		startedBefore = '';
	}

	function matchesDateRange(value: string) {
		const started = new Date(value).getTime();
		if (startedAfter && started < new Date(`${startedAfter}T00:00:00`).getTime()) return false;
		if (startedBefore && started > new Date(`${startedBefore}T23:59:59.999`).getTime()) {
			return false;
		}
		return true;
	}

	function uniqueOptions(values: Array<[string, string]>) {
		return [...new Map(values).entries()].sort((left, right) => left[1].localeCompare(right[1]));
	}

	function hostKey(row: ConnectionHistorySummary) {
		return row.hostId ?? `deleted:${row.hostname}`;
	}

	function protocolLabel(protocol: ProtocolFilter) {
		return protocol === 'all' ? 'All protocols' : protocol.toUpperCase();
	}

	function statusLabel(status: StatusFilter) {
		if (status === 'all') return 'All statuses';
		if (status === 'starting') return 'Starting';
		if (status === 'active') return 'Active';
		if (status === 'ended') return 'Ended';
		return 'Failed';
	}

	function statusVariant(status: ConnectionHistorySummary['status']) {
		if (status === 'failed') return 'destructive';
		if (status === 'active') return 'secondary';
		return 'outline';
	}

	function formatDate(value: string | null) {
		return value ? new Date(value).toLocaleString() : 'Still running';
	}

	function formatDuration(value: number | null) {
		if (value === null) return 'In progress';
		const totalSeconds = Math.max(0, Math.round(value / 1000));
		const hours = Math.floor(totalSeconds / 3600);
		const minutes = Math.floor((totalSeconds % 3600) / 60);
		const seconds = totalSeconds % 60;
		if (hours) return `${hours}h ${minutes}m`;
		if (minutes) return `${minutes}m ${seconds}s`;
		return `${seconds}s`;
	}

	function errorReason(value: string | null) {
		return value ? value.replaceAll('_', ' ') : 'None';
	}

	function historyFailure(row: ConnectionHistorySummary) {
		return failureCopy({
			protocol: row.protocol,
			code: row.errorCode ?? row.errorReason,
			message: row.errorMessage ?? row.errorReason
		});
	}
</script>

<section class="space-y-4 p-4">
	<div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
		<div class="min-w-0">
			<div class="flex items-center gap-2">
				<History class="size-5 text-muted-foreground" />
				<h1 class="text-lg font-semibold">Connection history</h1>
			</div>
			<p class="text-sm text-muted-foreground">
				Audit recorded browser sessions by user, workspace, protocol, host, status, and date.
			</p>
		</div>
		<div class="flex flex-wrap items-center gap-2 text-sm">
			<Badge variant="secondary">{activeCount} active</Badge>
			<Badge variant={failedCount ? 'destructive' : 'outline'}>{failedCount} failed</Badge>
			<Button variant="outline" size="sm" class="gap-2" onclick={() => historyQuery.refresh()}>
				<RotateCcw class="size-4" />
				Refresh
			</Button>
		</div>
	</div>

	<div class="rounded-md border bg-muted/20 p-3">
		<div class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
			<div class="space-y-1.5 md:col-span-2 xl:col-span-2">
				<Label for="history-search">Search</Label>
				<div class="relative">
					<Search class="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
					<Input
						id="history-search"
						class="pl-8"
						placeholder="Search host, user, workspace, status, or error"
						bind:value={search}
					/>
				</div>
			</div>

			<div class="space-y-1.5">
				<Label for="history-user">User</Label>
				<NativeSelect.Root id="history-user" class="w-full" bind:value={userFilter}>
					<NativeSelect.Option value="all">All users</NativeSelect.Option>
					{#each userOptions as [id, label] (id)}
						<NativeSelect.Option value={id}>{label}</NativeSelect.Option>
					{/each}
				</NativeSelect.Root>
			</div>

			<div class="space-y-1.5">
				<Label for="history-workspace">Workspace</Label>
				<NativeSelect.Root id="history-workspace" class="w-full" bind:value={workspaceFilter}>
					<NativeSelect.Option value="all">All workspaces</NativeSelect.Option>
					{#each workspaceOptions as [id, label] (id)}
						<NativeSelect.Option value={id}>{label}</NativeSelect.Option>
					{/each}
				</NativeSelect.Root>
			</div>

			<div class="space-y-1.5">
				<Label for="history-protocol">Protocol</Label>
				<NativeSelect.Root id="history-protocol" class="w-full" bind:value={protocolFilter}>
					{#each protocolOptions as protocol (protocol)}
						<NativeSelect.Option value={protocol}>{protocolLabel(protocol)}</NativeSelect.Option>
					{/each}
				</NativeSelect.Root>
			</div>

			<div class="space-y-1.5">
				<Label for="history-host">Host</Label>
				<NativeSelect.Root id="history-host" class="w-full" bind:value={hostFilter}>
					<NativeSelect.Option value="all">All hosts</NativeSelect.Option>
					{#each hostOptions as [id, label] (id)}
						<NativeSelect.Option value={id}>{label}</NativeSelect.Option>
					{/each}
				</NativeSelect.Root>
			</div>

			<div class="space-y-1.5">
				<Label for="history-status">Status</Label>
				<NativeSelect.Root id="history-status" class="w-full" bind:value={statusFilter}>
					{#each statusOptions as status (status)}
						<NativeSelect.Option value={status}>{statusLabel(status)}</NativeSelect.Option>
					{/each}
				</NativeSelect.Root>
			</div>

			<div class="space-y-1.5">
				<Label for="history-after">Start date</Label>
				<div class="relative">
					<CalendarDays class="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
					<Input id="history-after" type="date" class="pl-8" bind:value={startedAfter} />
				</div>
			</div>

			<div class="space-y-1.5">
				<Label for="history-before">End date</Label>
				<div class="relative">
					<CalendarDays class="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
					<Input id="history-before" type="date" class="pl-8" bind:value={startedBefore} />
				</div>
			</div>
		</div>

		{#if activeFilterCount}
			<div class="mt-3 flex flex-wrap items-center gap-2">
				<span class="text-xs text-muted-foreground">
					{filteredRows.length} of {rows.length} sessions
				</span>
				<Button variant="outline" size="xs" class="gap-1 rounded-full" onclick={clearFilters}>
					<X class="size-3" />
					Clear filters
				</Button>
			</div>
		{/if}
	</div>

	{#if historyQuery.loading}
		<StatePanel state="loading" title="Loading history" detail="Fetching connection records." />
	{:else if rows.length === 0}
		<StatePanel
			state="disconnected"
			title="No connection history"
			detail="Launch a session to create the first history record."
		/>
	{:else}
		<div class="overflow-hidden rounded-md border">
			<div class="overflow-x-auto">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Protocol</Table.Head>
							<Table.Head>Host</Table.Head>
							<Table.Head>User</Table.Head>
							<Table.Head>Workspace</Table.Head>
							<Table.Head>Start</Table.Head>
							<Table.Head>End</Table.Head>
							<Table.Head>Duration</Table.Head>
							<Table.Head>Status</Table.Head>
							<Table.Head>Error reason</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each filteredRows as row (row.id)}
							<Table.Row>
								<Table.Cell>
									<Badge variant="outline">{row.protocol.toUpperCase()}</Badge>
								</Table.Cell>
								<Table.Cell>
									<div class="min-w-48">
										<div class="font-medium">{row.host}</div>
										<div class="font-mono text-xs text-muted-foreground">
											{row.hostUser ? `${row.hostUser}@` : ''}{row.hostname}
										</div>
									</div>
								</Table.Cell>
								<Table.Cell>{row.user}</Table.Cell>
								<Table.Cell>{row.workspace}</Table.Cell>
								<Table.Cell class="text-sm whitespace-nowrap"
									>{formatDate(row.startedAt)}</Table.Cell
								>
								<Table.Cell class="text-sm whitespace-nowrap">{formatDate(row.endedAt)}</Table.Cell>
								<Table.Cell class="text-sm whitespace-nowrap">
									{formatDuration(row.durationMs)}
								</Table.Cell>
								<Table.Cell>
									<Badge variant={statusVariant(row.status)}>{statusLabel(row.status)}</Badge>
								</Table.Cell>
								<Table.Cell>
									<div class="flex min-w-40 items-center gap-2 text-sm">
										{#if row.errorReason}
											<AlertCircle class="size-4 shrink-0 text-destructive" />
										{/if}
										<span class={row.errorReason ? 'text-destructive' : 'text-muted-foreground'}>
											{#if row.errorReason}
												{@const failure = historyFailure(row)}
												<span class="block font-medium">{failure.title}</span>
												<span class="block text-xs text-muted-foreground">
													{failure.diagnostic ?? humanizeCode(row.errorReason)}
												</span>
											{:else}
												{errorReason(row.errorReason)}
											{/if}
										</span>
									</div>
								</Table.Cell>
							</Table.Row>
						{:else}
							<Table.Row>
								<Table.Cell colspan={9} class="h-24 text-center text-muted-foreground">
									No sessions match the active filters.
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>
		</div>
	{/if}
</section>
