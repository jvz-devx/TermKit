<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Separator } from '$lib/components/ui/separator';
	import { AlertTriangle, CheckCircle2, ClipboardCheck, Play, ShieldAlert } from '@lucide/svelte';
	import type { FleetBulkOperation, FleetHost, FleetTargetReview } from './fleet-data';
	import { fleetRiskLabel } from './fleet-data';

	let {
		operations,
		selectedOperationId,
		targets,
		review,
		onSelectOperation,
		onQueueOperation
	}: {
		operations: FleetBulkOperation[];
		selectedOperationId: string;
		targets: FleetHost[];
		review: FleetTargetReview;
		onSelectOperation: (operationId: string) => void;
		onQueueOperation: (input: {
			operationId: string;
			targetHostIds: string[];
			reason: string;
			concurrencyLimit: number;
		}) => Promise<void>;
	} = $props();

	const selectedOperation = $derived(
		operations.find((operation) => operation.id === selectedOperationId) ?? operations[0]
	);
	let reason = $state('Reviewed target set from fleet operations');
	let concurrencyLimit = $state(2);
	let busy = $state(false);
	let error = $state<string | null>(null);

	async function queueOperation() {
		if (!selectedOperation) return;
		busy = true;
		error = null;
		try {
			await onQueueOperation({
				operationId: selectedOperation.id,
				targetHostIds: targets.map((target) => target.id),
				reason,
				concurrencyLimit
			});
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Could not queue operation';
		} finally {
			busy = false;
		}
	}
</script>

<Card.Root size="sm">
	<Card.Header>
		<Card.Title class="flex items-center gap-2 text-base">
			<ClipboardCheck class="size-4" />
			Bulk operations
		</Card.Title>
		<Card.Description>Choose the operation, then review the exact target set.</Card.Description>
	</Card.Header>
	<Card.Content class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
		<div class="space-y-3">
			{#each operations as operation (operation.id)}
				<button
					type="button"
					class="w-full rounded-md border p-3 text-left transition-colors hover:bg-accent/50 data-[active=true]:border-primary data-[active=true]:bg-primary/5"
					data-active={operation.id === selectedOperationId}
					onclick={() => onSelectOperation(operation.id)}
				>
					<div class="flex flex-wrap items-start justify-between gap-2">
						<div>
							<div class="font-medium">{operation.name}</div>
							<div class="mt-1 text-xs text-muted-foreground">{operation.description}</div>
						</div>
						<Badge variant={operation.risk === 'high' ? 'destructive' : 'outline'}>
							{fleetRiskLabel(operation.risk)}
						</Badge>
					</div>
					<div class="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
						<span>{operation.category}</span>
						<span>{operation.estimatedDuration}</span>
						<span>{operation.approvalRequired ? 'Approval required' : 'Operator runnable'}</span>
					</div>
				</button>
			{/each}
		</div>

		<div class="rounded-md border bg-muted/20 p-3">
			<div class="flex items-center justify-between gap-2">
				<div>
					<div class="text-sm font-medium">Target review</div>
					<div class="text-xs text-muted-foreground">{selectedOperation?.name}</div>
				</div>
				<Badge variant={review.canRun ? 'outline' : 'destructive'}>
					{review.canRun ? 'Ready' : 'Blocked'}
				</Badge>
			</div>
			<div class="mt-4 grid grid-cols-3 gap-2 text-center">
				<div class="rounded-md border bg-background p-2">
					<div class="text-lg font-semibold">{review.targetCount}</div>
					<div class="text-[11px] text-muted-foreground">Targets</div>
				</div>
				<div class="rounded-md border bg-background p-2">
					<div class="text-lg font-semibold">{review.highRiskTargets}</div>
					<div class="text-[11px] text-muted-foreground">High risk</div>
				</div>
				<div class="rounded-md border bg-background p-2">
					<div class="text-lg font-semibold">{review.offlineTargets}</div>
					<div class="text-[11px] text-muted-foreground">Offline</div>
				</div>
			</div>

			<Separator class="my-4" />

			<div class="space-y-2">
				<div class="flex items-center gap-2 text-sm">
					{#if review.approvalRequired}
						<ShieldAlert class="size-4 text-amber-600" />
						Approval required before execution
					{:else}
						<CheckCircle2 class="size-4 text-emerald-600" />
						No approval required
					{/if}
				</div>
				{#each selectedOperation?.guardrails ?? [] as guardrail (guardrail)}
					<div class="flex gap-2 text-xs text-muted-foreground">
						<CheckCircle2 class="mt-0.5 size-3.5 text-emerald-600" />
						<span>{guardrail}</span>
					</div>
				{/each}
				{#each review.blockers as blocker (blocker)}
					<div class="flex gap-2 text-xs text-destructive">
						<AlertTriangle class="mt-0.5 size-3.5" />
						<span>{blocker}</span>
					</div>
				{/each}
			</div>

			<div class="mt-4 max-h-32 space-y-1 overflow-auto rounded-md border bg-background p-2">
				{#each targets as target (target.id)}
					<div class="flex items-center justify-between gap-2 text-xs">
						<span class="truncate">{target.name}</span>
						<span class="text-muted-foreground">{target.workspace}</span>
					</div>
				{:else}
					<div class="py-4 text-center text-xs text-muted-foreground">No targets selected.</div>
				{/each}
			</div>
			<div class="mt-3 grid gap-2">
				<Label class="text-xs" for="fleet-bulk-reason">Reason</Label>
				<Input id="fleet-bulk-reason" class="h-8 text-xs" bind:value={reason} />
				<Label class="text-xs" for="fleet-bulk-concurrency">Concurrency</Label>
				<Input
					id="fleet-bulk-concurrency"
					class="h-8 text-xs"
					type="number"
					min="1"
					max="10"
					bind:value={concurrencyLimit}
				/>
				{#if error}
					<p class="text-xs text-destructive">{error}</p>
				{/if}
			</div>
		</div>
	</Card.Content>
	<Card.Footer class="justify-end border-t pt-4">
		<Button size="sm" disabled={!review.canRun || busy} onclick={queueOperation}>
			<Play class="size-4" />
			{busy ? 'Queueing...' : 'Queue operation'}
		</Button>
	</Card.Footer>
</Card.Root>
