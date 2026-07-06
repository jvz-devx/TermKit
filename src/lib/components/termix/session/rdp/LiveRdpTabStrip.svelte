<script lang="ts">
	import { Check, Monitor, Pencil, Plus, Radio, RotateCcw, Unplug, X } from '@lucide/svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import type { LiveRdpSessionSummary } from '$lib/remotes/sessions.remote';
	import { failureCopy, failureDetail } from '$lib/termix/failure-copy';

	type LiveRdpStatus = LiveRdpSessionSummary['status'];

	function statusLabel(status: LiveRdpStatus) {
		if (status === 'active') return 'Active';
		if (status === 'detached') return 'Detached';
		if (status === 'ended') return 'Ended';
		return 'Failed';
	}

	function statusDetail(session: LiveRdpSessionSummary) {
		if (session.status === 'active') return 'RDP tab is ready to reconnect.';
		if (session.status === 'detached') return 'RDP tab is saved and can be reconnected.';
		if (session.status === 'ended') return 'RDP tab has ended.';
		return failureDetail(
			failureCopy({ protocol: 'rdp', code: session.errorCode, message: session.errorMessage })
		);
	}

	function canAttach(session: LiveRdpSessionSummary) {
		return session.status === 'active' || session.status === 'detached';
	}

	function tabClasses(session: LiveRdpSessionSummary, active: boolean) {
		return [
			'group flex h-9 max-w-80 shrink-0 items-center gap-1 rounded-md border px-1.5 transition-colors',
			active
				? 'border-primary bg-primary/10 shadow-[inset_0_2px_0_var(--primary)]'
				: 'border-border bg-background hover:bg-muted/40',
			session.status === 'failed' && !active && 'border-destructive/45 bg-destructive/5',
			session.status === 'ended' && !active && 'opacity-75'
		];
	}

	function statusClasses(status: LiveRdpStatus) {
		if (status === 'active') return 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700';
		if (status === 'detached') return 'border-sky-500/35 bg-sky-500/10 text-sky-700';
		if (status === 'failed') return 'border-destructive/40 bg-destructive/10 text-destructive';
		return 'border-muted-foreground/30 bg-muted text-muted-foreground';
	}

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
		sessions: LiveRdpSessionSummary[];
		activeSessionId?: string | null;
		currentHostId?: string | null;
		busy?: boolean;
		onCreate: () => void;
		onAttach: (session: LiveRdpSessionSummary) => void;
		onRename: (session: LiveRdpSessionSummary, title: string) => void;
		onClose: (session: LiveRdpSessionSummary) => void;
	} = $props();

	let editingSessionId = $state<string | null>(null);
	let draftTitle = $state('');
	let visibleSessions = $derived(sessions.filter(canAttach));

	function beginRename(session: LiveRdpSessionSummary) {
		editingSessionId = session.id;
		draftTitle = session.title;
	}

	function commitRename(session: LiveRdpSessionSummary) {
		const title = draftTitle.trim();
		editingSessionId = null;
		if (title && title !== session.title) onRename(session, title);
	}
</script>

