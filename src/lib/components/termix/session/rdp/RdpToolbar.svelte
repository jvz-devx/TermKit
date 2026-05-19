<script lang="ts">
	import {
		Clipboard,
		Command,
		Keyboard,
		Maximize2,
		Minimize2,
		Monitor,
		MonitorUp,
		MousePointer2,
		PanelRightClose,
		PanelRightOpen,
		Power,
		RefreshCw,
		Scan,
		Settings2,
		Volume2,
		VolumeX
	} from '@lucide/svelte';
	import { Badge, type BadgeVariant } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as NativeSelect from '$lib/components/ui/native-select';
	import * as Popover from '$lib/components/ui/popover';
	import type { RdpPerformancePreset } from '$lib/remotes/settings.remote';
	import type { Snippet } from 'svelte';
	import type { RdpScaleMode } from './rdp-operator-controls';

	let {
		statusVariant,
		statusTitle,
		clipboardStatusVariant,
		clipboardStatusLabel,
		displayPresetLabel,
		multiMonitorLabel,
		audioRequested,
		audioAvailable,
		audioStatusLabel,
		apiReady,
		viewportReady,
		connected,
		fullscreenActive,
		selectedPreset,
		selectedScale,
		reconnectLabel,
		sidebarOpen = false,
		onSendCtrlAltDel,
		onSendWindowsKey,
		onFocusRemoteDesktop,
		onResizeRemoteDisplay,
		onToggleFullscreen,
		onPresetChange,
		onScaleChange,
		onReconnect,
		onDisconnect,
		onToggleSidebar,
		clipboardControls,
		detailsControls
	}: {
		statusVariant: BadgeVariant;
		statusTitle: string;
		clipboardStatusVariant: BadgeVariant;
		clipboardStatusLabel: string;
		displayPresetLabel: string;
		multiMonitorLabel: string;
		audioRequested: boolean;
		audioAvailable: boolean;
		audioStatusLabel: string;
		apiReady: boolean;
		viewportReady: boolean;
		connected: boolean;
		fullscreenActive: boolean;
		selectedPreset: RdpPerformancePreset;
		selectedScale: RdpScaleMode;
		reconnectLabel: string;
		sidebarOpen?: boolean;
		onSendCtrlAltDel: () => void;
		onSendWindowsKey: () => void;
		onFocusRemoteDesktop: () => void;
		onResizeRemoteDisplay: () => void;
		onToggleFullscreen: () => void;
		onPresetChange: (preset: string) => void;
		onScaleChange: (scale: string) => void;
		onReconnect: () => void;
		onDisconnect: () => void;
		onToggleSidebar?: () => void;
		clipboardControls?: Snippet;
		detailsControls?: Snippet;
	} = $props();

	const FullscreenIcon = $derived(fullscreenActive ? Minimize2 : Maximize2);
	const AudioIcon = $derived(audioRequested && audioAvailable ? Volume2 : VolumeX);
	const SidebarIcon = $derived(sidebarOpen ? PanelRightClose : PanelRightOpen);
</script>

