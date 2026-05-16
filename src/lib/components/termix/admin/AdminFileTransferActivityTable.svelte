<script lang="ts">
	import { Server } from '@lucide/svelte';
	import type { AdminFileTransferActivitySummary } from '$lib/admin.remote';
	import type { BadgeVariant } from '$lib/components/ui/badge';
	import { Badge } from '$lib/components/ui/badge';
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import { adminProtocolLabel, formatAdminDuration } from './admin-visibility';

	let {
		sessions,
		statusVariant,
		formatDate,
		shortId
	}: {
		sessions: AdminFileTransferActivitySummary[];
		statusVariant: (status: string) => BadgeVariant;
		formatDate: (value: string | null) => string;
		shortId: (id: string) => string;
	} = $props();
</script>

<Card.Root>
	<Card.Header
		><Card.Title>FTP/FTPS activity</Card.Title><Card.Description
			>{sessions.length} active transfer sessions</Card.Description
		></Card.Header
	>
	<Card.Content class="overflow-x-auto"
		><Table.Root
			><Table.Header
				><Table.Row
					><Table.Head>Session</Table.Head><Table.Head>User</Table.Head><Table.Head
						>Protocol</Table.Head
					><Table.Head>Status</Table.Head><Table.Head>Runtime</Table.Head><Table.Head
						>Updated</Table.Head
					></Table.Row
				></Table.Header
			><Table.Body>
				{#each sessions as session (session.id)}<Table.Row
						><Table.Cell
							><div class="font-medium">{session.hostName ?? 'Direct transfer'}</div>
							<div class="text-xs text-muted-foreground">
								{session.hostname ?? shortId(session.id)}
							</div></Table.Cell
						><Table.Cell>{session.username}</Table.Cell><Table.Cell
							><Badge variant="outline"
								><Server class="size-3" />{adminProtocolLabel(session.protocol)}</Badge
							></Table.Cell
						><Table.Cell
							><Badge variant={statusVariant(session.status)}>{session.status}</Badge></Table.Cell
						><Table.Cell>{formatAdminDuration(session.durationMs)}</Table.Cell><Table.Cell
							>{formatDate(session.updatedAt)}</Table.Cell
						></Table.Row
					>{:else}<Table.Row
						><Table.Cell colspan={6} class="text-sm text-muted-foreground"
							>No active FTP or FTPS sessions.</Table.Cell
						></Table.Row
					>{/each}
			</Table.Body></Table.Root
		></Card.Content
	>
</Card.Root>
