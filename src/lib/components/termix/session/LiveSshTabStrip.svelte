<script lang="ts">
	import { Check, Pencil, Plus, X } from '@lucide/svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import type { LiveSshSessionSummary } from '$lib/termix.remote';

	let {
		sessions,
		activeSessionId = null,
		currentHostId = null,
		busy = false,
		onCreate,
		onAttach,
		onRename,
		onClose
	}: {
		sessions: LiveSshSessionSummary[];
		activeSessionId?: string | null;
		currentHostId?: string | null;
		busy?: boolean;
		onCreate: () => void;
		onAttach: (session: LiveSshSessionSummary) => void;
		onRename: (session: LiveSshSessionSummary, title: string) => void;
		onClose: (session: LiveSshSessionSummary) => void;
	} = $props();

	let editingSessionId = $state<string | null>(null);
	let draftTitle = $state('');
	let visibleSessions = $derived.by(() =>
		sessions.filter((session) =>
			['starting', 'attached', 'detached', 'stale'].includes(session.status)
		)
	);

	function beginRename(session: LiveSshSessionSummary) {
		editingSessionId = session.id;
		draftTitle = session.title;
	}

	function commitRename(session: LiveSshSessionSummary) {
		const title = draftTitle.trim();
		editingSessionId = null;
		if (title && title !== session.title) onRename(session, title);
	}
</script>

<div class="flex min-h-11 items-center gap-2 overflow-x-auto border-b bg-muted/20 px-2 py-1.5">
	<Button size="sm" class="shrink-0 gap-2" disabled={!currentHostId || busy} onclick={onCreate}>
		<Plus class="size-4" />
		SSH tab
	</Button>

	<div class="flex min-w-0 flex-1 items-center gap-1">
		{#each visibleSessions as session (session.id)}
			<div
				class="group flex h-8 max-w-72 shrink-0 items-center gap-1 rounded-md border bg-background px-1.5 data-[active=true]:border-primary data-[active=true]:bg-primary/5"
				data-active={activeSessionId === session.id}
			>
				{#if editingSessionId === session.id}
					<Input
						class="h-6 w-32 px-2 text-xs"
						bind:value={draftTitle}
						onkeydown={(event) => {
							if (event.key === 'Enter') commitRename(session);
							if (event.key === 'Escape') editingSessionId = null;
						}}
					/>
					<Button
						size="icon"
						variant="ghost"
						class="size-6"
						aria-label="Save SSH tab name"
						onclick={() => commitRename(session)}
					>
						<Check class="size-3.5" />
					</Button>
				{:else}
					<Button
						size="sm"
						variant="ghost"
						class="h-6 min-w-0 gap-1 px-1.5"
						disabled={busy}
						onclick={() => onAttach(session)}
					>
						<span class="truncate text-xs">{session.title}</span>
						{#if session.hostId !== currentHostId}
							<Badge variant="outline" class="h-5 px-1 text-[10px]">{session.hostName}</Badge>
						{/if}
					</Button>
					<Button
						size="icon"
						variant="ghost"
						class="size-6 opacity-70 hover:opacity-100"
						aria-label="Rename SSH tab"
						onclick={() => beginRename(session)}
					>
						<Pencil class="size-3.5" />
					</Button>
				{/if}
				<Button
					size="icon"
					variant="ghost"
					class="size-6 opacity-70 hover:opacity-100"
					aria-label="Close SSH tab"
					disabled={busy}
					onclick={() => onClose(session)}
				>
					<X class="size-3.5" />
				</Button>
			</div>
		{:else}
			<span class="px-2 text-xs text-muted-foreground">No persistent SSH tabs</span>
		{/each}
	</div>
</div>
