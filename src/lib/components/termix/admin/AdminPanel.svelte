<script lang="ts">
	import {
		Activity,
		BadgeCheck,
		Ban,
		Cable,
		Clock3,
		FolderKanban,
		Server,
		Settings2,
		Shield,
		ShieldCheck,
		SquareTerminal,
		Users
	} from '@lucide/svelte';
	import { page } from '$app/state';
	import {
		createAdminUser,
		disableAdminUser,
		getAdminOverview,
		promoteAdminUser,
		terminateAdminLiveSshSession,
		type AdminConnectionHistoryEntry,
		type AdminLiveSshSessionSummary,
		type AdminOverview,
		type AdminUserSummary,
		type AdminWorkspaceSummary
	} from '$lib/admin.remote';
	import * as Alert from '$lib/components/ui/alert';
	import { Badge, type BadgeVariant } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import * as Table from '$lib/components/ui/table';
	import * as Tabs from '$lib/components/ui/tabs';
	import type { Component } from 'svelte';

	const overviewQuery = getAdminOverview();
	const initialOverview = await overviewQuery;

	let activeTab = $state(page.url.searchParams.get('tab') ?? 'users');
	let pendingAction = $state<string | null>(null);
	let notice = $state<string | null>(null);
	let error = $state<string | null>(null);
	let createUsername = $state('');
	let createPassword = $state('');
	let createAsAdmin = $state(false);

	const overview = $derived(overviewQuery.current ?? initialOverview);
	const activeLiveSessions = $derived(
		overview.liveSshSessions.filter((session) => session.canTerminate).length
	);
	const failedConnections = $derived(
		overview.connectionHistory.filter((session) => session.status === 'failed').length
	);

	async function createUser() {
		await runAction('create:user', `Created ${createUsername.trim()}.`, async () => {
			await createAdminUser({
				username: createUsername,
				password: createPassword,
				isAdmin: createAsAdmin
			}).updates(getAdminOverview);
			createUsername = '';
			createPassword = '';
			createAsAdmin = false;
		});
	}

	async function promoteUser(user: AdminUserSummary) {
		await runAction(`promote:${user.id}`, `Promoted ${user.username}.`, () =>
			promoteAdminUser(user.id).updates(getAdminOverview)
		);
	}

	async function disableUser(user: AdminUserSummary) {
		await runAction(`disable:${user.id}`, `Disabled ${user.username}.`, () =>
			disableAdminUser(user.id).updates(getAdminOverview)
		);
	}

	async function terminateSession(session: AdminLiveSshSessionSummary) {
		await runAction(`terminate:${session.id}`, `Terminated ${session.title}.`, () =>
			terminateAdminLiveSshSession(session.id).updates(getAdminOverview)
		);
	}

	async function runAction(id: string, success: string | null, action: () => Promise<unknown>) {
		pendingAction = id;
		notice = null;
		error = null;

		try {
			await action();
			if (success) notice = success;
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Admin operation failed.';
		} finally {
			pendingAction = null;
		}
	}

	function statusVariant(status: string): BadgeVariant {
		if (status === 'active' || status === 'attached') return 'default';
		if (status === 'failed' || status === 'stale') return 'destructive';
		if (status === 'ended' || status === 'detached') return 'secondary';
		return 'outline';
	}

	function shortId(id: string) {
		return id.slice(0, 8);
	}

	function formatDate(value: string | null) {
		if (!value) return 'Never';
		return new Intl.DateTimeFormat(undefined, {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(new Date(value));
	}
</script>

<section class="flex min-h-[calc(100dvh-3.5rem)] flex-col gap-4 p-4">
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div>
			<h1 class="text-lg font-semibold">Admin</h1>
			<p class="text-sm text-muted-foreground">
				Users, workspaces, sessions, history, and settings.
			</p>
		</div>
		<Button href="/settings" variant="outline">
			<Settings2 class="size-4" />
			App settings
		</Button>
	</div>

	<div class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
		{@render MetricCard({
			icon: Users,
			label: 'Users',
			value: overview.users.length,
			detail: 'Accounts'
		})}
		{@render MetricCard({
			icon: FolderKanban,
			label: 'Workspaces',
			value: overview.workspaces.length,
			detail: 'Host folders'
		})}
		{@render MetricCard({
			icon: SquareTerminal,
			label: 'Live SSH',
			value: activeLiveSessions,
			detail: 'Attachable'
		})}
		{@render MetricCard({
			icon: Activity,
			label: 'Failures',
			value: failedConnections,
			detail: 'Recent history'
		})}
	</div>

	{#if notice}
		<Alert.Root>
			<BadgeCheck class="size-4" />
			<Alert.Title>{notice}</Alert.Title>
			<Alert.Description>The admin overview has been refreshed.</Alert.Description>
		</Alert.Root>
	{/if}

	{#if error}
		<Alert.Root variant="destructive">
			<Ban class="size-4" />
			<Alert.Title>Admin operation failed</Alert.Title>
			<Alert.Description>{error}</Alert.Description>
		</Alert.Root>
	{/if}

	<Tabs.Root bind:value={activeTab} class="min-h-0">
		<Tabs.List class="max-w-full flex-wrap justify-start">
			<Tabs.Trigger value="users"><Users class="size-4" />Users</Tabs.Trigger>
			<Tabs.Trigger value="workspaces"><FolderKanban class="size-4" />Workspaces</Tabs.Trigger>
			<Tabs.Trigger value="live"><SquareTerminal class="size-4" />Live sessions</Tabs.Trigger>
			<Tabs.Trigger value="history"><Clock3 class="size-4" />History</Tabs.Trigger>
			<Tabs.Trigger value="settings"><Settings2 class="size-4" />Settings</Tabs.Trigger>
		</Tabs.List>

		<Tabs.Content value="users">
			{@render UsersTable({ overview, pendingAction, promoteUser, disableUser })}
		</Tabs.Content>

		<Tabs.Content value="workspaces">
			{@render WorkspacesTable({ workspaces: overview.workspaces })}
		</Tabs.Content>

		<Tabs.Content value="live">
			{@render LiveSessionsTable({
				sessions: overview.liveSshSessions,
				pendingAction,
				terminateSession
			})}
		</Tabs.Content>

		<Tabs.Content value="history">
			{@render ConnectionHistoryTable({ sessions: overview.connectionHistory })}
		</Tabs.Content>

		<Tabs.Content value="settings">
			{@render SettingsSummary({ overview })}
		</Tabs.Content>
	</Tabs.Root>
</section>

{#snippet MetricCard({
	icon: Icon,
	label,
	value,
	detail
}: {
	icon: Component;
	label: string;
	value: number;
	detail: string;
})}
	<Card.Root>
		<Card.Content class="flex items-center justify-between gap-3 p-4">
			<div class="min-w-0">
				<p class="text-sm text-muted-foreground">{label}</p>
				<p class="text-2xl font-semibold tabular-nums">{value}</p>
				<p class="text-xs text-muted-foreground">{detail}</p>
			</div>
			<span
				class="grid size-10 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground"
			>
				<Icon class="size-5" />
			</span>
		</Card.Content>
	</Card.Root>
{/snippet}

{#snippet UsersTable({
	overview,
	pendingAction,
	promoteUser,
	disableUser
}: {
	overview: AdminOverview;
	pendingAction: string | null;
	promoteUser: (user: AdminUserSummary) => Promise<void>;
	disableUser: (user: AdminUserSummary) => Promise<void>;
})}
	<Card.Root>
		<Card.Header>
			<Card.Title>User operations</Card.Title>
			<Card.Description>{overview.users.length} account records</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			<form
				class="grid gap-3 rounded-md border bg-muted/20 p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto]"
				onsubmit={(event) => {
					event.preventDefault();
					void createUser();
				}}
			>
				<div class="grid gap-2">
					<Label for="admin-create-username">Username</Label>
					<Input
						id="admin-create-username"
						bind:value={createUsername}
						autocomplete="username"
						placeholder="operator"
						required
					/>
				</div>
				<div class="grid gap-2">
					<Label for="admin-create-password">Password</Label>
					<Input
						id="admin-create-password"
						type="password"
						bind:value={createPassword}
						autocomplete="new-password"
						minlength={8}
						required
					/>
				</div>
				<label
					class="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2 text-sm md:self-end"
				>
					<span class="font-medium">Admin</span>
					<Switch bind:checked={createAsAdmin} aria-label="Create as admin" />
				</label>
				<Button type="submit" class="md:self-end" disabled={pendingAction === 'create:user'}>
					<Users class="size-4" />
					Create
				</Button>
			</form>

			<div class="overflow-x-auto">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>User</Table.Head>
							<Table.Head>Role</Table.Head>
							<Table.Head>Inventory</Table.Head>
							<Table.Head>Sessions</Table.Head>
							<Table.Head>Last seen</Table.Head>
							<Table.Head class="text-right">Actions</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each overview.users as user (user.id)}
							<Table.Row>
								<Table.Cell>
									<div class="font-medium">{user.username}</div>
									<div class="text-xs text-muted-foreground">
										{user.identityEmails[0] ?? shortId(user.id)}
									</div>
								</Table.Cell>
								<Table.Cell>
									<div class="flex flex-wrap gap-1">
										<Badge variant={user.isAdmin ? 'default' : 'secondary'}>
											{#if user.isAdmin}<ShieldCheck class="size-3" />{:else}<Shield
													class="size-3"
												/>{/if}
											{user.isAdmin ? 'Admin' : 'User'}
										</Badge>
										{#if user.disabled}
											<Badge variant="destructive"><Ban class="size-3" />Disabled</Badge>
										{/if}
									</div>
								</Table.Cell>
								<Table.Cell>
									<div class="text-sm">{user.hostCount} hosts</div>
									<div class="text-xs text-muted-foreground">
										{user.credentialCount} credentials
									</div>
								</Table.Cell>
								<Table.Cell>
									<div class="text-sm">{user.activeAppSessions} app</div>
									<div class="text-xs text-muted-foreground">
										{user.liveSshSessionCount} live SSH
									</div>
								</Table.Cell>
								<Table.Cell>{formatDate(user.lastSeenAt)}</Table.Cell>
								<Table.Cell>
									<div class="flex justify-end gap-2">
										<Button
											size="sm"
											variant="outline"
											disabled={user.isAdmin ||
												user.disabled ||
												pendingAction === `promote:${user.id}`}
											onclick={() => promoteUser(user)}
										>
											<ShieldCheck class="size-4" />
											Promote
										</Button>
										<Button
											size="sm"
											variant="destructive"
											disabled={user.disabled || pendingAction === `disable:${user.id}`}
											title="Disable user and revoke active app sessions"
											onclick={() => disableUser(user)}
										>
											<Ban class="size-4" />
											Disable
										</Button>
									</div>
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>
		</Card.Content>
	</Card.Root>
{/snippet}

{#snippet WorkspacesTable({ workspaces }: { workspaces: AdminWorkspaceSummary[] })}
	<Card.Root>
		<Card.Header>
			<Card.Title>Workspace inventory</Card.Title>
			<Card.Description>{workspaces.length} shared workspaces</Card.Description>
		</Card.Header>
		<Card.Content class="overflow-x-auto">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Workspace</Table.Head>
						<Table.Head>Owner</Table.Head>
						<Table.Head>Hosts</Table.Head>
						<Table.Head>Credentials</Table.Head>
						<Table.Head>Live SSH</Table.Head>
						<Table.Head>Updated</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each workspaces as workspace (workspace.id)}
						<Table.Row>
							<Table.Cell>
								<div class="font-medium">{workspace.name}</div>
								<div class="text-xs text-muted-foreground">Shared workspace</div>
							</Table.Cell>
							<Table.Cell>{workspace.ownerUsername}</Table.Cell>
							<Table.Cell>
								<div class="flex flex-wrap gap-1">
									<Badge variant="outline">{workspace.sshHosts} SSH</Badge>
									<Badge variant="outline">{workspace.rdpHosts} RDP</Badge>
									<Badge variant="outline">{workspace.vncHosts} VNC</Badge>
									<Badge variant="outline">{workspace.telnetHosts} Telnet</Badge>
								</div>
							</Table.Cell>
							<Table.Cell>
								<div>{workspace.credentialCount} credentials</div>
								<div class="text-xs text-muted-foreground">{workspace.memberCount} members</div>
							</Table.Cell>
							<Table.Cell>{workspace.activeLiveSshSessions}</Table.Cell>
							<Table.Cell>{formatDate(workspace.updatedAt)}</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
	</Card.Root>
{/snippet}

{#snippet LiveSessionsTable({
	sessions,
	pendingAction,
	terminateSession
}: {
	sessions: AdminLiveSshSessionSummary[];
	pendingAction: string | null;
	terminateSession: (session: AdminLiveSshSessionSummary) => Promise<void>;
})}
	<Card.Root>
		<Card.Header>
			<Card.Title>Live SSH sessions</Card.Title>
			<Card.Description>{sessions.length} visible terminal sessions</Card.Description>
		</Card.Header>
		<Card.Content class="overflow-x-auto">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Session</Table.Head>
						<Table.Head>User</Table.Head>
						<Table.Head>Host</Table.Head>
						<Table.Head>Status</Table.Head>
						<Table.Head>Updated</Table.Head>
						<Table.Head class="text-right">Actions</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each sessions as session (session.id)}
						<Table.Row>
							<Table.Cell>
								<div class="font-medium">{session.title}</div>
								<div class="text-xs text-muted-foreground">{shortId(session.id)}</div>
							</Table.Cell>
							<Table.Cell>{session.username}</Table.Cell>
							<Table.Cell>
								<div>{session.hostName}</div>
								<div class="text-xs text-muted-foreground">{session.hostname}</div>
							</Table.Cell>
							<Table.Cell>
								<Badge variant={statusVariant(session.status)}>{session.status}</Badge>
							</Table.Cell>
							<Table.Cell>{formatDate(session.updatedAt)}</Table.Cell>
							<Table.Cell>
								<div class="flex justify-end">
									<Button
										size="sm"
										variant="destructive"
										disabled={!session.canTerminate || pendingAction === `terminate:${session.id}`}
										onclick={() => terminateSession(session)}
									>
										<SquareTerminal class="size-4" />
										Terminate
									</Button>
								</div>
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
	</Card.Root>
{/snippet}

