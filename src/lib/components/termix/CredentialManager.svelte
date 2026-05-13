<script lang="ts">
	import { KeyRound, Plus, ShieldCheck, Trash2 } from '@lucide/svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import * as Table from '$lib/components/ui/table';
	import { Textarea } from '$lib/components/ui/textarea';
	import { deleteCredential, listCredentials, saveCredential } from '$lib/termix.remote';

	const credentialsQuery = listCredentials();

	let search = $state('');
	let open = $state(false);
	let saving = $state(false);
	let deletingId = $state<string | null>(null);
	let error = $state<string | null>(null);
	let form = $state({
		name: '',
		kind: 'password',
		username: '',
		secret: ''
	});

	let credentials = $derived(credentialsQuery.current ?? []);
	let filteredCredentials = $derived.by(() => {
		const needle = search.trim().toLowerCase();
		if (!needle) return credentials;
		return credentials.filter((credential) =>
			[credential.name, credential.kind, credential.username]
				.filter(Boolean)
				.join(' ')
				.toLowerCase()
				.includes(needle)
		);
	});

	async function submit() {
		saving = true;
		error = null;
		try {
			await saveCredential(form).updates(listCredentials);
			form = { name: '', kind: 'password', username: '', secret: '' };
			open = false;
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Could not save credential';
		} finally {
			saving = false;
		}
	}

	async function remove(id: string, name: string) {
		if (!confirm(`Delete ${name}?`)) return;
		deletingId = id;
		error = null;
		try {
			await deleteCredential(id).updates(listCredentials);
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Could not delete credential';
		} finally {
			deletingId = null;
		}
	}
</script>

<section class="space-y-3 p-4">
	<div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
		<div>
			<h1 class="text-lg font-semibold">Credentials</h1>
			<p class="text-sm text-muted-foreground">Encrypted password and SSH key records.</p>
		</div>
		<Dialog.Root bind:open>
			<Dialog.Trigger>
				<Button size="sm"><Plus class="size-4" />Credential</Button>
			</Dialog.Trigger>
			<Dialog.Content class="max-w-xl">
				<Dialog.Header>
					<Dialog.Title>Credential</Dialog.Title>
					<Dialog.Description>Secret values are write-only after save.</Dialog.Description>
				</Dialog.Header>
				<form class="space-y-4" onsubmit={(event) => (event.preventDefault(), submit())}>
					<div class="grid gap-4 sm:grid-cols-2">
						<div class="space-y-2">
							<Label for="credential-name">Name</Label>
							<Input id="credential-name" bind:value={form.name} required />
						</div>
						<div class="space-y-2">
							<Label>Kind</Label>
							<Select.Root type="single" bind:value={form.kind}>
								<Select.Trigger class="w-full">
									{form.kind === 'ssh_key' ? 'SSH key' : 'Password'}
								</Select.Trigger>
								<Select.Content>
									<Select.Item value="password">Password</Select.Item>
									<Select.Item value="ssh_key">SSH key</Select.Item>
								</Select.Content>
							</Select.Root>
						</div>
						<div class="space-y-2 sm:col-span-2">
							<Label for="credential-username">Username</Label>
							<Input id="credential-username" bind:value={form.username} />
						</div>
						<div class="space-y-2 sm:col-span-2">
							<Label for="credential-secret">
								{form.kind === 'ssh_key' ? 'Private key' : 'Password'}
							</Label>
							{#if form.kind === 'ssh_key'}
								<Textarea id="credential-secret" bind:value={form.secret} required />
							{:else}
								<Input id="credential-secret" type="password" bind:value={form.secret} required />
							{/if}
						</div>
					</div>
					{#if error}
						<p class="text-sm text-destructive">{error}</p>
					{/if}
					<Dialog.Footer>
						<Button type="button" variant="outline" onclick={() => (open = false)}>Cancel</Button>
						<Button type="submit" disabled={saving}>
							{saving ? 'Saving...' : 'Save credential'}
						</Button>
					</Dialog.Footer>
				</form>
			</Dialog.Content>
		</Dialog.Root>
	</div>

	<div class="grid gap-3 lg:grid-cols-[1fr_280px]">
		<div class="space-y-3">
			<Input placeholder="Filter credentials by name, username, or kind" bind:value={search} />
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
							<Table.Head>Name</Table.Head>
							<Table.Head>Kind</Table.Head>
							<Table.Head>Username</Table.Head>
							<Table.Head>Used by</Table.Head>
							<Table.Head>Updated</Table.Head>
							<Table.Head class="w-12"></Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#if credentialsQuery.loading}
							<Table.Row>
								<Table.Cell colspan={6} class="h-24 text-center text-muted-foreground">
									Loading credentials...
								</Table.Cell>
							</Table.Row>
						{:else}
							{#each filteredCredentials as credential (credential.id)}
								<Table.Row>
									<Table.Cell class="font-medium">{credential.name}</Table.Cell>
									<Table.Cell>
										<Badge variant="outline">
											{credential.kind === 'ssh_key' ? 'SSH key' : 'Password'}
										</Badge>
									</Table.Cell>
									<Table.Cell>{credential.username ?? '-'}</Table.Cell>
									<Table.Cell>{credential.usedBy} hosts</Table.Cell>
									<Table.Cell class="text-sm text-muted-foreground">
										{new Date(credential.updatedAt).toLocaleString()}
									</Table.Cell>
									<Table.Cell>
										<Button
											variant="ghost"
											size="icon"
											aria-label={`Delete ${credential.name}`}
											disabled={deletingId === credential.id}
											onclick={() => remove(credential.id, credential.name)}
										>
											<Trash2 class="size-4" />
										</Button>
									</Table.Cell>
								</Table.Row>
							{:else}
								<Table.Row>
									<Table.Cell colspan={6} class="h-24 text-center text-muted-foreground">
										No credentials found.
									</Table.Cell>
								</Table.Row>
							{/each}
						{/if}
					</Table.Body>
				</Table.Root>
			</div>
		</div>
		<div class="rounded-md border p-3">
			<div class="flex items-center gap-2">
				<ShieldCheck class="size-4" />
				<h2 class="text-sm font-medium">Storage state</h2>
			</div>
			<div class="mt-3 space-y-2 text-sm">
				<div class="flex justify-between">
					<span class="text-muted-foreground">Encryption</span><span>ready</span>
				</div>
				<div class="flex justify-between">
					<span class="text-muted-foreground">Secret exposure</span><span>redacted</span>
				</div>
				<div class="flex justify-between">
					<span class="text-muted-foreground">Records</span><span>{credentials.length}</span>
				</div>
			</div>
			<div class="mt-4 rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
				<KeyRound class="mb-2 size-4" />
				Passwords and private keys are submitted to server-side remote functions and are never returned
				to the browser.
			</div>
		</div>
	</div>
</section>
