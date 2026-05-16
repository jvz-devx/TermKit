<script lang="ts">
	import { MonitorX, MousePointer2, Volume2 } from '@lucide/svelte';

	let {
		rdpFocused,
		focusDetail,
		multiMonitorLabel,
		audioStatusLabel
	}: {
		rdpFocused: boolean;
		focusDetail: string;
		multiMonitorLabel: string;
		audioStatusLabel: string;
	} = $props();
</script>

<div class="border-t bg-background px-3 py-2">
	<div class="grid gap-2 text-xs text-muted-foreground lg:grid-cols-[1.2fr_1fr_1fr]">
		<div class="flex min-w-0 items-center gap-2">
			<MousePointer2 class="size-4 shrink-0" />
			<span class="truncate">
				{rdpFocused ? focusDetail : 'RDP canvas is not focused. Click it before typing.'}
			</span>
		</div>
		<div class="flex min-w-0 items-center gap-2">
			<MonitorX class="size-4 shrink-0" />
			<span class="truncate">{multiMonitorLabel}; extra monitor routing is not exposed.</span>
		</div>
		<div class="flex min-w-0 items-center gap-2">
			<Volume2 class="size-4 shrink-0" />
			<span class="truncate">{audioStatusLabel}</span>
		</div>
	</div>
</div>
