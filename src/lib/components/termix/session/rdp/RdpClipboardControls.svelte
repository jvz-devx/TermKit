<script lang="ts">
	import { Clipboard, FileDown, FileUp } from '@lucide/svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import type { RdpClipboardPolicy } from '$lib/remotes/settings.remote';
	import type { Attachment } from 'svelte/attachments';

	type FileTransferState = 'idle' | 'copying' | 'saving' | 'complete' | 'failed';
	type ClipboardTelemetry = {
		at: string;
		direction: 'client-to-remote' | 'remote-to-client';
		status: FileTransferState | 'ready';
		detail: string;
	};

	let {
		fileTransferState,
		fileTransferDetail,
		clipboardPolicyDetail,
		effectiveClipboardPolicy,
		canCopyFileToRemote,
		canSaveRemoteClipboard,
		copyFileDisabledReason,
		saveRemoteClipboardDisabledReason,
		apiReady,
		clipboardTelemetry,
		copyFileToRemoteClipboard,
		saveRemoteClipboardLocally,
		requestClipboardPush,
		variant = 'panel'
	}: {
		fileTransferState: FileTransferState;
		fileTransferDetail: string;
		clipboardPolicyDetail: string;
		effectiveClipboardPolicy: RdpClipboardPolicy;
		canCopyFileToRemote: boolean;
		canSaveRemoteClipboard: boolean;
		copyFileDisabledReason: string | null;
		saveRemoteClipboardDisabledReason: string | null;
		apiReady: boolean;
		clipboardTelemetry: ClipboardTelemetry[];
		copyFileToRemoteClipboard: (event: Event) => void | Promise<void>;
		saveRemoteClipboardLocally: () => void | Promise<void>;
		requestClipboardPush: () => void | Promise<void>;
		variant?: 'panel' | 'popover';
	} = $props();

	let fileInputElement: HTMLInputElement | null = null;

	const captureFileInput: Attachment<HTMLInputElement> = (node) => {
		fileInputElement = node;

		return () => {
			if (fileInputElement === node) fileInputElement = null;
		};
	};

	function pickFileForRemoteClipboard() {
		fileInputElement?.click();
	}
</script>

{#snippet clipboardSummary()}
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
{/snippet}

{#snippet clipboardActions(actionClass = '')}
	<input
		{@attach captureFileInput}
		type="file"
		class="hidden"
		onchange={copyFileToRemoteClipboard}
		aria-label="Choose file for RDP clipboard"
	/>
	<Button
		size="sm"
		variant="outline"
		class={actionClass}
		disabled={!canCopyFileToRemote || !effectiveClipboardPolicy.files}
		title={copyFileDisabledReason ?? 'Copy file to remote'}
		onclick={pickFileForRemoteClipboard}
	>
		<FileUp class="size-4" />
		Copy file to remote
	</Button>
	<Button
		size="sm"
		variant="outline"
		class={actionClass}
		disabled={!canSaveRemoteClipboard || !effectiveClipboardPolicy.files}
		title={saveRemoteClipboardDisabledReason ?? 'Save remote clipboard'}
		onclick={saveRemoteClipboardLocally}
	>
		<FileDown class="size-4" />
		Save remote clipboard
	</Button>
	<Button
		size="sm"
		variant="outline"
		class={actionClass}
		disabled={!apiReady ||
			!effectiveClipboardPolicy.text ||
			!effectiveClipboardPolicy.clientToRemote}
		onclick={requestClipboardPush}
	>
		<Clipboard class="size-4" />
		Sync text
	</Button>
{/snippet}

{#snippet clipboardDisabledReasons()}
	{#if copyFileDisabledReason || saveRemoteClipboardDisabledReason}
		<div class="grid gap-1 text-xs text-muted-foreground">
			{#if copyFileDisabledReason}
				<p>Copy file disabled: {copyFileDisabledReason}</p>
			{/if}
			{#if saveRemoteClipboardDisabledReason && saveRemoteClipboardDisabledReason !== copyFileDisabledReason}
				<p>Save remote clipboard disabled: {saveRemoteClipboardDisabledReason}</p>
			{/if}
		</div>
	{/if}
{/snippet}

{#snippet clipboardTelemetryList()}
	{#if clipboardTelemetry.length}
		<div class="grid gap-2 md:grid-cols-2">
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
		<p class="text-xs text-muted-foreground">
			Clipboard telemetry records direction, size, and status only; clipboard contents are not
			inspected or logged.
		</p>
	{/if}
{/snippet}

{#if variant === 'popover'}
	<div class="grid gap-3">
		{@render clipboardSummary()}
		<div class="grid gap-2 sm:grid-cols-3">
			{@render clipboardActions('w-full justify-start sm:justify-center')}
		</div>
		{@render clipboardDisabledReasons()}
		{@render clipboardTelemetryList()}
	</div>
{:else}
	<div class="border-t bg-background p-3">
		<div class="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto] lg:items-center">
			{@render clipboardSummary()}
			{@render clipboardActions()}
		</div>
		{#if copyFileDisabledReason || saveRemoteClipboardDisabledReason}
			<div class="mt-3">
				{@render clipboardDisabledReasons()}
			</div>
		{/if}
		<div class="mt-3">
			{@render clipboardTelemetryList()}
		</div>
	</div>
{/if}
