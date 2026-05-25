<script lang="ts">
	import {
		Activity,
		BadgeCheck,
		Ban,
		Cable,
		MailPlus,
		Server,
		Settings2,
		Shield,
		ShieldCheck,
		SquareTerminal,
		Users
	} from '@lucide/svelte';
	import { page } from '$app/state';
	import {
		createAdminMicrosoftInvitation,
		createAdminUser,
		disableAdminUser,
		getAdminOverview,
		promoteAdminUser,
		revokeAdminMicrosoftInvitation,
		terminateAdminLiveSshSession,
		terminateAdminSshTunnelSession,
		type AdminMicrosoftInvitationSummary,
		type AdminLiveSshSessionSummary,
		type AdminOverview,
		type AdminSshTunnelSummary,
		type AdminUserSummary
	} from '$lib/remotes/admin.remote';
	import * as Alert from '$lib/components/ui/alert';
	import { Badge, type BadgeVariant } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import * as Table from '$lib/components/ui/table';
	import * as Tabs from '$lib/components/ui/tabs';
	import AdminConnectionHistoryTable from './AdminConnectionHistoryTable.svelte';
	import AdminFileTransferActivityTable from './AdminFileTransferActivityTable.svelte';
	import AdminLiveSessionsTable from './AdminLiveSessionsTable.svelte';
	import AdminMetricCard from './AdminMetricCard.svelte';
	import AdminSshTunnelsTable from './AdminSshTunnelsTable.svelte';
	import AdminSettingsSummary from './AdminSettingsSummary.svelte';
	import AdminTabsList from './AdminTabsList.svelte';

	const adminTabs = ['users', 'live', 'tunnels', 'transfers', 'history', 'settings'] as const;
	type AdminTab = (typeof adminTabs)[number];

	const overviewQuery = getAdminOverview();
	const initialOverview = await overviewQuery;

	let activeTab = $state<AdminTab>(validAdminTab(page.url.searchParams.get('tab')));
	let pendingAction = $state<string | null>(null);
	let notice = $state<string | null>(null);
	let error = $state<string | null>(null);
	let createUsername = $state('');
	let createPassword = $state('');
	let createAsAdmin = $state(false);
	let inviteEmail = $state('');
	let inviteAsAdmin = $state(false);

	const overview = $derived(overviewQuery.current ?? initialOverview);
	const activeLiveSessions = $derived(
		overview.liveSshSessions.filter((session) => session.canTerminate).length
	);
	const activeSshTunnels = $derived(
		overview.sshTunnels.filter((session) => session.canTerminate).length
	);
	const activeFileTransfers = $derived(overview.fileTransferActivity.length);
	const failedConnections = $derived(
		overview.connectionHistory.filter((session) => session.status === 'failed').length
	);

	function validAdminTab(value: string | null): AdminTab {
		return adminTabs.includes(value as AdminTab) ? (value as AdminTab) : 'users';
	}

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

	async function createInvitation() {
		await runAction('create:microsoft-invitation', `Invited ${inviteEmail.trim()}.`, async () => {
			await createAdminMicrosoftInvitation({
				email: inviteEmail,
				isAdmin: inviteAsAdmin
			}).updates(getAdminOverview);
			inviteEmail = '';
			inviteAsAdmin = false;
		});
	}

	async function revokeInvitation(invitation: AdminMicrosoftInvitationSummary) {
		await runAction(
			`revoke:microsoft-invitation:${invitation.id}`,
			`Revoked ${invitation.email}.`,
			() => revokeAdminMicrosoftInvitation(invitation.id).updates(getAdminOverview)
		);
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

	async function terminateTunnel(session: AdminSshTunnelSummary) {
		await runAction(`terminate:tunnel:${session.id}`, 'Terminated SSH tunnel.', () =>
			terminateAdminSshTunnelSession(session.id).updates(getAdminOverview)
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
			<p class="text-sm text-muted-foreground">Users, sessions, history, and settings.</p>
		</div>
		<Button href="/settings" variant="outline">
			<Settings2 class="size-4" />
			App settings
		</Button>
	</div>

	<div class="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
		<AdminMetricCard icon={Users} label="Users" value={overview.users.length} detail="Accounts" />
		<AdminMetricCard
			icon={SquareTerminal}
			label="Live SSH"
			value={activeLiveSessions}
			detail="Attachable"
		/>
		<AdminMetricCard icon={Cable} label="SSH tunnels" value={activeSshTunnels} detail="Active" />
		<AdminMetricCard icon={Server} label="FTP/FTPS" value={activeFileTransfers} detail="Running" />
		<AdminMetricCard
			icon={Activity}
			label="Failures"
			value={failedConnections}
			detail="Recent history"
		/>
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
		<AdminTabsList />

		<Tabs.Content value="users">
			{@render UsersTable({ overview, pendingAction, promoteUser, disableUser, revokeInvitation })}
		</Tabs.Content>

		<Tabs.Content value="live">
			<AdminLiveSessionsTable
				sessions={overview.liveSshSessions}
				{pendingAction}
				{terminateSession}
				{statusVariant}
				{formatDate}
				{shortId}
			/>
		</Tabs.Content>

		<Tabs.Content value="tunnels">
			<AdminSshTunnelsTable
				sessions={overview.sshTunnels}
				{pendingAction}
				{terminateTunnel}
				{statusVariant}
				{formatDate}
				{shortId}
			/>
		</Tabs.Content>

		<Tabs.Content value="transfers">
			<AdminFileTransferActivityTable
				sessions={overview.fileTransferActivity}
				{statusVariant}
				{formatDate}
				{shortId}
			/>
		</Tabs.Content>

		<Tabs.Content value="history">
			<AdminConnectionHistoryTable
				sessions={overview.connectionHistory}
				{statusVariant}
				{formatDate}
				{shortId}
			/>
		</Tabs.Content>

		<Tabs.Content value="settings">
			<AdminSettingsSummary {overview} />
		</Tabs.Content>
	</Tabs.Root>
</section>

{#snippet UsersTable({
	overview,
	pendingAction,
	promoteUser,
	disableUser,
	revokeInvitation
}: {
	overview: AdminOverview;
	pendingAction: string | null;
	promoteUser: (user: AdminUserSummary) => Promise<void>;
	disableUser: (user: AdminUserSummary) => Promise<void>;
	revokeInvitation: (invitation: AdminMicrosoftInvitationSummary) => Promise<void>;
})}
	<Card.Root>
		<Card.Header>
			<Card.Title>User operations</Card.Title>
			<Card.Description>
				{overview.users.length} account records, {overview.microsoftInvitations.length} Microsoft invites
			</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			<form
				class="grid gap-3 rounded-md border bg-muted/20 p-3 md:grid-cols-[minmax(0,1fr)_auto_auto]"
				onsubmit={(event) => {
					event.preventDefault();
					void createInvitation();
				}}
			>
				<div class="grid gap-2">
					<Label for="admin-invite-email">Microsoft email</Label>
					<Input
						id="admin-invite-email"
						type="email"
						bind:value={inviteEmail}
						autocomplete="email"
						placeholder="operator@example.com"
						required
					/>
				</div>
				<label
					class="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2 text-sm md:self-end"
				>
					<span class="font-medium">Admin</span>
					<Switch bind:checked={inviteAsAdmin} aria-label="Invite as admin" />
				</label>
				<Button
					type="submit"
					class="md:self-end"
					disabled={pendingAction === 'create:microsoft-invitation'}
				>
					<MailPlus class="size-4" />
					Invite
				</Button>
			</form>

			{#if overview.microsoftInvitations.length > 0}
				<div class="overflow-x-auto">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Microsoft invite</Table.Head>
								<Table.Head>Status</Table.Head>
								<Table.Head>Created</Table.Head>
								<Table.Head>Accepted by</Table.Head>
								<Table.Head class="text-right">Actions</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each overview.microsoftInvitations as invitation (invitation.id)}
								<Table.Row>
									<Table.Cell>
										<div class="font-medium">{invitation.email}</div>
										<div class="text-xs text-muted-foreground">
											{invitation.invitedByUsername ?? shortId(invitation.id)}
										</div>
									</Table.Cell>
									<Table.Cell>
										<div class="flex flex-wrap gap-1">
											<Badge
												variant={invitation.status === 'revoked'
													? 'destructive'
													: invitation.status === 'accepted'
														? 'secondary'
														: 'default'}
											>
												{invitation.status}
											</Badge>
											{#if invitation.isAdmin}
												<Badge variant="outline"><ShieldCheck class="size-3" />Admin</Badge>
											{/if}
										</div>
									</Table.Cell>
									<Table.Cell>{formatDate(invitation.createdAt)}</Table.Cell>
									<Table.Cell>
										{invitation.acceptedUsername ?? formatDate(invitation.acceptedAt)}
									</Table.Cell>
									<Table.Cell>
										<div class="flex justify-end">
											<Button
												size="sm"
												variant="outline"
												disabled={invitation.status !== 'pending' ||
													pendingAction === `revoke:microsoft-invitation:${invitation.id}`}
												onclick={() => revokeInvitation(invitation)}
											>
												<Ban class="size-4" />
												Revoke
											</Button>
										</div>
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</div>
			{/if}

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
											title="Disable local and Microsoft login, then revoke active app sessions"
											onclick={() => disableUser(user)}
										>
											<Ban class="size-4" />
											Disable login
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
