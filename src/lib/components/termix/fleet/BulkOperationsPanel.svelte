<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Separator } from '$lib/components/ui/separator';
	import { AlertTriangle, ClipboardCheck, Play } from '@lucide/svelte';
	import type {
		FleetAutomationTemplate,
		FleetBulkOperation,
		FleetExecutionSubmitResult,
		FleetExecutionSummary,
		FleetHost
	} from './fleet-data';
	import { fleetRiskLabel } from './fleet-data';

	let {
		runbooks,
		selectedRunbookId,
		operations,
		selectedOperationId,
		targets,
		summary,
		onSelectRunbook,
		onSelectOperation,
		onQueueOperation
	}: {
		runbooks: FleetAutomationTemplate[];
		selectedRunbookId: string;
		operations: FleetBulkOperation[];
		selectedOperationId: string;
		targets: FleetHost[];
		summary: FleetExecutionSummary;
		onSelectRunbook: (runbookId: string) => void;
		onSelectOperation: (operationId: string) => void;
		onQueueOperation: (input: {
			operationId: string;
			templateId: string;
			targetHostIds: string[];
			reason: string;
			concurrencyLimit: number;
		}) => Promise<FleetExecutionSubmitResult>;
	} = $props();

	const selectedRunbook = $derived(
		runbooks.find((runbook) => runbook.id === selectedRunbookId) ?? null
	);
	const selectedOperation = $derived(
		operations.find((operation) => operation.id === selectedOperationId) ?? null
	);
	let reason = $state('Fleet operation');
	let concurrencyLimit = $state(2);
	let busy = $state(false);
	let error = $state<string | null>(null);
	let message = $state<string | null>(null);
	const canRunOperation = $derived(
		Boolean(selectedOperation && selectedRunbook && targets.length > 0)
	);

	function payload() {
		if (!selectedOperation || !selectedRunbook) return null;
		return {
			operationId: selectedOperation.id,
			templateId: selectedRunbook.id,
			targetHostIds: targets.map((target) => target.id),
			reason,
			concurrencyLimit
		};
	}

	async function queueOperation() {
		const input = payload();
		if (!input) return;
		busy = true;
		error = null;
		message = null;
		try {
			const result = await onQueueOperation(input);
			message = result.message;
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Could not submit execution';
		} finally {
			busy = false;
		}
	}
</script>

<Card.Root size="sm">
	<Card.Header>
		<Card.Title class="flex items-center gap-2 text-base">
			<ClipboardCheck class="size-4" />
			New execution
		</Card.Title>
		<Card.Description>Pick what to run, pick hosts, then run the operation.</Card.Description>
	</Card.Header>
	<Card.Content class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_340px]">
		<div class="space-y-3">
			<div class="text-sm font-medium">1. Runbook</div>
			{#each runbooks as runbook (runbook.id)}
				<button
					type="button"
					class="w-full rounded-md border p-3 text-left transition-colors hover:bg-accent/50 data-[active=true]:border-primary data-[active=true]:bg-primary/5"
					data-active={runbook.id === selectedRunbookId}
					onclick={() => onSelectRunbook(runbook.id)}
				>
					<div class="flex flex-wrap items-start justify-between gap-2">
						<div>
							<div class="font-medium">{runbook.name}</div>
							<div class="mt-1 text-xs text-muted-foreground">{runbook.description}</div>
						</div>
						<Badge variant={runbook.risk === 'high' ? 'destructive' : 'outline'}>
							{fleetRiskLabel(runbook.risk)}
						</Badge>
					</div>
					<div class="mt-3 text-xs text-muted-foreground">
						{runbook.category} · Operator runnable
					</div>
				</button>
			{/each}
		</div>

		<div class="space-y-3">
			<div class="text-sm font-medium">2. Operation</div>
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
						<span>Operator runnable</span>
					</div>
				</button>
			{/each}
		</div>

		<div class="rounded-md border bg-muted/20 p-3">
			<div class="flex items-center justify-between gap-2">
				<div>
					<div class="text-sm font-medium">3. Run</div>
					<div class="text-xs text-muted-foreground">
						{selectedRunbook?.name ?? 'No runbook'} · {selectedOperation?.name ?? 'No operation'}
					</div>
				</div>
				<Badge variant={summary.canRun ? 'outline' : 'destructive'}>
					{summary.canRun ? 'Ready' : 'Missing input'}
				</Badge>
			</div>
			<div class="mt-4 rounded-md border bg-background p-3">
				<div class="text-2xl font-semibold">{summary.targetCount}</div>
				<div class="mt-1 text-sm text-muted-foreground">{summary.warning}</div>
			</div>

			<Separator class="my-4" />

			<div class="space-y-2">
				{#each summary.missingInputs as missingInput (missingInput)}
					<div class="flex gap-2 text-xs text-destructive">
						<AlertTriangle class="mt-0.5 size-3.5" />
						<span>{missingInput}</span>
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
				{#if message}
					<p class="text-xs text-emerald-700">{message}</p>
				{/if}
			</div>
		</div>
	</Card.Content>
	<Card.Footer class="justify-end gap-2 border-t pt-4">
		<Button
			size="sm"
			disabled={!canRunOperation || !summary.canRun || busy}
			onclick={queueOperation}
		>
			<Play class="size-4" />
			{busy ? 'Running...' : summary.ctaLabel}
		</Button>
	</Card.Footer>
</Card.Root>
