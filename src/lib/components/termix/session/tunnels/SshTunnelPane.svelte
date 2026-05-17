<script lang="ts">
	import { Clipboard, ExternalLink, Play, Save, Square, Trash2 } from '@lucide/svelte';
	import { SvelteURL } from 'svelte/reactivity';
	import { Badge, type BadgeVariant } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Table from '$lib/components/ui/table';
	import {
		deleteSshTunnelProfile,
		listSshTunnelProfiles,
		listSshTunnelSessions,
		saveSshTunnelProfile,
		startSshTunnelSession,
		terminateSshTunnelSession,
		type HostSummary,
		type SshTunnelProfileSummary,
		type SshTunnelSessionSummary
	} from '$lib/remotes/tunnels.remote';
	import { failureCopy, failureDetail } from '$lib/termix/failure-copy';
	import StatePanel from '../../StatePanel.svelte';

	let { host }: { host: HostSummary } = $props();

	const profilesQuery = listSshTunnelProfiles();
	const sessionsQuery = listSshTunnelSessions();

	let name = $state('');
	let targetHost = $state('127.0.0.1');
	let targetPort = $state(80);
	let pendingAction = $state<string | null>(null);
	let error = $state<string | null>(null);
	let errorKind = $state<'tunnel' | 'clipboard'>('tunnel');
	let notice = $state<string | null>(null);

	let profiles = $derived(
		(profilesQuery.current ?? []).filter((profile) => profile.hostId === host.id)
	);
	let sessions = $derived(
		(sessionsQuery.current ?? []).filter((session) => session.hostId === host.id)
	);
	let activeSessions = $derived(
		sessions.filter((session) => session.status === 'active' || session.status === 'idle')
	);
	let errorCopy = $derived(
		error && errorKind === 'tunnel'
			? failureCopy({
					protocol: 'ssh-tunnel',
					message: error,
					fallbackTitle: 'Tunnel request failed'
				})
			: null
	);

	async function createProfile() {
		await runAction('profile:create', 'Saved tunnel profile.', async () => {
			await saveSshTunnelProfile({
				hostId: host.id,
				name,
				targetHost,
				targetPort
			}).updates(listSshTunnelProfiles);
			name = '';
		});
	}

	async function startProfile(profile: SshTunnelProfileSummary) {
		await runAction(`profile:start:${profile.id}`, 'Started tunnel.', () =>
			startSshTunnelSession({ profileId: profile.id }).updates(listSshTunnelSessions)
		);
	}

	async function startDirect() {
		await runAction('direct:start', 'Started direct tunnel.', () =>
			startSshTunnelSession({
				hostId: host.id,
				name: name || `${targetHost}:${targetPort}`,
				targetHost,
				targetPort
			}).updates(listSshTunnelSessions)
		);
	}

	async function deleteProfile(profile: SshTunnelProfileSummary) {
		await runAction(`profile:delete:${profile.id}`, 'Deleted tunnel profile.', () =>
			deleteSshTunnelProfile(profile.id).updates(listSshTunnelProfiles)
		);
	}

	async function terminateSession(session: SshTunnelSessionSummary) {
		await runAction(`session:terminate:${session.id}`, 'Terminated tunnel.', () =>
			terminateSshTunnelSession(session.id).updates(listSshTunnelSessions)
		);
	}

	async function copyWebSocketEndpoint(session: SshTunnelSessionSummary) {
		if (!navigator.clipboard) {
			errorKind = 'clipboard';
			error = 'Clipboard access is unavailable in this browser.';
			return;
		}

		const endpoint = new SvelteURL(session.websocketPath, window.location.href);
		endpoint.protocol = endpoint.protocol === 'https:' ? 'wss:' : 'ws:';
		await runAction(`session:copy:${session.id}`, 'Copied tunnel websocket endpoint.', () =>
			navigator.clipboard.writeText(endpoint.toString())
		);
	}

	async function runAction(id: string, success: string, action: () => Promise<unknown>) {
		pendingAction = id;
		error = null;
		notice = null;
		try {
			await action();
			notice = success;
		} catch (caught) {
			errorKind = id.startsWith('session:copy:') ? 'clipboard' : 'tunnel';
			error = caught instanceof Error ? caught.message : 'Tunnel operation failed.';
		} finally {
			pendingAction = null;
		}
	}

	function statusVariant(status: SshTunnelSessionSummary['status']): BadgeVariant {
		if (status === 'active') return 'default';
		if (status === 'idle' || status === 'ended') return 'secondary';
		if (status === 'failed') return 'destructive';
		return 'outline';
	}

	function formatTarget(profile: Pick<SshTunnelProfileSummary, 'targetHost' | 'targetPort'>) {
		return `${profile.targetHost}:${profile.targetPort}`;
	}
</script>

<div
	class="relative grid h-full min-h-0 min-w-0 grid-rows-[auto_1fr] overflow-hidden rounded-md border"
