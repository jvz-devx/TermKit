<script lang="ts">
	import { Maximize2, Power, RotateCcw } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Tabs from '$lib/components/ui/tabs';
	import StatePanel from './StatePanel.svelte';
	import { protocolTabs } from './sample-data';
	import SftpBrowser from './session/SftpBrowser.svelte';
	import TerminalPane from './session/TerminalPane.svelte';
	import VncPane from './session/VncPane.svelte';

	let activeProtocol = $state('ssh');

	const host = {
		id: 'edge-01',
		name: 'edge-01',
		username: 'ops',
		address: '10.40.0.11'
	};
</script>

<section class="flex h-[calc(100vh-3rem)] min-h-[640px] flex-col">
	<div class="flex items-center justify-between border-b px-4 py-2">
		<div>
			<h1 class="text-sm font-semibold">{host.name}</h1>
			<p class="font-mono text-xs text-muted-foreground">
				{host.username}@{host.address} · {activeProtocol.toUpperCase()} session
			</p>
		</div>
		<div class="flex gap-1">
			<Button size="icon" variant="ghost" aria-label="Reconnect">
				<RotateCcw class="size-4" />
			</Button>
			<Button size="icon" variant="ghost" aria-label="Fullscreen">
				<Maximize2 class="size-4" />
			</Button>
			<Button size="icon" variant="ghost" aria-label="Disconnect">
				<Power class="size-4" />
			</Button>
		</div>
	</div>

	<Tabs.Root bind:value={activeProtocol} class="flex min-h-0 flex-1 flex-col">
		<Tabs.List class="h-10 justify-start rounded-none border-b bg-muted/20 px-2">
			{#each protocolTabs as tab (tab.value)}
				<Tabs.Trigger value={tab.value} class="h-8 gap-2">
					<tab.icon class="size-4" />
					{tab.label}
				</Tabs.Trigger>
			{/each}
		</Tabs.List>

		<Tabs.Content value="ssh" class="m-0 min-h-0 flex-1 p-3">
			<TerminalPane
				title="SSH terminal"
				subtitle={`${host.username}@${host.address}`}
				welcome={[
					'$ ssh ops@edge-01',
					'Session ticket pending. The terminal renderer is mounted and ready for /ws/ssh/:ticket.',
					''
				]}
			/>
		</Tabs.Content>

		<Tabs.Content value="sftp" class="m-0 min-h-0 flex-1 p-3">
			<SftpBrowser hostId={host.id} initialPath="/srv/app" />
		</Tabs.Content>

		<Tabs.Content value="rdp" class="m-0 min-h-0 flex-1 p-3">
			<div class="relative h-full min-h-[480px] overflow-hidden rounded-md border bg-neutral-950">
				<div class="absolute inset-0 grid place-items-center bg-neutral-900">
					<div class="h-3/4 w-3/4 rounded-sm border border-neutral-800 bg-neutral-950"></div>
				</div>
				<StatePanel
					state="loading"
					title="Gateway authorization pending"
					detail="Waiting for IronRDP session details."
					class="absolute right-3 bottom-3 left-3 bg-background"
				/>
			</div>
		</Tabs.Content>

		<Tabs.Content value="vnc" class="m-0 min-h-0 flex-1 p-3">
			<VncPane />
		</Tabs.Content>

		<Tabs.Content value="telnet" class="m-0 min-h-0 flex-1 p-3">
			<TerminalPane
				title="Telnet terminal"
				subtitle="switch-a:23"
				welcome={[
					'Trying 10.40.8.4...',
					'Telnet bridge pending. The terminal renderer is mounted and ready for /ws/telnet/:ticket.',
					''
				]}
			/>
		</Tabs.Content>
	</Tabs.Root>
</section>
