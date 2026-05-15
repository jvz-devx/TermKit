<script lang="ts">
	import { decideFleetApproval, getFleetApprovals } from '$lib/fleet.remote';
	import type { FleetPolicy } from './fleet-data';
	import PolicyApprovalsPanel from './PolicyApprovalsPanel.svelte';

	let { approvals }: { approvals: FleetPolicy[] } = $props();

	async function decideApproval(approvalId: string, status: 'approved' | 'rejected') {
		await decideFleetApproval({ approvalId, status }).updates(getFleetApprovals);
	}
</script>

<svelte:head>
	<title>Fleet Approvals · TermixKit</title>
</svelte:head>

<section class="space-y-4 p-4">
	<div>
		<h1 class="text-lg font-semibold">Approvals</h1>
		<p class="text-sm text-muted-foreground">
			Approve or reject requests that policy requires before execution can continue.
		</p>
	</div>
	<PolicyApprovalsPanel policies={approvals} onDecideApproval={decideApproval} />
</section>
