<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Separator } from '$lib/components/ui/separator';
	import { AlertTriangle, CheckCircle2, ClipboardCheck, Play, ShieldAlert } from '@lucide/svelte';
	import type {
		FleetAutomationTemplate,
		FleetBulkOperation,
		FleetExecutionPreflight,
		FleetExecutionSubmitResult,
		FleetHost,
		FleetTargetReview
	} from './fleet-data';
	import { fleetRiskLabel } from './fleet-data';

	let {
		runbooks,
		selectedRunbookId,
		operations,
		selectedOperationId,
		targets,
		review,
		preflight = null,
		onSelectRunbook,
		onSelectOperation,
		onPreflight,
		onQueueOperation
	}: {
		runbooks: FleetAutomationTemplate[];
		selectedRunbookId: string;
		operations: FleetBulkOperation[];
		selectedOperationId: string;
		targets: FleetHost[];
		review: FleetTargetReview;
		preflight?: FleetExecutionPreflight | null;
		onSelectRunbook: (runbookId: string) => void;
		onSelectOperation: (operationId: string) => void;
		onPreflight: (input: {
			operationId: string;
			templateId: string;
			targetHostIds: string[];
			reason: string;
			concurrencyLimit: number;
		}) => Promise<void>;
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
	let reason = $state('Reviewed target set from fleet operations');
	let concurrencyLimit = $state(2);
	let busy = $state(false);
	let reviewing = $state(false);
	let error = $state<string | null>(null);
	let message = $state<string | null>(null);

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

	async function reviewExecution() {
		const input = payload();
		if (!input) return;
		reviewing = true;
		error = null;
		message = null;
		try {
			await onPreflight(input);
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Could not review execution';
		} finally {
			reviewing = false;
		}
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
		<Card.Description>Choose the runbook, operation, and exact targets before anything runs.</Card.Description>
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
						{runbook.category} · {runbook.approvalRequired ? 'Approval required' : 'Operator runnable'}
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
						<span>{operation.approvalRequired ? 'Approval required' : 'Operator runnable'}</span>
					</div>
				</button>
			{/each}
		</div>

		<div class="rounded-md border bg-muted/20 p-3">
			<div class="flex items-center justify-between gap-2">
				<div>
					<div class="text-sm font-medium">3. Review</div>
					<div class="text-xs text-muted-foreground">
						{selectedRunbook?.name ?? 'No runbook'} · {selectedOperation?.name ?? 'No operation'}
					</div>
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
				{#each review.warnings as warning (warning)}
					<div class="flex gap-2 text-xs text-amber-700">
						<AlertTriangle class="mt-0.5 size-3.5" />
						<span>{warning}</span>
					</div>
				{/each}
				{#if preflight}
					<div class="rounded-md border bg-background p-2 text-xs">
						<div class="font-medium">{preflight.ctaLabel}</div>
						<div class="mt-1 text-muted-foreground">
							Server policy checked {preflight.targetCount} target(s).
						</div>
					</div>
				{/if}
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
		<Button size="sm" variant="outline" disabled={!review.canRun || reviewing} onclick={reviewExecution}>
			<ClipboardCheck class="size-4" />
			{reviewing ? 'Reviewing...' : 'Review policy'}
		</Button>
		<Button size="sm" disabled={!review.canRun || busy} onclick={queueOperation}>
			<Play class="size-4" />
			{busy ? 'Submitting...' : preflight?.ctaLabel ?? review.ctaLabel}
		</Button>
	</Card.Footer>
</Card.Root>
