<script lang="ts">
	import { browser } from '$app/environment';
	import { resolve } from '$app/paths';
	import { RotateCcw } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import StatePanel from './StatePanel.svelte';
	import LiveSshTabStrip from './session/ssh/LiveSshTabStrip.svelte';
	import RdpLaunchPane from './session/rdp/RdpLaunchPane.svelte';
	import RdpPane from './session/rdp/RdpPane.svelte';
	import SessionPaneFallback from './session/layout/SessionPaneFallback.svelte';
	import SessionPaneHeader from './session/layout/SessionPaneHeader.svelte';
	import SessionWorkbenchBar from './session/layout/SessionWorkbenchBar.svelte';
	import SessionWorkspaceHeader from './session/layout/SessionWorkspaceHeader.svelte';
	import SessionTileGrid from './session/layout/SessionTileGrid.svelte';
	import FtpLaunchPane from './session/ftp/FtpLaunchPane.svelte';
	import SftpLaunchPane from './session/sftp/SftpLaunchPane.svelte';
	import SessionHostLauncher from './session/layout/SessionHostLauncher.svelte';
	import SshHostKeyTrustPanel from './session/ssh/SshHostKeyTrustPanel.svelte';
	import SshLaunchPane from './session/ssh/SshLaunchPane.svelte';
	import SshTunnelPane from './session/tunnels/SshTunnelPane.svelte';
	import TelnetLaunchPane from './session/telnet/TelnetLaunchPane.svelte';
	import TerminalPane from './session/ssh/TerminalPane.svelte';
	import VncLaunchPane from './session/vnc/VncLaunchPane.svelte';
	import { createSessionWorkspaceController } from './session/layout/session-workspace-controller.svelte';

	const workspace = createSessionWorkspaceController();
</script>

<section
	bind:this={workspace.workspaceElement}
	class="flex h-[calc(100dvh-3.5rem)] min-h-0 w-full min-w-0 flex-col overflow-hidden bg-background"