<Tooltip.Provider>
	<div class="flex min-h-11 items-center gap-2 overflow-x-auto border-b bg-muted/20 px-2 py-1.5">
		{#if currentHostId}
			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							size="sm"
							class="h-8 shrink-0 gap-2"
							disabled={busy}
							aria-label="Create persistent RDP session"
							onclick={onCreate}
						>
							<Plus data-icon="inline-start" />
							RDP session
						</Button>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content sideOffset={6}>Create persistent RDP session</Tooltip.Content>
			</Tooltip.Root>
		{/if}

		<div
			class="flex min-w-0 flex-1 items-center gap-1"
			role="tablist"
			aria-label="Persistent RDP sessions"
		>
			{#each visibleSessions as session (session.id)}
				{@const active = activeSessionId === session.id}
				{@const attachable = canAttach(session)}
				<div class={tabClasses(session, active)} data-active={active} role="presentation">
					{#if editingSessionId === session.id}
						<Input
							class="h-6 w-36 px-2 text-xs"
							bind:value={draftTitle}
							aria-label={`Rename ${session.title}`}
							onkeydown={(event) => {
								if (event.key === 'Enter') commitRename(session);
								if (event.key === 'Escape') editingSessionId = null;
							}}
						/>
						<Tooltip.Root>
							<Tooltip.Trigger>
								{#snippet child({ props })}
									<Button
										{...props}
										size="icon-xs"
										variant="ghost"
										aria-label={`Save name for ${session.title}`}
										onclick={() => commitRename(session)}
									>
										<Check class="size-3.5" />
									</Button>
								{/snippet}
							</Tooltip.Trigger>
							<Tooltip.Content sideOffset={6}>Save name</Tooltip.Content>
						</Tooltip.Root>
					{:else}
						<Tooltip.Root>
							<Tooltip.Trigger>
								{#snippet child({ props })}
									<Button
										{...props}
										size="sm"
										variant={active ? 'secondary' : 'ghost'}
										class="h-7 min-w-0 gap-1.5 px-2"
										disabled={busy || !attachable}
										role="tab"
										aria-selected={active}
										aria-label={`${active ? 'Active' : 'Reconnect'} RDP session ${session.title}. Status: ${statusLabel(session.status)}.`}
										onclick={() => onAttach(session)}
									>
										<span
											class={[
												'size-2 shrink-0 rounded-full',
												session.status === 'active' && 'bg-emerald-500',
												session.status === 'detached' && 'bg-sky-500',
												session.status === 'failed' && 'bg-destructive',
												session.status === 'ended' && 'bg-muted-foreground/60'
											]}
											aria-hidden="true"
										></span>
										<span class="truncate text-xs font-medium">{session.title}</span>
									</Button>
								{/snippet}
							</Tooltip.Trigger>
							<Tooltip.Content sideOffset={6}>
								{active ? 'Active session' : attachable ? 'Reconnect RDP session' : 'Unavailable'}
							</Tooltip.Content>
						</Tooltip.Root>

						<Tooltip.Root>
							<Tooltip.Trigger>
								<Badge
									variant="outline"
									class={[
										'h-5 gap-1 px-1.5 text-[10px] leading-none',
										statusClasses(session.status)
									]}
									aria-label={`RDP session status: ${statusLabel(session.status)}`}
								>
									{#if session.status === 'active'}
										<Radio class="size-3" aria-hidden="true" />
									{:else if session.status === 'detached'}
										<Unplug class="size-3" aria-hidden="true" />
									{:else if session.status === 'failed'}
										<RotateCcw class="size-3" aria-hidden="true" />
									{:else}
										<Monitor class="size-3" aria-hidden="true" />
									{/if}
									{statusLabel(session.status)}
								</Badge>
							</Tooltip.Trigger>
							<Tooltip.Content sideOffset={6}>{statusDetail(session)}</Tooltip.Content>
						</Tooltip.Root>

						{#if session.hostId !== currentHostId}
							<Badge
								variant="outline"
								class="hidden h-5 max-w-28 px-1.5 text-[10px] sm:inline-flex"
							>
								<span class="truncate">{session.hostName}</span>
							</Badge>
						{/if}

						<Tooltip.Root>
							<Tooltip.Trigger>
								{#snippet child({ props })}
									<Button
										{...props}
										size="icon-xs"
										variant="ghost"
										class="opacity-70 hover:opacity-100"
										aria-label={`Rename RDP session ${session.title}`}
										onclick={() => beginRename(session)}
									>
										<Pencil class="size-3.5" />
									</Button>
								{/snippet}
							</Tooltip.Trigger>
							<Tooltip.Content sideOffset={6}>Rename session</Tooltip.Content>
						</Tooltip.Root>
					{/if}

					<Tooltip.Root>
						<Tooltip.Trigger>
							{#snippet child({ props })}
								<Button
									{...props}
									size="icon-xs"
									variant="ghost"
									class="opacity-70 hover:opacity-100"
									aria-label={`Close RDP session ${session.title}`}
									disabled={busy}
									onclick={() => onClose(session)}
								>
									<X class="size-3.5" />
								</Button>
							{/snippet}
						</Tooltip.Trigger>
						<Tooltip.Content sideOffset={6}>Close session</Tooltip.Content>
					</Tooltip.Root>
				</div>
			{:else}
				<span class="px-2 text-xs text-muted-foreground">No persistent RDP sessions</span>
			{/each}
		</div>
	</div>
</Tooltip.Provider>
