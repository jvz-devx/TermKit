<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Check, ShieldCheck, X } from '@lucide/svelte';
	import type { FleetApprovalStatus, FleetPolicy } from './fleet-data';

	let {
		policies,
		onDecideApproval
	}: {
		policies: FleetPolicy[];
		onDecideApproval: (approvalId: string, status: 'approved' | 'rejected') => Promise<void>;
	} = $props();

	let busyApprovalId = $state<string | null>(null);
	let error = $state<string | null>(null);

	function variant(status: FleetApprovalStatus) {
		if (status === 'approved') return 'secondary';
		if (status === 'rejected') return 'destructive';
		return 'outline';
	}

	async function decide(approvalId: string, status: 'approved' | 'rejected') {
		busyApprovalId = approvalId;
		error = null;
		try {
			await onDecideApproval(approvalId, status);
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Could not update approval';
		} finally {
			busyApprovalId = null;
		}
	}
</script>

<Card.Root size="sm">
	<Card.Header>
		<Card.Title class="flex items-center gap-2 text-base">
			<ShieldCheck class="size-4" />
			Approvals
		</Card.Title>
		<Card.Description>Requests that need a decision before execution can continue.</Card.Description>
	</Card.Header>
	<Card.Content class="space-y-3">
		{#if error}
			<p
				class="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
			>
				{error}
			</p>
		{/if}
		{#each policies as policy (policy.id)}
			<div class="rounded-md border p-3">
				<div class="flex flex-wrap items-start justify-between gap-2">
					<div class="min-w-0">
						<div class="font-medium">{policy.name}</div>
						<div class="text-xs text-muted-foreground">{policy.scope}</div>
					</div>
					<Badge variant={variant(policy.status)}>{policy.status}</Badge>
				</div>
				<p class="mt-2 text-xs text-muted-foreground">{policy.impact}</p>
				<div class="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
					<span>Requested by {policy.requestedBy}</span>
					<span>Approver {policy.approver}</span>
					<span>{policy.dueAt}</span>
				</div>
				{#if policy.status === 'pending'}
					<div class="mt-3 flex gap-2">
						<Button
							size="xs"
							variant="outline"
							disabled={busyApprovalId === policy.id}
							onclick={() => decide(policy.id, 'approved')}
						>
							<Check class="size-3.5" />
							Approve
						</Button>
						<Button
							size="xs"
							variant="ghost"
							disabled={busyApprovalId === policy.id}
							onclick={() => decide(policy.id, 'rejected')}
						>
							<X class="size-3.5" />
							Reject
						</Button>
					</div>
				{/if}
			</div>
		{:else}
			<div class="rounded-md border p-6 text-center text-sm text-muted-foreground">
				No approval requests are pending.
			</div>
		{/each}
	</Card.Content>
</Card.Root>
