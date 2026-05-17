<script lang="ts">
	import { Cable } from '@lucide/svelte';
	import type { AdminConnectionHistoryEntry } from '$lib/remotes/admin.remote';
	import type { BadgeVariant } from '$lib/components/ui/badge';
	import { Badge } from '$lib/components/ui/badge';
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import { adminFailureDetail, adminFailureTitle, adminProtocolLabel } from './admin-visibility';

	let {
		sessions,
		statusVariant,
		formatDate,
		shortId
	}: {
		sessions: AdminConnectionHistoryEntry[];
		statusVariant: (status: string) => BadgeVariant;
		formatDate: (value: string | null) => string;
		shortId: (id: string) => string;
	} = $props();
</script>

<Card.Root>
	<Card.Header
		><Card.Title>Connection history</Card.Title><Card.Description
			>{sessions.length} recent connection records</Card.Description
		></Card.Header
	>
	<Card.Content class="overflow-x-auto"
		><Table.Root
			><Table.Header
				><Table.Row
					><Table.Head>Connection</Table.Head><Table.Head>User</Table.Head><Table.Head
						>Protocol</Table.Head
					><Table.Head>Status</Table.Head><Table.Head>Started</Table.Head><Table.Head
						>Ended</Table.Head
					></Table.Row
				></Table.Header
			><Table.Body>
				{#each sessions as session (session.id)}<Table.Row
						><Table.Cell
							><div class="font-medium">{session.hostName ?? 'Direct launch'}</div>
							<div class="text-xs text-muted-foreground">
								{session.hostname ?? shortId(session.id)}
							</div></Table.Cell
						><Table.Cell>{session.username}</Table.Cell><Table.Cell
							><Badge variant="outline"
								><Cable class="size-3" />{adminProtocolLabel(session.protocol)}</Badge
							></Table.Cell
						><Table.Cell
							><Badge variant={statusVariant(session.status)}>{session.status}</Badge
							>{#if session.failureReason || session.errorCode}<div
									class="mt-1 text-xs text-destructive"
								>
									{adminFailureTitle(session.failureReason, session.errorCode)}
								</div>
								{#if adminFailureDetail(session.failureReason, session.errorCode)}<div
										class="text-xs text-muted-foreground"
									>
										{adminFailureDetail(session.failureReason, session.errorCode)}
									</div>{/if}{/if}</Table.Cell
						><Table.Cell>{formatDate(session.startedAt)}</Table.Cell><Table.Cell
							>{formatDate(session.endedAt)}</Table.Cell
						></Table.Row
					>{/each}
			</Table.Body></Table.Root
		></Card.Content
	>
</Card.Root>
