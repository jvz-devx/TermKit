<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import * as Card from '$lib/components/ui/card';
	import type { FleetJob } from './fleet-data';

	let { execution }: { execution: FleetJob | null } = $props();
</script>

<svelte:head>
	<title>{execution?.name ?? 'Execution'} · TermixKit</title>
</svelte:head>

<section class="space-y-4 p-4">
	{#if execution}
		<div>
			<h1 class="text-lg font-semibold">{execution.name}</h1>
			<p class="text-sm text-muted-foreground">Execution details and evidence summary.</p>
		</div>
		<Card.Root size="sm">
			<Card.Header>
				<Card.Title class="flex items-center justify-between gap-2 text-base">
					<span>{execution.id}</span>
					<Badge variant={execution.status === 'failed' || execution.status === 'blocked' ? 'destructive' : 'outline'}>
						{execution.status}
					</Badge>
				</Card.Title>
				<Card.Description>{execution.startedAt} · {execution.duration}</Card.Description>
			</Card.Header>
			<Card.Content class="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
				<div class="rounded-md border p-3">
					<div class="text-xs text-muted-foreground">Targets</div>
					<div class="mt-1 text-xl font-semibold">{execution.targets}</div>
				</div>
				<div class="rounded-md border p-3">
					<div class="text-xs text-muted-foreground">Successful</div>
					<div class="mt-1 text-xl font-semibold">{execution.successful}</div>
				</div>
				<div class="rounded-md border p-3">
					<div class="text-xs text-muted-foreground">Failed</div>
					<div class="mt-1 text-xl font-semibold">{execution.failed}</div>
				</div>
				<div class="rounded-md border p-3">
					<div class="text-xs text-muted-foreground">Requested by</div>
					<div class="mt-1 font-medium">{execution.requestedBy}</div>
				</div>
			</Card.Content>
		</Card.Root>
	{:else}
		<Card.Root size="sm">
			<Card.Content class="p-6 text-sm text-muted-foreground">
				Execution not found.
			</Card.Content>
		</Card.Root>
	{/if}
</section>
