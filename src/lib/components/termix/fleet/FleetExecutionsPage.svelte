<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import { CheckCircle2 } from '@lucide/svelte';
	import type { FleetJob } from './fleet-data';
	import JobHistoryReporting from './JobHistoryReporting.svelte';

	let { executions }: { executions: FleetJob[] } = $props();
</script>

<svelte:head>
	<title>Fleet Executions · TermKit</title>
</svelte:head>

<section class="space-y-4 p-4">
	<div>
		<h1 class="text-lg font-semibold">Executions</h1>
		<p class="text-sm text-muted-foreground">
			Queued, running, blocked, and completed fleet work with details links.
		</p>
	</div>
	<div class="grid gap-4 xl:grid-cols-[1fr_320px]">
		<JobHistoryReporting jobs={executions} />
		<Card.Root size="sm">
			<Card.Header>
				<Card.Title class="flex items-center gap-2 text-base">
					<CheckCircle2 class="size-4" />
					Execution rollup
				</Card.Title>
				<Card.Description>Latest operator activity.</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-3 text-sm">
				<div class="flex justify-between">
					<span class="text-muted-foreground">Completed</span>
					<span>{executions.filter((job) => job.status === 'completed').length}</span>
				</div>
				<div class="flex justify-between">
					<span class="text-muted-foreground">Active</span>
					<span
						>{executions.filter((job) => job.status === 'queued' || job.status === 'running')
							.length}</span
					>
				</div>
				<div class="flex justify-between">
					<span class="text-muted-foreground">Failed targets</span>
					<span>{executions.reduce((total, job) => total + job.failed, 0)}</span>
				</div>
			</Card.Content>
		</Card.Root>
	</div>
</section>
