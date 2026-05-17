<script lang="ts">
	import { Cable, Clock3, Server, SquareTerminal } from '@lucide/svelte';
	import * as Card from '$lib/components/ui/card';
	import type { AdminOverview } from '$lib/remotes/admin.remote';
	import type { Component } from 'svelte';

	let { overview }: { overview: AdminOverview } = $props();
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>Application settings</Card.Title>
		<Card.Description>Current session defaults</Card.Description>
	</Card.Header>
	<Card.Content class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
		{@render SettingTile({
			icon: Clock3,
			label: 'Ticket TTL',
			value: `${overview.settings.ticketTtlSeconds}s`
		})}
		{@render SettingTile({
			icon: SquareTerminal,
			label: 'Terminal font',
			value: `${overview.settings.terminalFontSize}px`
		})}
		{@render SettingTile({
			icon: Cable,
			label: 'Clipboard sync',
			value: overview.settings.clipboardSync ? 'Enabled' : 'Disabled'
		})}
		{@render SettingTile({
			icon: Server,
			label: 'Last tab',
			value: overview.settings.rememberLastActiveTab ? 'Remembered' : 'Default'
		})}
	</Card.Content>
</Card.Root>

{#snippet SettingTile({
	icon: Icon,
	label,
	value
}: {
	icon: Component;
	label: string;
	value: string;
})}
	<div class="rounded-md border p-3">
		<div class="flex items-center gap-2 text-sm text-muted-foreground">
			<Icon class="size-4" />
			{label}
		</div>
		<div class="mt-2 text-lg font-semibold">{value}</div>
	</div>
{/snippet}