<div class="flex min-h-10 shrink-0 items-center justify-between gap-2 border-b px-2 py-1">
	<div class="flex min-w-0 shrink items-center gap-1.5 overflow-hidden">
		<Monitor class="size-4 shrink-0 text-muted-foreground" />
		<span class="truncate text-sm font-medium">RDP</span>
		<Badge variant={statusVariant} class="shrink truncate">{statusTitle}</Badge>
		<Badge variant={clipboardStatusVariant} class="shrink truncate">{clipboardStatusLabel}</Badge>
	</div>
	<div class="flex shrink-0 items-center justify-end gap-1">
		{#if onToggleSidebar}
			<Button
				size="icon-sm"
				variant="ghost"
				onclick={onToggleSidebar}
				aria-label={sidebarOpen ? 'Hide session sidebar' : 'Show session sidebar'}
				title={sidebarOpen ? 'Hide sessions' : 'Show sessions'}
			>
				<SidebarIcon class="size-4" />
			</Button>
		{/if}
		<Popover.Root>
			<Popover.Trigger>
				{#snippet child({ props })}
					<Button
						{...props}
						size="sm"
						variant="outline"
						class="gap-1.5"
						aria-label="RDP details and secondary controls"
						title="Details"
					>
						<Settings2 class="size-4" />
						<span class="hidden sm:inline">Details</span>
					</Button>
				{/snippet}
			</Popover.Trigger>
			<Popover.Content align="end" class="w-[min(32rem,calc(100vw-2rem))] p-3">
				<div class="grid gap-3">
					<div class="flex min-w-0 flex-wrap items-center gap-1.5">
						<Badge variant="outline" class="shrink truncate">{displayPresetLabel}</Badge>
						<Badge variant="outline" class="shrink truncate">
							<MonitorUp class="size-3" />
							{multiMonitorLabel}
						</Badge>
						<Badge
							variant={audioRequested && audioAvailable ? 'secondary' : 'outline'}
							class="shrink truncate"
						>
							<AudioIcon class="size-3" />
							{audioStatusLabel}
						</Badge>
					</div>
					<div class="grid gap-2 sm:grid-cols-2">
						<Button
							size="sm"
							variant="outline"
							class="justify-start"
							onclick={onSendCtrlAltDel}
							disabled={!apiReady || !connected}
						>
							<Keyboard class="size-4" />
							Ctrl Alt Del
						</Button>
						<Button
							size="sm"
							variant="outline"
							class="justify-start"
							onclick={onSendWindowsKey}
							disabled={!apiReady || !connected}
						>
							<Command class="size-4" />
							Windows key
						</Button>
						<Button
							size="sm"
							variant="outline"
							class="justify-start"
							onclick={onFocusRemoteDesktop}
							disabled={!apiReady}
						>
							<MousePointer2 class="size-4" />
							Focus canvas
						</Button>
						<Button
							size="sm"
							variant="outline"
							class="justify-start"
							onclick={onResizeRemoteDisplay}
							disabled={!apiReady || !connected}
						>
							<Scan class="size-4" />
							Resize display
						</Button>
					</div>
					<div class="grid gap-2 sm:grid-cols-2">
						<NativeSelect.Root
							size="sm"
							value={selectedPreset}
							onchange={(event) => onPresetChange(event.currentTarget.value)}
							aria-label="RDP quality preset"
						>
							<NativeSelect.Option value="balanced">Balanced quality</NativeSelect.Option>
							<NativeSelect.Option value="performance">Performance quality</NativeSelect.Option>
							<NativeSelect.Option value="quality">Best quality</NativeSelect.Option>
						</NativeSelect.Root>
						<NativeSelect.Root
							size="sm"
							value={selectedScale}
							onchange={(event) => onScaleChange(event.currentTarget.value)}
							aria-label="RDP display scale"
						>
							<NativeSelect.Option value="fit">Fit</NativeSelect.Option>
							<NativeSelect.Option value="fill">Fill</NativeSelect.Option>
							<NativeSelect.Option value="real">100%</NativeSelect.Option>
						</NativeSelect.Root>
					</div>
					{#if detailsControls}
						<div class="border-t pt-3">
							{@render detailsControls()}
						</div>
					{/if}
				</div>
			</Popover.Content>
		</Popover.Root>
		{#if clipboardControls}
			<Popover.Root>
				<Popover.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							size="icon-sm"
							variant="ghost"
							disabled={!apiReady || !connected}
							aria-label="RDP clipboard controls"
							title="Clipboard"
						>
							<Clipboard class="size-4" />
						</Button>
					{/snippet}
				</Popover.Trigger>
				<Popover.Content align="end" class="w-[min(28rem,calc(100vw-2rem))] p-3">
					{@render clipboardControls()}
				</Popover.Content>
			</Popover.Root>
		{/if}
		<Button
			size="icon-sm"
			variant="ghost"
			onclick={onToggleFullscreen}
			disabled={!viewportReady}
			aria-label={fullscreenActive ? 'Exit RDP fullscreen' : 'Enter RDP fullscreen'}
			title={fullscreenActive ? 'Exit fullscreen' : 'Fullscreen'}
		>
			<FullscreenIcon class="size-4" />
		</Button>
		<NativeSelect.Root
			size="sm"
			class="hidden w-[5.25rem] sm:block"
			value={selectedScale}
			onchange={(event) => onScaleChange(event.currentTarget.value)}
			aria-label="RDP display scale"
		>
			<NativeSelect.Option value="fit">Fit</NativeSelect.Option>
			<NativeSelect.Option value="fill">Fill</NativeSelect.Option>
			<NativeSelect.Option value="real">100%</NativeSelect.Option>
		</NativeSelect.Root>
		<Button
			size="icon-sm"
			variant="ghost"
			onclick={onReconnect}
			aria-label={reconnectLabel}
			title={reconnectLabel}
		>
			<RefreshCw class="size-4" />
		</Button>
		<Button
			size="icon-sm"
			variant="ghost"
			onclick={onDisconnect}
			disabled={!apiReady || !connected}
			aria-label="Disconnect RDP session"
			title="Disconnect RDP session"
		>
			<Power class="size-4" />
		</Button>
	</div>
</div>
