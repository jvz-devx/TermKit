<script lang="ts">
	import { Progress } from '$lib/components/ui/progress';
	import {
		formatDuration,
		formatSize,
		formatThroughput,
		transferPercent,
		type TransferProgress
	} from '../state/file-manager-state';

	let { transfer }: { transfer: TransferProgress } = $props();

	const percent = $derived(transferPercent(transfer));
</script>

<div class="rounded-md border bg-background p-2">
	<div class="mb-1 flex items-center justify-between gap-3 text-xs">
		<div class="min-w-0 truncate">
			<span class="font-medium">{transfer.label}</span>
			{#if transfer.currentName}
				<span class="text-muted-foreground"> · {transfer.currentName}</span>
			{/if}
		</div>
		<div class="shrink-0 font-mono text-muted-foreground">
			{percent}% · {formatThroughput(transfer.throughputBytesPerSecond)} · {formatDuration(
				transfer.remainingMs
			)}
		</div>
	</div>
	<Progress value={percent} />
	<div class="mt-1 flex justify-between text-[11px] text-muted-foreground">
		<span>{transfer.completedItems}/{transfer.totalItems || transfer.completedItems} items</span>
		<span>{formatSize(transfer.completedBytes)}/{formatSize(transfer.totalBytes)}</span>
	</div>
</div>
