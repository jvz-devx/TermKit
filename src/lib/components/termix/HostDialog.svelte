<script lang="ts">
	import { Plus } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import { Textarea } from '$lib/components/ui/textarea';
	import { saveHost, type CredentialSummary } from '$lib/termix.remote';

	let {
		credentials = [],
		onSaved
	}: {
		credentials?: CredentialSummary[];
		onSaved?: () => void | Promise<void>;
	} = $props();

	let open = $state(false);
	let saving = $state(false);
	let error = $state<string | null>(null);
	let form = $state({
		name: '',
		protocol: 'ssh',
		hostname: '',
		port: 22,
		username: '',
		credentialId: 'none',
		folder: '',
		tags: '',
		notes: ''
	});

	const protocolLabels: Record<string, string> = {
		ssh: 'SSH',
		rdp: 'RDP',
		vnc: 'VNC',
		telnet: 'Telnet'
	};

	async function submit() {
		saving = true;
		error = null;
		try {
			await saveHost({
				...form,
				port: Number(form.port),
				credentialId: form.credentialId === 'none' ? null : form.credentialId
			});
			form = {
				name: '',
				protocol: 'ssh',
				hostname: '',
				port: 22,
				username: '',
				credentialId: 'none',
				folder: '',
				tags: '',
				notes: ''
			};
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
	<Dialog.Trigger>
		<Button size="sm"><Plus class="size-4" />Host</Button>
	</Dialog.Trigger>
	<Dialog.Content class="max-w-2xl">
		<Dialog.Header>
			<Dialog.Title>Host configuration</Dialog.Title>
			<Dialog.Description>Connection target and credential binding.</Dialog.Description>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={(event) => (event.preventDefault(), submit())}>
			<div class="grid gap-4 sm:grid-cols-2">
				<div class="space-y-2">
					<Label for="host-name">Name</Label>
					<Input id="host-name" bind:value={form.name} required />
				</div>
				<div class="space-y-2">
					<Label>Protocol</Label>
					<Select.Root type="single" bind:value={form.protocol}>
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
					<Label for="hostname">Hostname</Label>
					<Input id="hostname" bind:value={form.hostname} required />
				</div>
				<div class="space-y-2">
					<Label for="port">Port</Label>
					<Input id="port" type="number" min="1" max="65535" bind:value={form.port} required />
				</div>
				<div class="space-y-2">
					<Label for="username">Username</Label>
					<Input id="username" bind:value={form.username} />
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
					<Label for="folder">Folder</Label>
					<Input id="folder" bind:value={form.folder} />
				</div>
				<div class="space-y-2">
					<Label for="tags">Tags</Label>
					<Input id="tags" bind:value={form.tags} placeholder="linux, gateway" />
				</div>
				<div class="space-y-2 sm:col-span-2">
					<Label for="notes">Notes</Label>
					<Textarea id="notes" bind:value={form.notes} />
				</div>
			</div>
			{#if error}
				<p class="text-sm text-destructive">{error}</p>
			{/if}
			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (open = false)}>Cancel</Button>
				<Button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save host'}</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
