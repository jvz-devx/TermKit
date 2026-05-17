<script lang="ts">
	import Database from '@lucide/svelte/icons/database';
	import FolderUp from '@lucide/svelte/icons/folder-up';
	import Monitor from '@lucide/svelte/icons/monitor';
	import Network from '@lucide/svelte/icons/network';
	import RadioTower from '@lucide/svelte/icons/radio-tower';
	import Route from '@lucide/svelte/icons/route';
	import Server from '@lucide/svelte/icons/server';
	import Terminal from '@lucide/svelte/icons/terminal';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import X from '@lucide/svelte/icons/x';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Select from '$lib/components/ui/select';
	import type { HostSummary } from '$lib/remotes/sessions.remote';
	import { isSessionPaneKind, sessionPaneKinds, type SessionPaneKind } from './workspace-layout';

	const paneLabels: Record<SessionPaneKind, string> = {
		ssh: 'SSH',
		sftp: 'SFTP',
		rdp: 'RDP',
		vnc: 'VNC',
		telnet: 'Telnet',
		ftp: 'FTP',
		ftps: 'FTPS',
		'ssh-tunnel': 'SSH tunnel'
	};

	const paneIcons = {
		ssh: Terminal,
		sftp: Database,
		rdp: Monitor,
		vnc: Network,
		telnet: RadioTower,
		ftp: FolderUp,
		ftps: FolderUp,
		'ssh-tunnel': Route
	};

	let {
		paneId,
		kind,
		host,
		hosts,
		index,
		onKindChange,
		onHostChange,
		onReconnect,
		onClose
	}: {
		paneId: string;
		kind: SessionPaneKind;
		host: HostSummary | null;
		hosts: HostSummary[];
		index: number;
		onKindChange: (paneId: string, kind: SessionPaneKind) => void;
		onHostChange: (paneId: string, hostId: string) => void;
		onReconnect: (paneId: string) => void;
		onClose: (paneId: string) => void;
	} = $props();

	let Icon = $derived(paneIcons[kind]);
</script>

<header class="flex min-h-11 items-center justify-between gap-2 border-b bg-muted/20 px-2.5">
	<div class="flex min-w-0 items-center gap-2">
		<div class="flex size-7 shrink-0 items-center justify-center rounded-md border bg-background">
			<Icon class="size-4 text-muted-foreground" />
		</div>
		<div class="min-w-0">
			<div class="flex min-w-0 items-center gap-1.5">
				<span class="truncate text-xs font-semibold">{paneLabels[kind]}</span>
				<Badge variant="outline" class="hidden sm:inline-flex">Pane {index + 1}</Badge>
			</div>
			<div class="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
				<Server class="size-3 shrink-0" />
				<span class="truncate font-mono">
					{#if host}
						{host.username ? `${host.username}@` : ''}{host.hostname}:{host.port}
					{:else}
						No host selected
					{/if}
				</span>
			</div>
		</div>
	</div>

	<div class="flex shrink-0 items-center gap-1">
		<Select.Root
			type="single"
			value={host?.id ?? ''}
			onValueChange={(next) => {
				if (next) onHostChange(paneId, next);
			}}
		>
			<Select.Trigger size="sm" class="hidden h-8 w-[10rem] lg:flex">
				<span data-slot="select-value">{host?.name ?? 'Select host'}</span>
			</Select.Trigger>
			<Select.Content>
				{#each hosts as option (option.id)}
					<Select.Item value={option.id} label={option.name} />
				{/each}
			</Select.Content>
		</Select.Root>
		<Select.Root
			type="single"
			value={kind}
			onValueChange={(next) => {
				if (isSessionPaneKind(next)) onKindChange(paneId, next);
			}}
		>
			<Select.Trigger size="sm" class="h-8 w-[8.25rem] shrink-0">
				<span data-slot="select-value">{paneLabels[kind]}</span>
			</Select.Trigger>
			<Select.Content>
				{#each sessionPaneKinds as option (option)}
					<Select.Item value={option} label={paneLabels[option]} />
				{/each}
			</Select.Content>
		</Select.Root>
		<Button
			size="icon-sm"
			variant="ghost"
			aria-label="Reconnect pane"
			onclick={() => onReconnect(paneId)}
		>
			<RotateCcw class="size-4" />
		</Button>
		<Button size="icon-sm" variant="ghost" aria-label="Close pane" onclick={() => onClose(paneId)}>
			<X class="size-4" />
		</Button>
	</div>
</header>
