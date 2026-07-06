<script lang="ts">
	import { RefreshCw } from '@lucide/svelte';
	import type { Snippet } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import StatePanel from '../../StatePanel.svelte';
	import RdpClipboardControls from './RdpClipboardControls.svelte';
	import RdpCredentialsPanel from './RdpCredentialsPanel.svelte';
	import RdpStatusBar from './RdpStatusBar.svelte';
	import RdpToolbar from './RdpToolbar.svelte';
	import {
		createRdpPaneController,
		type RdpPaneControllerProps
	} from './rdp-pane-controller.svelte';

	let {
		detailsControls,
		immersive = false,
		...controllerProps
	}: RdpPaneControllerProps & {
		detailsControls?: Snippet;
		immersive?: boolean;
	} = $props();
	// eslint-disable-next-line svelte/no-unused-svelte-ignore
	// svelte-ignore state_referenced_locally -- RDP launch identity is fixed for this mounted pane
	const rdp = createRdpPaneController(controllerProps);
	const rdpFocusHost = rdp.rdpFocusHost;
</script>

<svelte:document
	bind:fullscreenElement={rdp.fullscreenElement}
	bind:activeElement={rdp.activeElement}
	onfullscreenchange={rdp.handleFullscreenChange}
/>

<div
	class={immersive
		? 'flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background'
		: 'flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-md border bg-background'}
>
	<RdpToolbar
		statusVariant={rdp.statusVariant}
		statusTitle={rdp.statusTitle}
		clipboardStatusVariant={rdp.clipboardStatusVariant}
		clipboardStatusLabel={rdp.clipboardStatusLabel}
		displayPresetLabel={rdp.selectedDisplayPreset.label}
		multiMonitorLabel={rdp.multiMonitorLabel}
		audioRequested={rdp.audioRedirection}
		audioAvailable={Boolean(rdp.gatewayFeatures?.audioRedirection)}
		audioStatusLabel={rdp.audioStatusLabel}
		apiReady={Boolean(rdp.api)}
		viewportReady={Boolean(rdp.viewportElement)}
		connected={rdp.connectionState === 'connected'}
		fullscreenActive={rdp.fullscreenActive}
		selectedPreset={rdp.selectedPreset}
		selectedScale={rdp.selectedScale}
		reconnectLabel={rdp.reconnectLabel}
		onSendCtrlAltDel={rdp.sendCtrlAltDel}
		onSendWindowsKey={rdp.sendWindowsKey}
		onFocusRemoteDesktop={rdp.focusRemoteDesktop}
		onResizeRemoteDisplay={() => rdp.scheduleRemoteResize(true)}
		onToggleFullscreen={rdp.toggleFullscreen}
		onPresetChange={rdp.changePreset}
		onScaleChange={rdp.changeScale}
		onReconnect={rdp.onReconnect}
		onDisconnect={rdp.disconnectRdpSession}
		{detailsControls}
	>
		{#snippet clipboardControls()}
			<RdpClipboardControls
				variant="popover"
				fileTransferState={rdp.fileTransferState}
				fileTransferDetail={rdp.fileTransferDetail}
				clipboardPolicyDetail={rdp.clipboardPolicyDetail}
				effectiveClipboardPolicy={rdp.effectiveClipboardPolicy}
				canCopyFileToRemote={rdp.canCopyFileToRemote}
				canSaveRemoteClipboard={rdp.canSaveRemoteClipboard}
				copyFileDisabledReason={rdp.copyFileDisabledReason}
				saveRemoteClipboardDisabledReason={rdp.saveRemoteClipboardDisabledReason}
				apiReady={Boolean(rdp.api)}
				clipboardTelemetry={rdp.clipboardTelemetry}
				copyFileToRemoteClipboard={rdp.copyFileToRemoteClipboard}
				saveRemoteClipboardLocally={rdp.saveRemoteClipboardLocally}
				requestClipboardPush={rdp.requestClipboardPush}
			/>
		{/snippet}
	</RdpToolbar>

	{#if rdp.error}
		<div class="relative min-h-0 min-w-0 flex-1">
			<StatePanel
				state="error"
				title={rdp.launchFailure?.title ?? 'RDP launch failed'}
				detail={`${rdp.launchFailure?.detail ?? rdp.error} Diagnostic: ${rdp.launchFailure?.code ?? rdp.error}`}
				class="absolute right-3 bottom-3 left-3 bg-background"
			>
				<Button size="sm" onclick={rdp.onReconnect}>
					<RefreshCw class="size-4" />
					{rdp.launchFailure?.reconnectLabel ?? 'Retry RDP'}
				</Button>
			</StatePanel>
		</div>
	{:else if !rdp.bootstrap}
		<div class="relative min-h-0 min-w-0 flex-1 bg-neutral-950">
			<StatePanel
				state="loading"
				title="Provisioning Gateway session"
				detail="Requesting a short-lived Devolutions Gateway association token."
				class="absolute right-3 bottom-3 left-3 bg-background"
			/>
		</div>
	{:else}
		<div class="flex min-h-0 min-w-0 flex-1 flex-col bg-neutral-950">
			<div
				class="relative min-h-0 min-w-0 flex-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
				bind:this={rdp.viewportElement}
			>
				<div class="h-full w-full min-w-0 overflow-hidden">
					{#if rdp.webComponentReady && rdp.rdpModule}
						<svelte:element
							this={'iron-remote-desktop'}
							bind:this={rdp.remoteDesktopElement}
							module={rdp.rdpModule.Backend}
							scale={rdp.selectedScale}
							flexcenter="true"
							onready={rdp.handleReady}
							tabindex="0"
							role="application"
							aria-label="RDP remote desktop canvas"
							use:rdpFocusHost
							class="block h-full w-full"
						/>
					{/if}
				</div>

				{#if rdp.connectionState !== 'connected'}
					<StatePanel
						state={rdp.connectionState === 'error'
							? 'error'
							: rdp.connectionState === 'disconnected'
								? 'disconnected'
								: 'loading'}
						title={rdp.connectionState === 'ready' ? 'RDP credentials required' : rdp.statusTitle}
						detail={rdp.detail}
						class="absolute right-3 bottom-3 left-3 bg-background"
					/>
				{/if}
			</div>

			{#if rdp.connectionState !== 'connected'}
				<RdpStatusBar
					rdpFocused={rdp.rdpFocused}
					focusDetail={rdp.focusDetail}
					multiMonitorLabel={rdp.multiMonitorLabel}
					audioStatusLabel={rdp.audioStatusLabel}
				/>
				<RdpCredentialsPanel
					bind:sessionUsername={rdp.sessionUsername}
					bind:sessionDomain={rdp.sessionDomain}
					bind:sessionPassword={rdp.sessionPassword}
					connectionState={rdp.connectionState}
					canConnect={rdp.canConnect}
					submitConnect={rdp.submitConnect}
					gatewayPublicUrl={rdp.bootstrap.gatewayPublicUrl}
					destination={rdp.bootstrap.destination}
					targetCredentialState={rdp.targetCredentialState}
					clipboardPolicyDetail={rdp.clipboardPolicyDetail}
				/>
			{/if}
		</div>
	{/if}
</div>
