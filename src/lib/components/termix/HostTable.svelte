<script lang="ts">
	import { MoreHorizontal, Play, Search, SlidersHorizontal } from '@lucide/svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Table from '$lib/components/ui/table';
	import HostDialog from './HostDialog.svelte';
	import { hosts } from './sample-data';
</script>

<section class="space-y-3 p-4">
	<div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
		<div>
			<h1 class="text-lg font-semibold">Hosts</h1>
			<p class="text-sm text-muted-foreground">
				Searchable connection inventory for protocol launches.
			</p>
		</div>
		<HostDialog />
	</div>

	<div class="flex gap-2">
		<div class="relative min-w-0 flex-1">
			<Search class="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
			<Input class="pl-8" placeholder="Search name, address, folder, or tag" />
		</div>
		<Button variant="outline" size="icon" aria-label="Filter hosts">
			<SlidersHorizontal class="size-4" />
		</Button>
	</div>

	<div class="overflow-hidden rounded-md border">
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head>Host</Table.Head>
					<Table.Head>Protocol</Table.Head>
					<Table.Head>Address</Table.Head>
					<Table.Head>Credential</Table.Head>
					<Table.Head>Status</Table.Head>
					<Table.Head class="w-24 text-right">Actions</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each hosts as host (host.id)}
					<Table.Row>
						<Table.Cell>
							<div class="font-medium">{host.name}</div>
							<div class="text-xs text-muted-foreground">
								{host.folder} · {host.tags.join(', ')}
							</div>
						</Table.Cell>
						<Table.Cell><Badge variant="outline">{host.protocol.toUpperCase()}</Badge></Table.Cell>
						<Table.Cell class="font-mono text-xs"
							>{host.username}@{host.hostname}:{host.port}</Table.Cell
						>
						<Table.Cell>{host.credential}</Table.Cell>
						<Table.Cell>
							<div class="flex items-center gap-2">
								<span
									class="size-2 rounded-full"
									class:bg-emerald-500={host.status === 'online'}
									class:bg-muted-foreground={host.status === 'unknown'}
									class:bg-destructive={host.status === 'offline'}
								></span>
								<span class="text-sm">{host.lastSeen}</span>
							</div>
						</Table.Cell>
						<Table.Cell>
							<div class="flex justify-end gap-1">
								<Button size="icon" variant="ghost" aria-label={`Launch ${host.name}`}>
									<Play class="size-4" />
								</Button>
								<Button size="icon" variant="ghost" aria-label={`More actions for ${host.name}`}>
									<MoreHorizontal class="size-4" />
								</Button>
							</div>
						</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>
	</div>
</section>
