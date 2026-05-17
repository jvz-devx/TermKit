<script lang="ts">
	import { Pencil, Plus } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import { Switch } from '$lib/components/ui/switch';
	import { Textarea } from '$lib/components/ui/textarea';
	import { listHosts, saveHost, type HostSummary } from '$lib/remotes/hosts.remote';
	import { listCredentials, type CredentialSummary } from '$lib/remotes/credentials.remote';
	import { normalizeHostMetadata } from '$lib/termix/host-metadata';

	let {
		credentials = [],
		hosts = [],
		host = null,
		onSaved
	}: {
		credentials?: CredentialSummary[];
		hosts?: HostSummary[];
		host?: HostSummary | null;
		onSaved?: () => void | Promise<void>;
	} = $props();

	let open = $state(false);
	let saving = $state(false);
	let error = $state<string | null>(null);

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
		terminalFontSize: number | null;
		terminalScrollback: number;
		terminalCursorBlink: boolean;
		terminalTheme: 'dark' | 'light' | 'system';
		jumpEnabled: boolean;
		jumpHostId: string;
		ftpsMode: 'explicit' | 'implicit';
		ftpsRejectUnauthorized: boolean;
		ftpsCertificateHostname: string;
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
		telnet: 'Telnet',
		ftp: 'FTP',
		ftps: 'FTPS'
	};

	const defaultPorts: Record<HostProtocol, number> = {
		ssh: 22,
		rdp: 3389,
		vnc: 5900,
		telnet: 23,
		ftp: 21,
		ftps: 21
	};
	let availableJumpHosts = $derived(
		hosts.filter((candidate) => candidate.protocol === 'ssh' && candidate.id !== host?.id)
	);

	let form = $state(createForm());

	function createForm(source: HostSummary | null = null): HostForm {
		const metadata = normalizeHostMetadata(source?.metadata);
		return {
			name: source?.name ?? '',
			protocol: source?.protocol ?? 'ssh',
			hostname: source?.hostname ?? '',
			port: source?.port ?? defaultPorts.ssh,
			username: source?.username ?? '',
			credentialId: source?.credentialId ?? 'none',
			folder: source?.folder ?? '',
			tags: source?.tags.join(', ') ?? '',
			notes: source?.notes ?? '',
			terminalFontSize: metadata.terminalPreferences.fontSize,
			terminalScrollback: metadata.terminalPreferences.scrollback,
			terminalCursorBlink: metadata.terminalPreferences.cursorBlink,
			terminalTheme: metadata.terminalPreferences.theme,
			jumpEnabled: metadata.sshJumpHost.enabled,
			jumpHostId: metadata.sshJumpHost.hostId ?? 'none',
			ftpsMode: metadata.ftps.mode,
			ftpsRejectUnauthorized: metadata.ftps.rejectUnauthorized,
			ftpsCertificateHostname: metadata.ftps.certificateHostname ?? ''
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
				credentialId: form.credentialId === 'none' ? null : form.credentialId,
				metadata: {
					terminalPreferences: {
						fontSize: form.terminalFontSize,
						scrollback: Number(form.terminalScrollback),
						cursorBlink: form.terminalCursorBlink,
						theme: form.terminalTheme
					},
					sshJumpHost: {
						enabled: form.jumpEnabled,
						hostId: form.jumpHostId === 'none' ? null : form.jumpHostId
					},
					ftps: {
						mode: form.ftpsMode,
						rejectUnauthorized: form.ftpsRejectUnauthorized,
						certificateHostname: form.ftpsCertificateHostname.trim() || null
					}
				}
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
							<Select.Item value="ftp">FTP</Select.Item>
							<Select.Item value="ftps">FTPS</Select.Item>
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
				<div class="space-y-3 rounded-md border p-3 sm:col-span-2">
					<div>
						<h3 class="text-sm font-medium">Terminal preferences</h3>
						<p class="text-xs text-muted-foreground">Per-host terminal defaults.</p>
					</div>
					<div class="grid gap-4 sm:grid-cols-4">
						<div class="space-y-2">
							<Label for={isEditing ? `terminal-font-${host?.id}` : 'terminal-font'}>
								Font size
							</Label>
							<Input
								id={isEditing ? `terminal-font-${host?.id}` : 'terminal-font'}
								type="number"
								min="8"
								max="32"
								placeholder="App default"
								bind:value={form.terminalFontSize}
							/>
						</div>
						<div class="space-y-2">
							<Label for={isEditing ? `terminal-scrollback-${host?.id}` : 'terminal-scrollback'}>
								Scrollback
							</Label>
							<Input
								id={isEditing ? `terminal-scrollback-${host?.id}` : 'terminal-scrollback'}
								type="number"
								min="500"
								max="50000"
								step="500"
								bind:value={form.terminalScrollback}
							/>
						</div>
						<div class="space-y-2">
							<Label>Theme</Label>
							<Select.Root type="single" bind:value={form.terminalTheme}>
								<Select.Trigger class="w-full capitalize">{form.terminalTheme}</Select.Trigger>
								<Select.Content>
									<Select.Item value="dark">Dark</Select.Item>
									<Select.Item value="light">Light</Select.Item>
									<Select.Item value="system">System</Select.Item>
								</Select.Content>
							</Select.Root>
						</div>
						<div class="flex items-end justify-between gap-3">
							<div>
								<Label for={isEditing ? `terminal-cursor-${host?.id}` : 'terminal-cursor'}>
									Blink cursor
								</Label>
								<p class="text-xs text-muted-foreground">Session default</p>
							</div>
							<Switch
								id={isEditing ? `terminal-cursor-${host?.id}` : 'terminal-cursor'}
								bind:checked={form.terminalCursorBlink}
							/>
						</div>
					</div>
				</div>
				<div class="space-y-3 rounded-md border p-3 sm:col-span-2">
					<div class="flex items-center justify-between gap-3">
						<div>
							<h3 class="text-sm font-medium">Jump host</h3>
							<p class="text-xs text-muted-foreground">
								Bastion metadata for SSH, SFTP, and tunnels.
							</p>
						</div>
						<Switch bind:checked={form.jumpEnabled} disabled={!availableJumpHosts.length} />
					</div>
					<div class="space-y-2">
						<Label>Saved SSH host</Label>
						<Select.Root
							type="single"
							bind:value={form.jumpHostId}
							disabled={!form.jumpEnabled || !availableJumpHosts.length}
						>
							<Select.Trigger class="w-full">
								{form.jumpHostId === 'none'
									? 'No jump host'
									: availableJumpHosts.find((candidate) => candidate.id === form.jumpHostId)?.name}
							</Select.Trigger>
							<Select.Content>
								<Select.Item value="none">No jump host</Select.Item>
								{#each availableJumpHosts as candidate (candidate.id)}
									<Select.Item value={candidate.id}>
										{candidate.name} ({candidate.hostname})
									</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</div>
				</div>
				{#if form.protocol === 'ftps'}
					<div class="space-y-3 rounded-md border p-3 sm:col-span-2">
						<div>
							<h3 class="text-sm font-medium">FTPS security</h3>
							<p class="text-xs text-muted-foreground">TLS mode and certificate validation.</p>
						</div>
						<div class="grid gap-4 sm:grid-cols-2">
							<div class="space-y-2">
								<Label>Mode</Label>
								<Select.Root type="single" bind:value={form.ftpsMode}>
									<Select.Trigger class="w-full">
										{form.ftpsMode === 'explicit' ? 'Explicit TLS' : 'Implicit TLS'}
									</Select.Trigger>
									<Select.Content>
										<Select.Item value="explicit">Explicit TLS</Select.Item>
										<Select.Item value="implicit">Implicit TLS</Select.Item>
									</Select.Content>
								</Select.Root>
							</div>
							<div class="flex items-end justify-between gap-3">
								<div>
									<Label for={isEditing ? `ftps-cert-${host?.id}` : 'ftps-cert'}>
										Verify certificate
									</Label>
									<p class="text-xs text-muted-foreground">Reject invalid server certificates.</p>
								</div>
								<Switch
									id={isEditing ? `ftps-cert-${host?.id}` : 'ftps-cert'}
									bind:checked={form.ftpsRejectUnauthorized}
								/>
							</div>
							<div class="space-y-2 sm:col-span-2">
								<Label for={isEditing ? `ftps-hostname-${host?.id}` : 'ftps-hostname'}>
									Certificate hostname
								</Label>
								<Input
									id={isEditing ? `ftps-hostname-${host?.id}` : 'ftps-hostname'}
									bind:value={form.ftpsCertificateHostname}
									placeholder={form.hostname || 'files.example.test'}
								/>
							</div>
						</div>
					</div>
				{/if}
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
