<script lang="ts">
	import { Maximize2, Power, RotateCcw, Upload } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Tabs from '$lib/components/ui/tabs';
	import StatePanel from './StatePanel.svelte';
	import { protocolTabs } from './sample-data';
</script>

<section class="flex h-[calc(100vh-3rem)] min-h-[640px] flex-col">
	<div class="flex items-center justify-between border-b px-4 py-2">
		<div>
			<h1 class="text-sm font-semibold">edge-01</h1>
			<p class="font-mono text-xs text-muted-foreground">ops@10.40.0.11 · session ticket pending</p>
		</div>
		<div class="flex gap-1">
			<Button size="icon" variant="ghost" aria-label="Reconnect"
				><RotateCcw class="size-4" /></Button
			>
			<Button size="icon" variant="ghost" aria-label="Fullscreen"
				><Maximize2 class="size-4" /></Button
			>
			<Button size="icon" variant="ghost" aria-label="Disconnect"><Power class="size-4" /></Button>
		</div>
	</div>

	<Tabs.Root value="ssh" class="flex min-h-0 flex-1 flex-col">
		<Tabs.List class="h-10 justify-start rounded-none border-b bg-muted/20 px-2">
			{#each protocolTabs as tab (tab.value)}
				<Tabs.Trigger value={tab.value} class="h-8 gap-2">
					<tab.icon class="size-4" />
					{tab.label}
				</Tabs.Trigger>
			{/each}
		</Tabs.List>
		<Tabs.Content value="ssh" class="m-0 min-h-0 flex-1 p-3">
			<div
				class="flex h-full min-h-[480px] flex-col overflow-hidden rounded-md border bg-zinc-950 text-zinc-100"
			>
				<div class="border-b border-zinc-800 px-3 py-2 font-mono text-xs text-zinc-400">
					SSH terminal · 120x34 · connected
				</div>
				<pre class="min-h-0 flex-1 overflow-auto p-3 text-xs leading-5"><code
						>$ ssh ops@edge-01
Last login: Wed May 13 10:42:07
ops@edge-01:~$ systemctl status termixkit-agent
● termixkit-agent.service - remote helper
   Active: active (running)</code
					></pre>
			</div>
		</Tabs.Content>
		<Tabs.Content value="sftp" class="m-0 min-h-0 flex-1 p-3">
			<div
				class="grid h-full min-h-[480px] grid-cols-[240px_1fr] overflow-hidden rounded-md border"
			>
				<aside class="border-r bg-muted/20 p-2 text-sm">
					<div class="rounded bg-background px-2 py-1 font-mono text-xs">/srv/app</div>
					<div class="mt-2 space-y-1 text-xs text-muted-foreground">
						<div>config/</div>
						<div>logs/</div>
						<div>releases/</div>
					</div>
				</aside>
				<div class="min-w-0">
					<div class="flex h-10 items-center justify-between border-b px-3">
						<span class="text-sm font-medium">Files</span>
						<Button size="sm" variant="outline"><Upload class="size-4" />Upload</Button>
					</div>
					<div
						class="grid grid-cols-[1fr_90px_120px] border-b px-3 py-2 text-xs text-muted-foreground"
					>
						<span>Name</span><span>Size</span><span>Modified</span>
					</div>
					{#each ['app.log', 'compose.yaml', 'README.md'] as file (file)}
						<div class="grid grid-cols-[1fr_90px_120px] px-3 py-2 text-sm">
							<span>{file}</span><span>24 KB</span><span>today</span>
						</div>
					{/each}
				</div>
			</div>
		</Tabs.Content>
		<Tabs.Content value="rdp" class="m-0 min-h-0 flex-1 p-3">
			<div class="relative h-full min-h-[480px] overflow-hidden rounded-md border bg-neutral-950">
				<div
					class="absolute inset-8 flex items-center justify-center rounded border border-neutral-800 bg-neutral-900 text-neutral-400"
				>
					RDP canvas mount point
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
			<div class="relative h-full min-h-[480px] overflow-hidden rounded-md border bg-black">
				<div class="absolute inset-6 border border-dashed border-neutral-700"></div>
				<StatePanel
					state="error"
					title="VNC handshake failed"
					detail="The proxy rejected the ticket or target socket closed."
					class="absolute right-3 bottom-3 left-3 bg-background"
				/>
			</div>
		</Tabs.Content>
		<Tabs.Content value="telnet" class="m-0 min-h-0 flex-1 p-3">
			<div
				class="h-full min-h-[480px] overflow-hidden rounded-md border bg-zinc-950 p-3 font-mono text-xs text-amber-100"
			>
				Trying 10.40.8.4...<br />Connected to switch-a.<br />login:
				<StatePanel
					state="disconnected"
					title="Disconnected"
					detail="Telnet bridge closed after idle timeout."
					class="mt-6 bg-background font-sans text-foreground"
				/>
			</div>
		</Tabs.Content>
	</Tabs.Root>
</section>
