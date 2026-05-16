<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Activity, ClipboardCheck, FileClock, Server, Workflow } from '@lucide/svelte';
	import { explainFleetTargetHealth, type FleetOverview } from './fleet-data';

	let {
		overview,
		dataSourceLabel = 'remote functions'
	}: {
		overview: FleetOverview;
		dataSourceLabel?: string;
	} = $props();

	const healthCounts = $derived({
		healthy: overview.hosts.filter((host) => explainFleetTargetHealth(host).status === 'healthy')
			.length,
		attention: overview.hosts.filter(
			(host) => explainFleetTargetHealth(host).status === 'needs_attention'
		).length,
		offline: overview.hosts.filter((host) => explainFleetTargetHealth(host).status === 'offline')
			.length,
		notChecked: overview.hosts.filter(
			(host) => explainFleetTargetHealth(host).status === 'not_checked'
		).length
	});
	const activeExecutions = $derived(
		overview.jobs.filter((job) => job.status === 'queued' || job.status === 'running').length
	);
</script>

<svelte:head>
	<title>Fleet Overview · TermixKit</title>
</svelte:head>

<section class="space-y-5 p-4">
	<div class="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
		<div class="space-y-1">
			<div class="flex flex-wrap items-center gap-2">
				<h1 class="text-lg font-semibold">Fleet overview</h1>
				<Badge variant="outline">{dataSourceLabel}</Badge>
			</div>
			<p class="max-w-3xl text-sm text-muted-foreground">
				Run an action across selected hosts and track the resulting executions.
			</p>
		</div>
		<div class="flex flex-wrap gap-2">
			<Button href="/fleet/executions/new" size="sm">
				<ClipboardCheck class="size-4" />
				New execution
			</Button>
			<Button href="/fleet/targets" size="sm" variant="outline">
				<Server class="size-4" />
				Targets
			</Button>
		</div>
	</div>

	<div class="grid gap-3 md:grid-cols-3">
		<Card.Root size="sm">
			<Card.Content class="p-4">
				<div class="flex items-center gap-2 text-xs text-muted-foreground">
					<Server class="size-3.5" />
					Targets
				</div>
				<div class="mt-2 text-2xl font-semibold">{overview.hosts.length}</div>
				<div class="mt-1 text-xs text-muted-foreground">
					{healthCounts.healthy} healthy · {healthCounts.offline} offline
				</div>
			</Card.Content>
		</Card.Root>
		<Card.Root size="sm">
			<Card.Content class="p-4">
				<div class="flex items-center gap-2 text-xs text-muted-foreground">
					<Workflow class="size-3.5" />
					Runbooks
				</div>
				<div class="mt-2 text-2xl font-semibold">{overview.templates.length}</div>
				<div class="mt-1 text-xs text-muted-foreground">Reusable actions</div>
			</Card.Content>
		</Card.Root>
		<Card.Root size="sm">
			<Card.Content class="p-4">
				<div class="flex items-center gap-2 text-xs text-muted-foreground">
					<FileClock class="size-3.5" />
					Active executions
				</div>
				<div class="mt-2 text-2xl font-semibold">{activeExecutions}</div>
				<div class="mt-1 text-xs text-muted-foreground">{overview.jobs.length} total records</div>
			</Card.Content>
		</Card.Root>
	</div>

	<div class="grid gap-4 xl:grid-cols-[1fr_360px]">
		<Card.Root size="sm">
			<Card.Header>
				<Card.Title class="flex items-center gap-2 text-base">
					<Activity class="size-4" />
					Target health context
				</Card.Title>
				<Card.Description>
					Health stays visible as context. It does not block a fleet operation.
				</Card.Description>
			</Card.Header>
			<Card.Content class="grid gap-2 sm:grid-cols-4">
				<div class="rounded-md border p-3">
					<div class="text-lg font-semibold">{healthCounts.healthy}</div>
					<div class="text-xs text-muted-foreground">Healthy</div>
				</div>
				<div class="rounded-md border p-3">
					<div class="text-lg font-semibold">{healthCounts.attention}</div>
					<div class="text-xs text-muted-foreground">Needs attention</div>
				</div>
				<div class="rounded-md border p-3">
					<div class="text-lg font-semibold">{healthCounts.offline}</div>
					<div class="text-xs text-muted-foreground">Offline</div>
				</div>
				<div class="rounded-md border p-3">
					<div class="text-lg font-semibold">{healthCounts.notChecked}</div>
					<div class="text-xs text-muted-foreground">Not checked</div>
				</div>
			</Card.Content>
		</Card.Root>
		<Card.Root size="sm">
			<Card.Header>
				<Card.Title class="text-base">Operator flow</Card.Title>
				<Card.Description>No hidden runbook, operation, or target defaults.</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-2 text-sm">
				<div class="rounded-md border p-3">1. Choose one action</div>
				<div class="rounded-md border p-3">2. Select hosts</div>
				<div class="rounded-md border p-3">3. Run after checking the host count</div>
			</Card.Content>
		</Card.Root>
	</div>
</section>
