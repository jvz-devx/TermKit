<script lang="ts">
	import {
		Command,
		Gauge,
		Keyboard,
		Maximize2,
		Minimize2,
		Monitor,
		MonitorUp,
		MousePointer2,
		Power,
		RefreshCw,
		Scan,
		Volume2,
		VolumeX
	} from '@lucide/svelte';
	import { Badge, type BadgeVariant } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as NativeSelect from '$lib/components/ui/native-select';
	import type { RdpPerformancePreset } from '$lib/settings.remote';
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
		onSendCtrlAltDel,
		onSendWindowsKey,
		onFocusRemoteDesktop,
		onResizeRemoteDisplay,
		onToggleFullscreen,
		onPresetChange,
		onScaleChange,
		onReconnect,
		onDisconnect
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
		onSendCtrlAltDel: () => void;
		onSendWindowsKey: () => void;
		onFocusRemoteDesktop: () => void;
		onResizeRemoteDisplay: () => void;
		onToggleFullscreen: () => void;
		onPresetChange: (preset: string) => void;
		onScaleChange: (scale: string) => void;
		onReconnect: () => void;
		onDisconnect: () => void;
	} = $props();

	const FullscreenIcon = $derived(fullscreenActive ? Minimize2 : Maximize2);
	const AudioIcon = $derived(audioRequested && audioAvailable ? Volume2 : VolumeX);
</script>

<div
	class="flex min-h-10 shrink-0 flex-wrap items-center justify-between gap-2 border-b px-3 py-1.5"
>
	<div class="flex min-w-0 flex-wrap items-center gap-2">
		<Monitor class="size-4 shrink-0 text-muted-foreground" />
		<span class="truncate text-sm font-medium">RDP</span>
		<Badge variant={statusVariant} class="shrink truncate">{statusTitle}</Badge>
		<Badge variant={clipboardStatusVariant} class="shrink truncate">{clipboardStatusLabel}</Badge>
		<Badge variant="outline" class="shrink truncate">
			<Gauge class="size-3" />
			{displayPresetLabel}
		</Badge>
		<Badge variant="outline" class="hidden shrink truncate md:inline-flex">
			<MonitorUp class="size-3" />
			{multiMonitorLabel}
		</Badge>
		<Badge
			variant={audioRequested && audioAvailable ? 'secondary' : 'outline'}
			class="hidden shrink truncate lg:inline-flex"
		>
			<AudioIcon class="size-3" />
			{audioStatusLabel}
		</Badge>
	</div>
	<div class="flex shrink-0 flex-wrap items-center justify-end gap-1">
		<Button
			size="icon-sm"
			variant="ghost"
			onclick={onSendCtrlAltDel}
			disabled={!apiReady || !connected}
			aria-label="Send Ctrl Alt Delete"
			title="Send Ctrl+Alt+Del"
		>
			<Keyboard class="size-4" />
		</Button>
		<Button
			size="icon-sm"
			variant="ghost"
			onclick={onSendWindowsKey}
			disabled={!apiReady || !connected}
			aria-label="Send Windows key"
			title="Send Windows key"
		>
			<Command class="size-4" />
		</Button>
		<Button
			size="icon-sm"
			variant="ghost"
			onclick={onFocusRemoteDesktop}
			disabled={!apiReady}
			aria-label="Focus RDP canvas"
			title="Focus RDP canvas"
		>
			<MousePointer2 class="size-4" />
		</Button>
		<Button
			size="icon-sm"
			variant="ghost"
			onclick={onResizeRemoteDisplay}
			disabled={!apiReady || !connected}
			aria-label="Resize remote display"
			title="Resize remote display"
		>
			<Scan class="size-4" />
		</Button>
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
			class="hidden w-[8.75rem] sm:block"
			value={selectedPreset}
			onchange={(event) => onPresetChange(event.currentTarget.value)}
			aria-label="RDP quality preset"
		>
			<NativeSelect.Option value="balanced">Balanced</NativeSelect.Option>
			<NativeSelect.Option value="performance">Performance</NativeSelect.Option>
			<NativeSelect.Option value="quality">Quality</NativeSelect.Option>
		</NativeSelect.Root>
		<NativeSelect.Root
			size="sm"
			class="hidden w-[7.25rem] lg:block"
			value={selectedScale}
			onchange={(event) => onScaleChange(event.currentTarget.value)}
			aria-label="RDP display scale"
		>
			<NativeSelect.Option value="fit">Fit</NativeSelect.Option>
			<NativeSelect.Option value="fill">Fill</NativeSelect.Option>
			<NativeSelect.Option value="real">100%</NativeSelect.Option>
		</NativeSelect.Root>
		<Button size="sm" variant="outline" onclick={onReconnect}>
			<RefreshCw class="size-4" />
			{reconnectLabel}
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
