<script lang="ts">
	import { Clipboard, FileDown, FileUp } from '@lucide/svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import type { RdpClipboardPolicy } from '$lib/settings.remote';

	type FileTransferState = 'idle' | 'copying' | 'saving' | 'complete' | 'failed';
	type ClipboardTelemetry = {
		at: string;
		direction: 'client-to-remote' | 'remote-to-client';
		status: FileTransferState | 'ready';
		detail: string;
	};

	let {
		fileInputElement = $bindable<HTMLInputElement | null>(null),
		fileTransferState,
		fileTransferDetail,
		clipboardPolicyDetail,
		effectiveClipboardPolicy,
		canCopyFileToRemote,
		canSaveRemoteClipboard,
		apiReady,
		clipboardTelemetry,
		copyFileToRemoteClipboard,
		pickFileForRemoteClipboard,
		saveRemoteClipboardLocally,
		requestClipboardPush
	}: {
		fileInputElement: HTMLInputElement | null;
		fileTransferState: FileTransferState;
		fileTransferDetail: string;
		clipboardPolicyDetail: string;
		effectiveClipboardPolicy: RdpClipboardPolicy;
		canCopyFileToRemote: boolean;
		canSaveRemoteClipboard: boolean;
		apiReady: boolean;
		clipboardTelemetry: ClipboardTelemetry[];
		copyFileToRemoteClipboard: (event: Event) => void | Promise<void>;
		pickFileForRemoteClipboard: () => void | Promise<void>;
		saveRemoteClipboardLocally: () => void | Promise<void>;
		requestClipboardPush: () => void | Promise<void>;
	} = $props();
</script>

<div class="border-t bg-background p-3">
	<div class="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto] lg:items-center">
		<div class="min-w-0">
			<div class="flex items-center gap-2">
				<Clipboard class="size-4 text-muted-foreground" />
				<p class="text-sm font-medium">RDP clipboard feedback</p>
			</div>
			<p
				class:text-destructive={fileTransferState === 'failed'}
				class="mt-1 truncate text-xs text-muted-foreground"
			>
				{effectiveClipboardPolicy.files ? fileTransferDetail : clipboardPolicyDetail}
			</p>
		</div>
		<input
			bind:this={fileInputElement}
			type="file"
			class="hidden"
			onchange={copyFileToRemoteClipboard}
			aria-label="Choose file for RDP clipboard"
		/>
		<Button
			size="sm"
			variant="outline"
			disabled={!canCopyFileToRemote || !effectiveClipboardPolicy.files}
			onclick={pickFileForRemoteClipboard}
		>
			<FileUp class="size-4" />
			Copy file to remote
		</Button>
		<Button
			size="sm"
			variant="outline"
			disabled={!canSaveRemoteClipboard || !effectiveClipboardPolicy.files}
			onclick={saveRemoteClipboardLocally}
		>
			<FileDown class="size-4" />
			Save remote clipboard
		</Button>
		<Button
			size="sm"
			variant="outline"
			disabled={!apiReady ||
				!effectiveClipboardPolicy.text ||
				!effectiveClipboardPolicy.clientToRemote}
			onclick={requestClipboardPush}
		>
			<Clipboard class="size-4" />
			Sync text
		</Button>
	</div>

	{#if clipboardTelemetry.length}
		<div class="mt-3 grid gap-2 md:grid-cols-2">
			{#each clipboardTelemetry as entry (entry.at + entry.direction)}
				<div class="rounded-md border bg-muted/20 px-2.5 py-2 text-xs">
					<div class="flex items-center justify-between gap-2">
						<span class="font-medium">
							{entry.direction === 'client-to-remote' ? 'Client to remote' : 'Remote to client'}
						</span>
						<Badge variant={entry.status === 'failed' ? 'destructive' : 'outline'}>
							{entry.status}
						</Badge>
					</div>
					<p class="mt-1 text-muted-foreground">{entry.detail}</p>
				</div>
			{/each}
		</div>
	{:else}
		<p class="mt-3 text-xs text-muted-foreground">
			Clipboard telemetry records direction, size, and status only; clipboard contents are not
			inspected or logged.
		</p>
	{/if}
</div>
