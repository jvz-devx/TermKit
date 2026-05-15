<script lang="ts">
	import {
		AlertTriangle,
		Check,
		CircleDot,
		Clock3,
		Pencil,
		Plus,
		Radio,
		RotateCcw,
		Unplug,
		X
	} from '@lucide/svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import type { LiveSshSessionSummary } from '$lib/termix.remote';
	import { failureCopy, failureDetail } from '$lib/termix/failure-copy';

	type LiveSshStatus = LiveSshSessionSummary['status'];

	function statusLabel(status: LiveSshStatus) {
		if (status === 'starting') return 'Connecting';
		if (status === 'attached') return 'Attached';
		if (status === 'detached') return 'Detached';
		if (status === 'stale') return 'Stale';
		if (status === 'ended') return 'Ended';
		return 'Failed';
	}

	function statusDetail(session: LiveSshSessionSummary) {
		if (session.status === 'starting')
			return 'SSH session is connecting and will attach when ready.';
		if (session.status === 'attached') return 'SSH session is attached and streaming.';
		if (session.status === 'detached') return 'SSH session is idle and can be reattached.';
		if (session.status === 'stale')
			return 'SSH session was left behind by a previous server process.';
		if (session.status === 'ended') return 'SSH session has ended.';
		return failureDetail(
			failureCopy({ protocol: 'ssh', code: session.errorCode, message: session.errorMessage })
		);
	}

	function canAttach(session: LiveSshSessionSummary) {
		if (session.expiresAt && Date.now() >= new Date(session.expiresAt).getTime()) return false;
		return (
			session.status === 'attached' ||
			session.status === 'detached' ||
			session.status === 'starting'
		);
	}

	function tabClasses(session: LiveSshSessionSummary, active: boolean) {
		return [
			'group flex h-9 max-w-80 shrink-0 items-center gap-1 rounded-md border px-1.5 transition-colors',
			active
				? 'border-primary bg-primary/10 shadow-[inset_0_2px_0_var(--primary)]'
				: 'border-border bg-background hover:bg-muted/40',
			session.status === 'stale' && !active && 'border-amber-500/45 bg-amber-500/5',
			session.status === 'failed' && !active && 'border-destructive/45 bg-destructive/5',
			session.status === 'ended' && !active && 'opacity-75'
		];
	}

	function statusClasses(status: LiveSshStatus) {
		if (status === 'attached') return 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700';
		if (status === 'detached') return 'border-sky-500/35 bg-sky-500/10 text-sky-700';
		if (status === 'starting') return 'border-blue-500/35 bg-blue-500/10 text-blue-700';
		if (status === 'stale') return 'border-amber-500/40 bg-amber-500/10 text-amber-700';
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
	let visibleSessions = $derived(sessions.filter(canAttach));

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

<Tooltip.Provider>
	<div class="flex min-h-11 items-center gap-2 overflow-x-auto border-b bg-muted/20 px-2 py-1.5">
		<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props })}
					<Button
						{...props}
						size="sm"
						class="h-8 shrink-0 gap-2"
						disabled={!currentHostId || busy}
						aria-label="Create persistent SSH tab"
						onclick={onCreate}
					>
						<Plus class="size-4" />
						SSH tab
					</Button>
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Content sideOffset={6}>Create persistent SSH tab</Tooltip.Content>
		</Tooltip.Root>

		<div
			class="flex min-w-0 flex-1 items-center gap-1"
			role="tablist"
			aria-label="Persistent SSH tabs"
		>
			{#each visibleSessions as session (session.id)}
				{@const active = activeSessionId === session.id}
				{@const attachable = canAttach(session)}
				<div
					class={tabClasses(session, active)}
					data-active={active}
					data-live-ssh-tab-title={session.title}
					role="presentation"
				>
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
										aria-label={`${active ? 'Active' : 'Attach'} SSH tab ${session.title}. Status: ${statusLabel(session.status)}.`}
										onclick={() => onAttach(session)}
									>
										<span
											class={[
												'size-2 shrink-0 rounded-full',
												session.status === 'attached' && 'bg-emerald-500',
												session.status === 'detached' && 'bg-sky-500',
												session.status === 'starting' && 'bg-blue-500',
												session.status === 'stale' && 'bg-amber-500',
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
								{active ? 'Active tab' : attachable ? 'Attach SSH tab' : 'Unavailable SSH tab'}
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
									aria-label={`SSH tab status: ${statusLabel(session.status)}`}
								>
									{#if session.status === 'starting'}
										<Clock3 class="size-3" aria-hidden="true" />
									{:else if session.status === 'attached'}
										<Radio class="size-3" aria-hidden="true" />
									{:else if session.status === 'detached'}
										<Unplug class="size-3" aria-hidden="true" />
									{:else if session.status === 'stale'}
										<RotateCcw class="size-3" aria-hidden="true" />
									{:else if session.status === 'failed'}
										<AlertTriangle class="size-3" aria-hidden="true" />
									{:else}
										<CircleDot class="size-3" aria-hidden="true" />
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
										aria-label={`Rename SSH tab ${session.title}`}
										onclick={() => beginRename(session)}
									>
										<Pencil class="size-3.5" />
									</Button>
								{/snippet}
							</Tooltip.Trigger>
							<Tooltip.Content sideOffset={6}>Rename tab</Tooltip.Content>
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
									aria-label={`Close SSH tab ${session.title}`}
									disabled={busy}
									onclick={() => onClose(session)}
								>
									<X class="size-3.5" />
								</Button>
							{/snippet}
						</Tooltip.Trigger>
						<Tooltip.Content sideOffset={6}>Close tab</Tooltip.Content>
					</Tooltip.Root>
				</div>
			{:else}
				<span class="px-2 text-xs text-muted-foreground">No persistent SSH tabs</span>
			{/each}
		</div>
	</div>
</Tooltip.Provider>
