<script lang="ts">
	import { KeyRound, Pencil, Plus, ShieldCheck, Trash2 } from '@lucide/svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import * as Table from '$lib/components/ui/table';
	import { Textarea } from '$lib/components/ui/textarea';
	import {
		deleteCredential,
		listCredentials,
		saveCredential,
		type CredentialSummary
	} from '$lib/termix.remote';

	const credentialsQuery = listCredentials();

	let search = $state('');
	let open = $state(false);
	let saving = $state(false);
	let deletingId = $state<string | null>(null);
	let error = $state<string | null>(null);
	let editingCredential = $state<CredentialSummary | null>(null);
	let deleteTarget = $state<CredentialSummary | null>(null);
	let deleteDialogOpen = $state(false);
	let form = $state(emptyForm());

	type CredentialForm = {
		name: string;
		kind: CredentialSummary['kind'];
		username: string;
		secret: string;
	};

	const isEditing = $derived(Boolean(editingCredential));

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

	function emptyForm(): CredentialForm {
		return { name: '', kind: 'password', username: '', secret: '' };
	}

	function credentialForm(credential: CredentialSummary): CredentialForm {
		return {
			name: credential.name,
			kind: credential.kind,
			username: credential.username ?? '',
			secret: ''
		};
	}

	function openCreateDialog() {
		editingCredential = null;
		form = emptyForm();
		error = null;
		open = true;
	}

	function openEditDialog(credential: CredentialSummary) {
		editingCredential = credential;
		form = credentialForm(credential);
		error = null;
		open = true;
	}

	function closeDialog() {
		open = false;
	}

	async function submit() {
		saving = true;
		error = null;
		try {
			await saveCredential({
				id: editingCredential?.id,
				name: form.name,
				kind: form.kind,
				username: form.username,
				...(form.secret ? { secret: form.secret } : {})
			}).updates(listCredentials);
			editingCredential = null;
			form = emptyForm();
			open = false;
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Could not save credential';
		} finally {
			saving = false;
		}
	}

	function requestRemove(credential: CredentialSummary) {
		deleteTarget = credential;
		deleteDialogOpen = true;
	}

	async function removeTarget() {
		if (!deleteTarget) return;
		const credential = deleteTarget;
		deletingId = credential.id;
		error = null;
		try {
			await deleteCredential(credential.id).updates(listCredentials);
			deleteDialogOpen = false;
			deleteTarget = null;
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
			<Button size="sm" onclick={openCreateDialog}><Plus class="size-4" />Credential</Button>
			<Dialog.Content class="max-w-xl">
				<Dialog.Header>
					<Dialog.Title>{isEditing ? 'Edit credential' : 'Credential'}</Dialog.Title>
					<Dialog.Description>
						{isEditing
							? 'Secret values are write-only. Enter a replacement only when rotating.'
							: 'Secret values are write-only after save.'}
					</Dialog.Description>
				</Dialog.Header>
				<form class="space-y-4" onsubmit={(event) => (event.preventDefault(), submit())}>
					<div class="grid gap-4 sm:grid-cols-2">
						<div class="space-y-2">
							<Label
								for={isEditing ? `credential-name-${editingCredential?.id}` : 'credential-name'}
							>
								Name
							</Label>
							<Input
								id={isEditing ? `credential-name-${editingCredential?.id}` : 'credential-name'}
								bind:value={form.name}
								required
							/>
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
							<Label
								for={isEditing
									? `credential-username-${editingCredential?.id}`
									: 'credential-username'}
							>
								Username
							</Label>
							<Input
								id={isEditing
									? `credential-username-${editingCredential?.id}`
									: 'credential-username'}
								bind:value={form.username}
							/>
						</div>
						<div class="space-y-2 sm:col-span-2">
							<Label
								for={isEditing ? `credential-secret-${editingCredential?.id}` : 'credential-secret'}
							>
								{form.kind === 'ssh_key' ? 'Private key' : 'Password'}
							</Label>
							{#if form.kind === 'ssh_key'}
								<Textarea
									id={isEditing
										? `credential-secret-${editingCredential?.id}`
										: 'credential-secret'}
									bind:value={form.secret}
									placeholder={isEditing ? 'Leave blank to keep the current private key' : ''}
									required={!isEditing}
								/>
							{:else}
								<Input
									id={isEditing
										? `credential-secret-${editingCredential?.id}`
										: 'credential-secret'}
									type="password"
									bind:value={form.secret}
									placeholder={isEditing ? 'Leave blank to keep the current password' : ''}
									required={!isEditing}
								/>
							{/if}
						</div>
					</div>
					{#if error}
						<p class="text-sm text-destructive">{error}</p>
					{/if}
					<Dialog.Footer>
						<Button type="button" variant="outline" onclick={closeDialog}>Cancel</Button>
						<Button type="submit" disabled={saving}>
							{saving ? 'Saving...' : isEditing ? 'Save changes' : 'Save credential'}
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
							<Table.Head class="w-24 text-right">Actions</Table.Head>
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
										<div class="flex justify-end gap-1">
											<Button
												variant="ghost"
												size="icon"
												aria-label={`Edit ${credential.name}`}
												onclick={() => openEditDialog(credential)}
											>
												<Pencil class="size-4" />
											</Button>
											<Button
												variant="ghost"
												size="icon"
												aria-label={`Delete ${credential.name}`}
												disabled={deletingId === credential.id}
												onclick={() => requestRemove(credential)}
											>
												<Trash2 class="size-4" />
											</Button>
										</div>
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

	<AlertDialog.Root bind:open={deleteDialogOpen}>
		<AlertDialog.Content>
			<AlertDialog.Header>
				<AlertDialog.Title>Delete credential?</AlertDialog.Title>
				<AlertDialog.Description>
					{#if deleteTarget}
						This deletes {deleteTarget.name}. Hosts using it will no longer have a saved secret for
						launches.
					{:else}
						This credential will be deleted.
					{/if}
				</AlertDialog.Description>
			</AlertDialog.Header>
			<AlertDialog.Footer>
				<AlertDialog.Cancel disabled={Boolean(deletingId)}>Cancel</AlertDialog.Cancel>
				<AlertDialog.Action
					variant="destructive"
					disabled={!deleteTarget || Boolean(deletingId)}
					onclick={(event) => {
						event.preventDefault();
						void removeTarget();
					}}
				>
					{deletingId ? 'Deleting...' : 'Delete credential'}
				</AlertDialog.Action>
			</AlertDialog.Footer>
		</AlertDialog.Content>
	</AlertDialog.Root>
</section>
