<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { MoreHorizontal, Play, Search, SlidersHorizontal, Trash2 } from '@lucide/svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Table from '$lib/components/ui/table';
	import {
		createSessionLaunch,
		deleteHost,
		listCredentials,
		listHosts,
		type HostSummary
	} from '$lib/termix.remote';
	import HostDialog from './HostDialog.svelte';

	const hostsQuery = listHosts();
	const credentialsQuery = listCredentials();

	let search = $state('');
	let launchingId = $state<string | null>(null);
	let deletingId = $state<string | null>(null);
	let error = $state<string | null>(null);
	let hosts = $derived(hostsQuery.current ?? []);
	let credentials = $derived(credentialsQuery.current ?? []);
	let filteredHosts = $derived.by(() => {
		const needle = search.trim().toLowerCase();
		if (!needle) return hosts;

		return hosts.filter((host) =>
			[
				host.name,
				host.hostname,
				host.username,
				host.folder,
				host.credentialName,
				host.protocol,
				...host.tags
			]
				.filter(Boolean)
				.join(' ')
				.toLowerCase()
				.includes(needle)
		);
	});

	async function launch(host: HostSummary) {
		launchingId = host.id;
		error = null;
		try {
			const launch = await createSessionLaunch({ hostId: host.id, protocol: host.protocol });
			if (launch.websocketPath) {
				sessionStorage.setItem(launchStorageKey(host.id, host.protocol), JSON.stringify(launch));
			}
			await goto(
				resolve(`/sessions?host=${encodeURIComponent(host.id)}&tab=${host.protocol}` as '/')
			);
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Could not launch host';
		} finally {
			launchingId = null;
		}
	}

	async function remove(host: HostSummary) {
		if (!confirm(`Delete ${host.name}?`)) return;
		deletingId = host.id;
		error = null;
		try {
			await deleteHost(host.id).updates(listHosts, listCredentials);
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Could not delete host';
		} finally {
			deletingId = null;
		}
	}

	function launchStorageKey(hostId: string, protocol: string) {
		return `termix-launch:${hostId}:${protocol}`;
	}
</script>

<section class="space-y-3 p-4">
	<div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
		<div>
			<h1 class="text-lg font-semibold">Hosts</h1>
			<p class="text-sm text-muted-foreground">
				Searchable connection inventory for protocol launches.
			</p>
		</div>
		<HostDialog {credentials} onSaved={() => hostsQuery.refresh()} />
	</div>

	<div class="flex gap-2">
		<div class="relative min-w-0 flex-1">
			<Search class="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
			<Input class="pl-8" placeholder="Search name, address, folder, or tag" bind:value={search} />
		</div>
		<Button variant="outline" size="icon" aria-label="Filter hosts">
			<SlidersHorizontal class="size-4" />
		</Button>
	</div>

	{#if error}
		<div
			class="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
		>
			{error}
		</div>
	{/if}

	<div class="overflow-hidden rounded-md border">
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head>Host</Table.Head>
					<Table.Head>Protocol</Table.Head>
					<Table.Head>Address</Table.Head>
					<Table.Head>Credential</Table.Head>
					<Table.Head>Updated</Table.Head>
					<Table.Head class="w-28 text-right">Actions</Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#if hostsQuery.loading}
					<Table.Row>
						<Table.Cell colspan={6} class="h-24 text-center text-muted-foreground">
							Loading hosts...
						</Table.Cell>
					</Table.Row>
				{:else}
					{#each filteredHosts as host (host.id)}
						<Table.Row>
							<Table.Cell>
								<div class="font-medium">{host.name}</div>
								<div class="text-xs text-muted-foreground">
									{host.folder ?? 'No folder'}{host.tags.length ? ` · ${host.tags.join(', ')}` : ''}
								</div>
							</Table.Cell>
							<Table.Cell><Badge variant="outline">{host.protocol.toUpperCase()}</Badge></Table.Cell
							>
							<Table.Cell class="font-mono text-xs">
								{host.username ? `${host.username}@` : ''}{host.hostname}:{host.port}
							</Table.Cell>
							<Table.Cell>{host.credentialName ?? 'None'}</Table.Cell>
							<Table.Cell class="text-sm text-muted-foreground">
								{new Date(host.updatedAt).toLocaleString()}
							</Table.Cell>
							<Table.Cell>
								<div class="flex justify-end gap-1">
									<Button
										size="icon"
										variant="ghost"
										aria-label={`Launch ${host.name}`}
										disabled={launchingId === host.id}
										onclick={() => launch(host)}
									>
										<Play class="size-4" />
									</Button>
									<Button
										size="icon"
										variant="ghost"
										aria-label={`Delete ${host.name}`}
										disabled={deletingId === host.id}
										onclick={() => remove(host)}
									>
										<Trash2 class="size-4" />
									</Button>
									<Button size="icon" variant="ghost" aria-label={`More actions for ${host.name}`}>
										<MoreHorizontal class="size-4" />
									</Button>
								</div>
							</Table.Cell>
						</Table.Row>
					{:else}
						<Table.Row>
							<Table.Cell colspan={6} class="h-24 text-center text-muted-foreground">
								No hosts found.
							</Table.Cell>
						</Table.Row>
					{/each}
				{/if}
			</Table.Body>
		</Table.Root>
	</div>
</section>
