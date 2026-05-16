<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import type { Component } from 'svelte';

	let {
		icon: Icon,
		label,
		value,
		detail
	}: {
		icon: Component;
		label: string;
		value: number;
		detail: string;
	} = $props();
</script>

<Card.Root>
	<Card.Content class="flex items-center justify-between gap-3 p-4">
		<div class="min-w-0">
			<p class="text-sm text-muted-foreground">{label}</p>
			<p class="text-2xl font-semibold tabular-nums">{value}</p>
			<p class="text-xs text-muted-foreground">{detail}</p>
		</div>
		<span
			class="grid size-10 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground"
		>
			<Icon class="size-5" />
		</span>
	</Card.Content>
</Card.Root>