{#snippet ConnectionHistoryTable({ sessions }: { sessions: AdminConnectionHistoryEntry[] })}
	<Card.Root>
		<Card.Header>
			<Card.Title>Connection history</Card.Title>
			<Card.Description>{sessions.length} recent connection records</Card.Description>
		</Card.Header>
		<Card.Content class="overflow-x-auto">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Connection</Table.Head>
						<Table.Head>User</Table.Head>
						<Table.Head>Protocol</Table.Head>
						<Table.Head>Status</Table.Head>
						<Table.Head>Started</Table.Head>
						<Table.Head>Ended</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each sessions as session (session.id)}
						<Table.Row>
							<Table.Cell>
								<div class="font-medium">{session.hostName ?? 'Direct launch'}</div>
								<div class="text-xs text-muted-foreground">
									{session.hostname ?? shortId(session.id)}
								</div>
							</Table.Cell>
							<Table.Cell>{session.username}</Table.Cell>
							<Table.Cell>
								<Badge variant="outline"><Cable class="size-3" />{session.protocol}</Badge>
							</Table.Cell>
							<Table.Cell>
								<Badge variant={statusVariant(session.status)}>{session.status}</Badge>
								{#if session.errorCode}
									<div class="mt-1 text-xs text-destructive">{session.errorCode}</div>
								{/if}
							</Table.Cell>
							<Table.Cell>{formatDate(session.startedAt)}</Table.Cell>
							<Table.Cell>{formatDate(session.endedAt)}</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
	</Card.Root>
{/snippet}

{#snippet SettingsSummary({ overview }: { overview: AdminOverview })}
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
{/snippet}

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
