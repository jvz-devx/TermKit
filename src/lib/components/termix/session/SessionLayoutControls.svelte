<script lang="ts">
	import Columns2 from '@lucide/svelte/icons/columns-2';
	import Grid2X2 from '@lucide/svelte/icons/grid-2x2';
	import PanelTop from '@lucide/svelte/icons/panel-top';
	import Rows2 from '@lucide/svelte/icons/rows-2';
	import { Button } from '$lib/components/ui/button';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import type { SessionLayoutKind } from './workspace-layout';

	const options: {
		value: SessionLayoutKind;
		label: string;
		icon: typeof PanelTop;
	}[] = [
		{ value: 'single', label: 'Single pane', icon: PanelTop },
		{ value: 'two-columns', label: 'Two columns', icon: Columns2 },
		{ value: 'two-rows', label: 'Two rows', icon: Rows2 },
		{ value: 'three', label: 'Three panes', icon: Grid2X2 },
		{ value: 'quad', label: '2x2 grid', icon: Grid2X2 }
	];

	let {
		layout,
		onChange
	}: {
		layout: SessionLayoutKind;
		onChange: (layout: SessionLayoutKind) => void;
	} = $props();
</script>

<div class="flex items-center rounded-md border bg-background p-0.5" aria-label="Session layout">
	{#each options as option (option.value)}
		<Tooltip.Root>
			<Tooltip.Trigger>
				<Button
					size="icon"
					variant={layout === option.value ? 'secondary' : 'ghost'}
					class="size-8"
					aria-label={option.label}
					aria-pressed={layout === option.value}
					onclick={() => onChange(option.value)}
				>
					<option.icon class="size-4" />
				</Button>
			</Tooltip.Trigger>
			<Tooltip.Content sideOffset={6}>{option.label}</Tooltip.Content>
		</Tooltip.Root>
	{/each}
</div>
