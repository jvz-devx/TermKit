<script lang="ts">
	import { Pencil, Plus } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import { Textarea } from '$lib/components/ui/textarea';
	import {
		listCredentials,
		listHosts,
		saveHost,
		type CredentialSummary,
		type HostSummary
	} from '$lib/termix.remote';

	let {
		credentials = [],
		host = null,
		onSaved
	}: {
		credentials?: CredentialSummary[];
		host?: HostSummary | null;
		onSaved?: () => void | Promise<void>;
	} = $props();

	let open = $state(false);
	let saving = $state(false);
	let error = $state<string | null>(null);
	let form = $state(createForm());

	type HostForm = {
		name: string;
		protocol: HostSummary['protocol'];
		hostname: string;
		port: number;
		username: string;
		credentialId: string;
		folder: string;
		tags: string;
		notes: string;
	};

	type HostProtocol = HostSummary['protocol'];

	const isEditing = $derived(Boolean(host));
	const title = $derived(isEditing ? 'Edit host' : 'Host configuration');
	const description = $derived(
		isEditing ? 'Update the saved connection target.' : 'Connection target and credential binding.'
	);

	const protocolLabels: Record<HostProtocol, string> = {
		ssh: 'SSH',
		rdp: 'RDP',
		vnc: 'VNC',
		telnet: 'Telnet'
	};

	const defaultPorts: Record<HostProtocol, number> = {
		ssh: 22,
		rdp: 3389,
		vnc: 5900,
		telnet: 23
	};

	function createForm(source: HostSummary | null = null): HostForm {
		return {
			name: source?.name ?? '',
			protocol: source?.protocol ?? 'ssh',
			hostname: source?.hostname ?? '',
			port: source?.port ?? defaultPorts.ssh,
			username: source?.username ?? '',
			credentialId: source?.credentialId ?? 'none',
			folder: source?.folder ?? '',
			tags: source?.tags.join(', ') ?? '',
			notes: source?.notes ?? ''
		};
	}

	function changeProtocol(protocol: string) {
		if (!(protocol in defaultPorts)) return;

		const nextProtocol = protocol as HostProtocol;
		const previousProtocol = form.protocol;
		const shouldUseDefaultPort = Number(form.port) === defaultPorts[previousProtocol];

		form.protocol = nextProtocol;
		if (shouldUseDefaultPort) form.port = defaultPorts[nextProtocol];
	}

	function openDialog() {
		form = createForm(host);
		error = null;
		open = true;
	}

	function closeDialog() {
		open = false;
	}

	function resetCreateForm() {
		if (!host) form = createForm();
	}

	async function submit() {
		saving = true;
		error = null;
		try {
			await saveHost({
				id: host?.id,
				...form,
				port: Number(form.port),
				credentialId: form.credentialId === 'none' ? null : form.credentialId
			}).updates(listHosts, listCredentials);
			resetCreateForm();
			await onSaved?.();
			open = false;
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Could not save host';
		} finally {
			saving = false;
		}
	}
</script>

<Dialog.Root bind:open>
	{#if isEditing}
		<Button
			size="icon"
			variant="ghost"
			aria-label={`Edit ${host?.name ?? 'host'}`}
			onclick={openDialog}
		>
			<Pencil class="size-4" />
		</Button>
	{:else}
		<Button size="sm" onclick={openDialog}><Plus class="size-4" />Host</Button>
	{/if}
	<Dialog.Content class="max-w-2xl">
		<Dialog.Header>
			<Dialog.Title>{title}</Dialog.Title>
			<Dialog.Description>{description}</Dialog.Description>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={(event) => (event.preventDefault(), submit())}>
			<div class="grid gap-4 sm:grid-cols-2">
				<div class="space-y-2">
					<Label for={isEditing ? `host-name-${host?.id}` : 'host-name'}>Name</Label>
					<Input
						id={isEditing ? `host-name-${host?.id}` : 'host-name'}
						bind:value={form.name}
						required
					/>
				</div>
				<div class="space-y-2">
					<Label>Protocol</Label>
					<Select.Root type="single" value={form.protocol} onValueChange={changeProtocol}>
						<Select.Trigger class="w-full">{protocolLabels[form.protocol]}</Select.Trigger>
						<Select.Content>
							<Select.Item value="ssh">SSH</Select.Item>
							<Select.Item value="rdp">RDP</Select.Item>
							<Select.Item value="vnc">VNC</Select.Item>
							<Select.Item value="telnet">Telnet</Select.Item>
						</Select.Content>
					</Select.Root>
				</div>
				<div class="space-y-2">
					<Label for={isEditing ? `hostname-${host?.id}` : 'hostname'}>Hostname</Label>
					<Input
						id={isEditing ? `hostname-${host?.id}` : 'hostname'}
						bind:value={form.hostname}
						required
					/>
				</div>
				<div class="space-y-2">
					<Label for={isEditing ? `port-${host?.id}` : 'port'}>Port</Label>
					<Input
						id={isEditing ? `port-${host?.id}` : 'port'}
						type="number"
						min="1"
						max="65535"
						bind:value={form.port}
						required
					/>
				</div>
				<div class="space-y-2">
					<Label for={isEditing ? `username-${host?.id}` : 'username'}>Username</Label>
					<Input id={isEditing ? `username-${host?.id}` : 'username'} bind:value={form.username} />
				</div>
				<div class="space-y-2">
					<Label>Credential</Label>
					<Select.Root type="single" bind:value={form.credentialId}>
						<Select.Trigger class="w-full">
							{form.credentialId === 'none'
								? 'No credential'
								: credentials.find((credential) => credential.id === form.credentialId)?.name}
						</Select.Trigger>
						<Select.Content>
							<Select.Item value="none">No credential</Select.Item>
							{#each credentials as credential (credential.id)}
								<Select.Item value={credential.id}>{credential.name}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
				<div class="space-y-2">
					<Label for={isEditing ? `folder-${host?.id}` : 'folder'}>Folder</Label>
					<Input id={isEditing ? `folder-${host?.id}` : 'folder'} bind:value={form.folder} />
				</div>
				<div class="space-y-2">
					<Label for={isEditing ? `tags-${host?.id}` : 'tags'}>Tags</Label>
					<Input
						id={isEditing ? `tags-${host?.id}` : 'tags'}
						bind:value={form.tags}
						placeholder="linux, gateway"
					/>
				</div>
				<div class="space-y-2 sm:col-span-2">
					<Label for={isEditing ? `notes-${host?.id}` : 'notes'}>Notes</Label>
					<Textarea id={isEditing ? `notes-${host?.id}` : 'notes'} bind:value={form.notes} />
				</div>
			</div>
			{#if error}
				<p class="text-sm text-destructive">{error}</p>
			{/if}
			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={closeDialog}>Cancel</Button>
				<Button type="submit" disabled={saving}>
					{saving ? 'Saving...' : isEditing ? 'Save changes' : 'Save host'}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