>
	<SessionWorkspaceHeader
		selectedHost={workspace.selectedHost}
		workspaceStatus={workspace.workspaceStatus}
		workspaceStatusVariant={workspace.workspaceStatusVariant}
		workspacePaneSummary={workspace.workspacePaneSummary}
		historyHref={resolve('/history' as '/')}
		isFullscreen={workspace.isFullscreen}
		canUseFullscreen={browser}
		canReconnect={Boolean(workspace.selectedHost && workspace.activeProtocol !== 'sftp')}
		canDisconnect={Boolean(workspace.selectedHost && workspace.activeProtocol !== 'sftp')}
		onReturnToLauncher={workspace.returnToLauncher}
		onReconnect={workspace.reconnect}
		onToggleFullscreen={workspace.toggleFullscreen}
		onDisconnect={workspace.disconnect}
	/>

	{#if workspace.hostsQuery.loading}
		<div class="relative min-h-0 flex-1">
			<StatePanel
				state="loading"
				title="Loading workspace.hosts"
				detail="Fetching connection inventory."
				class="absolute right-3 bottom-3 left-3 bg-background"
			/>
		</div>
	{:else if !workspace.hosts.length}
		<div class="relative min-h-0 flex-1">
			<StatePanel
				state="error"
				title="No workspace.hosts available"
				detail="Create a host before launching sessions."
				class="absolute right-3 bottom-3 left-3 bg-background"
			/>
		</div>
	{:else if !workspace.selectedHost}
		<div class="flex min-h-0 min-w-0 flex-1 flex-col">
			<LiveSshTabStrip
				sessions={workspace.liveSshSessions}
				activeSessionId={workspace.activeLiveSshSessionId}
				busy={workspace.liveSshBusy}
				onCreate={() => workspace.createPersistentSshTab()}
				onAttach={workspace.attachPersistentSshTab}
				onRename={workspace.renamePersistentSshTab}
				onClose={workspace.closePersistentSshTab}
			/>
			<SessionHostLauncher
				hosts={workspace.hostSelectionHosts}
				allHostsCount={workspace.hosts.length}
				title={workspace.hostSelectionTitle}
				detail={workspace.hostSelectionDetail}
				launcherProtocol={workspace.launcherProtocol}
				bind:search={workspace.sessionSearch}
				onProtocolChange={workspace.setLauncherProtocol}
				onSelectHost={workspace.selectHost}
				protocolForHost={workspace.protocolForSelectedHost}
				protocolsForHost={workspace.protocolsForHost}
			/>
		</div>
	{:else}
		<div class="flex min-h-0 min-w-0 flex-1 flex-col">
			<SessionWorkbenchBar
				isSinglePaneLayout={workspace.isSinglePaneLayout}
				availableTabs={workspace.availableTabs}
				activeProtocol={workspace.activeProtocol}
				workspaceLayoutLabel={workspace.workspaceLayoutLabel}
				workspacePaneKinds={workspace.workspacePaneKinds}
				layoutPersistenceError={workspace.layoutPersistenceError}
				layout={workspace.activeWorkspaceLayout.layout}
				onSelectProtocol={workspace.selectProtocol}
				onSelectLayout={workspace.selectLayout}
			/>

			{#if workspace.workspaceHasSshPane || workspace.liveSshSessions.length}
				<LiveSshTabStrip
					sessions={workspace.liveSshSessions}
					activeSessionId={workspace.activeLiveSshSessionId}
					currentHostId={workspace.selectedHost.id}
					busy={workspace.liveSshBusy}
					onCreate={() => workspace.createPersistentSshTab({ host: workspace.selectedHost })}
					onAttach={workspace.attachPersistentSshTab}
					onRename={workspace.renamePersistentSshTab}
					onClose={workspace.closePersistentSshTab}
				/>
			{/if}

			<SessionTileGrid
				layout={workspace.activeWorkspaceLayout.layout}
				panes={workspace.activeWorkspaceLayout.panes}
			>
				{#snippet children(pane, index)}
					{@const paneHost = workspace.hostForPane(pane)}
					<SessionPaneHeader
						paneId={pane.id}
						kind={pane.kind}
						host={paneHost}
						hosts={workspace.hosts}
						{index}
						onKindChange={workspace.selectPaneKind}
						onHostChange={workspace.selectPaneHost}
						onReconnect={workspace.reconnectPane}
						onClose={workspace.closePane}
					/>
					{#if !paneHost}
						<div class="min-h-0 flex-1 p-3">
							<StatePanel
								state="disconnected"
								title="No host selected"
								detail="Choose a host for this pane."
							/>
						</div>
					{:else if !workspace.isPaneProtocolAvailable(paneHost, pane.kind)}
						<SessionPaneFallback kind={pane.kind} host={paneHost} />
					{:else if pane.kind === 'ssh'}
						{@const paneLiveSshError = workspace.liveSshErrorForHost(paneHost.id)}
						{@const attachableSshSessions = workspace.attachableLiveSshSessionsForHost(paneHost.id)}
						{@const hostKeyLaunchBlocked = workspace.isSshHostKeyLaunchBlocked(paneHost)}
						{@const paneLiveSshAttach = workspace.liveSshAttachByPaneId[pane.id] ?? null}
						<div class="min-h-0 flex-1 p-3">
							{#if paneLiveSshError}
								<StatePanel
									state="error"
									title={workspace.liveSshActionTitle(paneLiveSshError)}
									detail={workspace.liveSshActionDetail(paneLiveSshError)}
								>
									{#if workspace.isHostKeyTrustFailure(paneLiveSshError)}
										<SshHostKeyTrustPanel host={paneHost} onEnrolled={workspace.reconnect} />
									{/if}
									<Button
										size="sm"
										onclick={() =>
											workspace.createPersistentSshTab({ host: paneHost, paneId: pane.id })}
										disabled={workspace.liveSshBusy || hostKeyLaunchBlocked}
									>
										<RotateCcw class="size-4" />
										Retry SSH
									</Button>
									<Button size="sm" variant="outline" onclick={workspace.returnToLauncher}
										>Change host</Button
									>
								</StatePanel>
							{:else if workspace.liveSshBusy && workspace.liveSshBusyPaneId === pane.id}
								<StatePanel
									state="loading"
									title="Opening SSH tab"
									detail="Preparing attach ticket."
								/>
							{:else if paneLiveSshAttach && paneLiveSshAttach.session.hostId === paneHost.id}
								<SshHostKeyTrustPanel host={paneHost} onEnrolled={workspace.reconnect} />
								{#key `ssh-live:${paneLiveSshAttach.session.id}:${paneLiveSshAttach.liveTicket}:${workspace.reconnectNonce}`}
									<TerminalPane
										title={paneLiveSshAttach.session.title}
										subtitle={`${paneLiveSshAttach.session.username ?? 'user'}@${paneLiveSshAttach.session.hostname}`}
										websocketUrl={workspace.toWebSocketUrl(paneLiveSshAttach.liveWebsocketPath)}
										welcome={workspace.sshWelcome(paneHost, paneLiveSshAttach.session.hostname)}
										fontSize={workspace.terminalFontSize(
											paneHost.terminalPreferences,
											workspace.appSettings.terminalFontSize
										)}
										preferences={paneHost.terminalPreferences}
										onConnectionStateChange={(state) =>
											workspace.handleLiveSshTerminalState(state, pane.id)}
									/>
								{/key}
							{:else if workspace.isPanePaused(paneHost, pane.kind)}
								<StatePanel
									state="disconnected"
									title="SSH disconnected"
									detail="Reconnect to attach the SSH tab again."
								/>
							{:else if workspace.liveSshSessionsQuery.loading}
								<StatePanel
									state="loading"
									title="Loading SSH tabs"
									detail="Fetching live session state."
								/>
							{:else if attachableSshSessions.length > 0}
								<StatePanel
									state="ready"
									title="SSH tabs available"
									detail="Attach an existing live tab or create a new SSH tab."
								>
									<Button
										size="sm"
										onclick={() =>
											workspace.attachPersistentSshTab(attachableSshSessions[0], pane.id)}
										disabled={workspace.liveSshBusy || hostKeyLaunchBlocked}
									>
										Attach tab
									</Button>
									<Button
										size="sm"
										variant="outline"
										onclick={() =>
											workspace.createPersistentSshTab({ host: paneHost, paneId: pane.id })}
										disabled={workspace.liveSshBusy || hostKeyLaunchBlocked}
									>
										New SSH tab
									</Button>
								</StatePanel>
							{:else if browser && hostKeyLaunchBlocked}
								<StatePanel
									state="ready"
									title="SSH host key enrollment required"
									detail="Enroll the host key before opening this SSH session."
								>
									<SshHostKeyTrustPanel host={paneHost} onEnrolled={workspace.reconnect} />
								</StatePanel>
							{:else if browser}
								<SshHostKeyTrustPanel host={paneHost} onEnrolled={workspace.reconnect} />
								{#key `ssh:${paneHost.id}:${pane.id}:${workspace.reconnectNonce}`}
									<SshLaunchPane
										host={paneHost}
										fontSize={workspace.terminalFontSize(
											paneHost.terminalPreferences,
											workspace.appSettings.terminalFontSize
										)}
										onLaunch={(launch) => workspace.handleLiveSshLaunch(launch, pane.id)}
										onConnectionStateChange={(state) =>
											workspace.handleLiveSshTerminalState(state, pane.id)}
									/>
								{/key}
							{/if}
						</div>
					{:else if pane.kind === 'sftp'}
						<div class="min-h-0 flex-1 p-3">
							{#if paneHost.sshJumpHost.enabled && paneHost.sshJumpHost.hostId}
								<div
									class="mb-2 rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground"
								>
									SFTP metadata uses jump host
									<span class="font-mono">{paneHost.sshJumpHost.hostId}</span>.
								</div>
							{/if}
							{#if browser}
								{#key `sftp:${paneHost.id}:${pane.id}:${workspace.reconnectNonce}`}
									<SftpLaunchPane hostId={paneHost.id} />
								{/key}
							{/if}
						</div>
					{:else if pane.kind === 'ftp' || pane.kind === 'ftps'}
						<div class="min-h-0 flex-1 p-3">
							{#if browser}
								{#key `ftp:${paneHost.id}:${pane.id}:${workspace.reconnectNonce}`}
									<FtpLaunchPane host={paneHost} />
								{/key}
							{/if}
						</div>
					{:else if pane.kind === 'ssh-tunnel'}
						<div class="min-h-0 flex-1 p-3">
							<SshTunnelPane host={paneHost} />
						</div>
					{:else if pane.kind === 'rdp'}
						<div class="min-h-0 flex-1 p-3">
							{#if workspace.isPanePaused(paneHost, pane.kind)}
								<RdpPane
									launch={null}
									error="Disconnected. Reconnect to create a new session."
									onReconnect={workspace.reconnect}
									clipboardSync={workspace.appSettings.clipboardSync}
									clipboardPolicy={workspace.appSettings.rdpClipboard}
									performancePreset={workspace.appSettings.rdpPerformancePreset}
									audioRedirection={workspace.appSettings.rdpAudioRedirection}
								/>
							{:else if browser}
								{#key `rdp:${paneHost.id}:${pane.id}:${workspace.reconnectNonce}`}
									<RdpLaunchPane
										hostId={paneHost.id}
										onReconnect={workspace.reconnect}
										clipboardSync={workspace.appSettings.clipboardSync}
										clipboardPolicy={workspace.appSettings.rdpClipboard}
										performancePreset={workspace.appSettings.rdpPerformancePreset}
										audioRedirection={workspace.appSettings.rdpAudioRedirection}
									/>
								{/key}
							{/if}
						</div>
					{:else if pane.kind === 'vnc'}
						<div class="min-h-0 flex-1 p-3">
							{#if workspace.isPanePaused(paneHost, pane.kind)}
								<StatePanel
									state="disconnected"
									title="VNC disconnected"
									detail="Reconnect to create a new session."
								/>
							{:else if browser}
								{#key `vnc:${paneHost.id}:${pane.id}:${workspace.reconnectNonce}`}
									<VncLaunchPane hostId={paneHost.id} fallbackUsername={paneHost.username} />
								{/key}
							{/if}
						</div>
					{:else if pane.kind === 'telnet'}
						<div class="min-h-0 flex-1 p-3">
							{#if workspace.isPanePaused(paneHost, pane.kind)}
								<StatePanel
									state="disconnected"
									title="Telnet disconnected"
									detail="Reconnect to create a new session."
								/>
							{:else if browser}
								{#key `telnet:${paneHost.id}:${pane.id}:${workspace.reconnectNonce}`}
									<TelnetLaunchPane
										hostId={paneHost.id}
										hostname={paneHost.hostname}
										port={paneHost.port}
										fontSize={workspace.appSettings.terminalFontSize}
									/>
								{/key}
							{/if}
						</div>
					{/if}
				{/snippet}
			</SessionTileGrid>
		</div>
	{/if}
</section>
