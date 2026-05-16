<script lang="ts">
	import { Cable } from '@lucide/svelte';
	import type { AdminSshTunnelSummary } from '$lib/admin.remote';
	import type { BadgeVariant } from '$lib/components/ui/badge';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import { formatAdminDuration } from './admin-visibility';

	let {
		sessions,
		pendingAction,
		terminateTunnel,
		statusVariant,
		formatDate,
		shortId
	}: {
		sessions: AdminSshTunnelSummary[];
		pendingAction: string | null;
		terminateTunnel: (session: AdminSshTunnelSummary) => Promise<void>;
		statusVariant: (status: string) => BadgeVariant;
		formatDate: (value: string | null) => string;
		shortId: (id: string) => string;
	} = $props();
</script>

<Card.Root>
	<Card.Header
		><Card.Title>SSH tunnels</Card.Title><Card.Description
			>{sessions.length} active tunnel sessions</Card.Description
		></Card.Header
	>
	<Card.Content class="overflow-x-auto"
		><Table.Root
			><Table.Header
				><Table.Row
					><Table.Head>Tunnel</Table.Head><Table.Head>User</Table.Head><Table.Head
						>Status</Table.Head
					><Table.Head>Runtime</Table.Head><Table.Head>Updated</Table.Head><Table.Head
						class="text-right">Actions</Table.Head
					></Table.Row
				></Table.Header
			><Table.Body>
				{#each sessions as session (session.id)}<Table.Row
						><Table.Cell
							><div class="font-medium">{session.hostName ?? 'Direct tunnel'}</div>
							<div class="text-xs text-muted-foreground">
								{session.hostname ?? shortId(session.id)}
							</div></Table.Cell
						><Table.Cell>{session.username}</Table.Cell><Table.Cell
							><Badge variant={statusVariant(session.status)}>{session.status}</Badge></Table.Cell
						><Table.Cell>{formatAdminDuration(session.durationMs)}</Table.Cell><Table.Cell
							>{formatDate(session.updatedAt)}</Table.Cell
						><Table.Cell
							><div class="flex justify-end">
								<Button
									size="sm"
									variant="destructive"
									disabled={!session.canTerminate ||
										pendingAction === `terminate:tunnel:${session.id}`}
									onclick={() => terminateTunnel(session)}><Cable class="size-4" />Terminate</Button
								>
							</div></Table.Cell
						></Table.Row
					>{:else}<Table.Row
						><Table.Cell colspan={6} class="text-sm text-muted-foreground"
							>No active SSH tunnels.</Table.Cell
						></Table.Row
					>{/each}
			</Table.Body></Table.Root
		></Card.Content
	>
</Card.Root>