>
	<div class="grid gap-3 border-b bg-muted/20 p-3 xl:grid-cols-[1fr_auto]">
		{#if host.sshJumpHost.enabled && host.sshJumpHost.hostId}
			<div
				class="rounded-md border bg-background/70 px-3 py-2 text-xs text-muted-foreground xl:col-span-2"
			>
				SSH tunnel metadata uses jump host <span class="font-mono">{host.sshJumpHost.hostId}</span>.
			</div>
		{/if}
		<div class="grid gap-3 sm:grid-cols-[1fr_1fr_8rem]">
			<div class="space-y-1.5">
				<Label for="ssh-tunnel-name">Name</Label>
				<Input id="ssh-tunnel-name" class="h-8" bind:value={name} placeholder="Internal app" />
			</div>
			<div class="space-y-1.5">
				<Label for="ssh-tunnel-target-host">Target</Label>
				<Input
					id="ssh-tunnel-target-host"
					class="h-8 font-mono text-xs"
					bind:value={targetHost}
					placeholder="127.0.0.1"
				/>
			</div>
			<div class="space-y-1.5">
				<Label for="ssh-tunnel-target-port">Port</Label>
				<Input
					id="ssh-tunnel-target-port"
					class="h-8"
					type="number"
					min="1"
					max="65535"
					bind:value={targetPort}
				/>
			</div>
		</div>
		<div class="flex items-end gap-2">
			<Button
				size="sm"
				variant="outline"
				disabled={pendingAction === 'profile:create'}
				onclick={createProfile}
			>
				<Save class="size-4" />Save
			</Button>
			<Button size="sm" disabled={pendingAction === 'direct:start'} onclick={startDirect}>
				<Play class="size-4" />Start
			</Button>
		</div>
	</div>

	<div class="grid min-h-0 gap-3 overflow-auto p-3 xl:grid-cols-2">
		<Card.Root class="h-fit">
			<Card.Header>
				<Card.Title class="text-base">Profiles</Card.Title>
				<Card.Description>{profiles.length} saved for {host.name}</Card.Description>
			</Card.Header>
			<Card.Content>
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Name</Table.Head>
							<Table.Head>Target</Table.Head>
							<Table.Head class="w-24" aria-label="Actions"></Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each profiles as profile (profile.id)}
							<Table.Row>
								<Table.Cell class="font-medium">{profile.name}</Table.Cell>
								<Table.Cell class="font-mono text-xs">{formatTarget(profile)}</Table.Cell>
								<Table.Cell>
									<div class="flex justify-end gap-1">
										<Button
											size="icon-sm"
											variant="ghost"
											aria-label={`Start ${profile.name}`}
											disabled={pendingAction === `profile:start:${profile.id}`}
											onclick={() => startProfile(profile)}
										>
											<Play class="size-4" />
										</Button>
										<Button
											size="icon-sm"
											variant="ghost"
											aria-label={`Delete ${profile.name}`}
											disabled={pendingAction === `profile:delete:${profile.id}`}
											onclick={() => deleteProfile(profile)}
										>
											<Trash2 class="size-4" />
										</Button>
									</div>
								</Table.Cell>
							</Table.Row>
						{:else}
							<Table.Row>
								<Table.Cell colspan={3} class="h-20 text-center text-muted-foreground">
									No tunnel profiles.
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</Card.Content>
		</Card.Root>

		<Card.Root class="h-fit">
			<Card.Header>
				<Card.Title class="text-base">Active tunnels</Card.Title>
				<Card.Description>{activeSessions.length} open through {host.name}</Card.Description>
			</Card.Header>
			<Card.Content>
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Target</Table.Head>
							<Table.Head>Status</Table.Head>
							<Table.Head class="w-28" aria-label="Actions"></Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each sessions as session (session.id)}
							<Table.Row>
								<Table.Cell class="font-mono text-xs">{formatTarget(session)}</Table.Cell>
								<Table.Cell>
									<Badge variant={statusVariant(session.status)}>{session.status}</Badge>
								</Table.Cell>
								<Table.Cell>
									<div class="flex justify-end gap-1">
										<Button
											size="icon-sm"
											variant="ghost"
											aria-label="Copy tunnel websocket endpoint"
											disabled={session.status === 'ended' ||
												session.status === 'failed' ||
												pendingAction === `session:copy:${session.id}`}
											onclick={() => copyWebSocketEndpoint(session)}
										>
											<Clipboard class="size-4" />
										</Button>
										<Button
											size="icon-sm"
											variant="ghost"
											href={session.publicPath}
											target="_blank"
											aria-label="Open tunnel endpoint"
										>
											<ExternalLink class="size-4" />
										</Button>
										<Button
											size="icon-sm"
											variant="ghost"
											aria-label="Terminate tunnel"
											disabled={session.status === 'ended' ||
												session.status === 'failed' ||
												pendingAction === `session:terminate:${session.id}`}
											onclick={() => terminateSession(session)}
										>
											<Square class="size-4" />
										</Button>
									</div>
								</Table.Cell>
							</Table.Row>
						{:else}
							<Table.Row>
								<Table.Cell colspan={3} class="h-20 text-center text-muted-foreground">
									No tunnel sessions.
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</Card.Content>
		</Card.Root>
	</div>

	{#if profilesQuery.loading || sessionsQuery.loading || error || notice}
		<StatePanel
			state={error ? 'error' : profilesQuery.loading || sessionsQuery.loading ? 'loading' : 'ready'}
			title={error
				? errorKind === 'clipboard'
					? 'Could not copy endpoint'
					: (errorCopy?.title ?? 'Tunnel request failed')
				: profilesQuery.loading || sessionsQuery.loading
					? 'Loading tunnels'
					: (notice ?? 'Tunnel ready')}
			detail={errorCopy
				? `${failureDetail(errorCopy)}${errorCopy.diagnostic ? ` Diagnostic: ${errorCopy.diagnostic}` : ''}`
				: (error ?? `${host.hostname}:${host.port}`)}
			class="absolute right-3 bottom-3 left-3 bg-background"
		/>
	{/if}
</div>
