<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Progress } from '$lib/components/ui/progress';
	import * as Table from '$lib/components/ui/table';
	import { BarChart3, FileText } from '@lucide/svelte';
	import type { FleetJob, FleetJobStatus } from './fleet-data';
	import { formatFleetTimestamp } from './fleet-display';

	let { jobs }: { jobs: FleetJob[] } = $props();

	function statusVariant(status: FleetJobStatus) {
		if (status === 'failed' || status === 'blocked') return 'destructive';
		if (status === 'completed') return 'secondary';
		return 'outline';
	}

	function successRate(job: FleetJob) {
		if (!job.targets) return 0;
		return Math.round((job.successful / job.targets) * 100);
	}
</script>

<Card.Root size="sm">
	<Card.Header>
		<Card.Title class="flex items-center gap-2 text-base">
			<BarChart3 class="size-4" />
			Executions
		</Card.Title>
		<Card.Description>Queued, running, and completed fleet executions.</Card.Description>
	</Card.Header>
	<Card.Content>
		<div class="overflow-hidden rounded-md border">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Job</Table.Head>
						<Table.Head>Status</Table.Head>
						<Table.Head>Targets</Table.Head>
						<Table.Head>Success</Table.Head>
						<Table.Head>Requested</Table.Head>
						<Table.Head class="w-20 text-right">Details</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each jobs as job (job.id)}
						<Table.Row>
							<Table.Cell>
								<div class="font-medium">{job.name}</div>
								<div class="text-xs text-muted-foreground">
									{formatFleetTimestamp(job.startedAt)} · {job.duration}
								</div>
							</Table.Cell>
							<Table.Cell>
								<Badge variant={statusVariant(job.status)}>{job.status}</Badge>
							</Table.Cell>
							<Table.Cell>{job.targets}</Table.Cell>
							<Table.Cell class="min-w-32">
								<div class="mb-1 flex justify-between text-xs text-muted-foreground">
									<span>{job.successful} ok</span>
									<span>{job.failed} failed</span>
								</div>
								<Progress value={successRate(job)} />
							</Table.Cell>
							<Table.Cell class="text-sm text-muted-foreground">{job.requestedBy}</Table.Cell>
							<Table.Cell>
								<div class="flex justify-end">
									<Button
										href={job.reportUrl}
										size="icon"
										variant="ghost"
										aria-label={`Open execution details for ${job.name}`}
									>
										<FileText class="size-4" />
									</Button>
								</div>
							</Table.Cell>
						</Table.Row>
					{:else}
						<Table.Row>
							<Table.Cell colspan={6} class="h-24 text-center text-muted-foreground">
								No fleet executions yet.
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</div>
	</Card.Content>
</Card.Root>
