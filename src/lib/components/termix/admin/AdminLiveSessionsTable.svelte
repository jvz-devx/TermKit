<script lang="ts">
	import { SquareTerminal } from '@lucide/svelte';
	import type { AdminLiveSshSessionSummary } from '$lib/remotes/admin.remote';
	import type { BadgeVariant } from '$lib/components/ui/badge';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';

	let {
		sessions,
		pendingAction,
		terminateSession,
		statusVariant,
		formatDate,
		shortId
	}: {
		sessions: AdminLiveSshSessionSummary[];
		pendingAction: string | null;
		terminateSession: (session: AdminLiveSshSessionSummary) => Promise<void>;
		statusVariant: (status: string) => BadgeVariant;
		formatDate: (value: string | null) => string;
		shortId: (id: string) => string;
	} = $props();
</script>

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
