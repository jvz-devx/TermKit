<script lang="ts">
	import {
		AlertCircle,
		CheckCircle2,
		Clipboard,
		FileArchive,
		RotateCcw,
		Save
	} from '@lucide/svelte';
	import * as Alert from '$lib/components/ui/alert';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as NativeSelect from '$lib/components/ui/native-select';
	import { Switch } from '$lib/components/ui/switch';
	import { rdpDisplayPresets } from '$lib/components/termix/session/rdp/rdp-operator-controls';
	import {
		getAppSettings,
		saveAppSettings,
		type BasicAppSettings,
		type BasicAppSettingsInput,
		type RdpPerformancePreset
	} from '$lib/remotes/settings.remote';

	type SettingsForm = {
		ticketTtlSeconds: number;
		terminalFontSize: number;
		clipboardSync: boolean;
		rdpClipboardText: boolean;
		rdpClipboardFiles: boolean;
		rdpClipboardClientToRemote: boolean;
		rdpClipboardRemoteToClient: boolean;
		rdpClipboardFileTransferSizeLimitMiB: number;
		rdpPerformancePreset: RdpPerformancePreset;
		rdpAudioRedirection: boolean;
		rememberLastActiveTab: boolean;
	};

	type FieldErrors = Partial<Record<keyof SettingsForm, string>>;

	const settingsQuery = getAppSettings();
	const initialSettings = await settingsQuery;

	let persisted = $state<BasicAppSettings>(initialSettings);
	let form = $state<SettingsForm>(createForm(initialSettings));
	let saving = $state(false);
	let fieldErrors = $state<FieldErrors>({});
	let error = $state<string | null>(null);
	let success = $state<string | null>(null);

	const clipboardPayloadEnabled = $derived(form.rdpClipboardText || form.rdpClipboardFiles);
	const textClipboardAllowed = $derived(
		form.rdpClipboardText && form.rdpClipboardClientToRemote && form.rdpClipboardRemoteToClient
	);
	const isDirty = $derived(settingsSignature(form) !== settingsSignature(persisted));
	const canSubmit = $derived(!saving && isDirty);

	function createForm(settings?: BasicAppSettings | null): SettingsForm {
		const rdpClipboard = settings?.rdpClipboard;

		return {
			ticketTtlSeconds: settings?.ticketTtlSeconds ?? 60,
			terminalFontSize: settings?.terminalFontSize ?? 13,
			clipboardSync: settings?.clipboardSync ?? true,
			rdpClipboardText: rdpClipboard?.text ?? settings?.clipboardSync ?? true,
			rdpClipboardFiles: rdpClipboard?.files ?? false,
			rdpClipboardClientToRemote: rdpClipboard?.clientToRemote ?? settings?.clipboardSync ?? true,
			rdpClipboardRemoteToClient: rdpClipboard?.remoteToClient ?? settings?.clipboardSync ?? true,
			rdpClipboardFileTransferSizeLimitMiB: rdpClipboard?.fileTransferSizeLimitMiB ?? 16,
			rdpPerformancePreset: settings?.rdpPerformancePreset ?? 'balanced',
			rdpAudioRedirection: settings?.rdpAudioRedirection ?? false,
			rememberLastActiveTab: settings?.rememberLastActiveTab ?? true
		};
	}

	function validateForm(): FieldErrors {
		const nextErrors: FieldErrors = {};

		if (
			!Number.isInteger(form.ticketTtlSeconds) ||
			form.ticketTtlSeconds < 10 ||
			form.ticketTtlSeconds > 300
		) {
			nextErrors.ticketTtlSeconds = 'Use 10 to 300 seconds.';
		}

		if (
			!Number.isInteger(form.terminalFontSize) ||
			form.terminalFontSize < 8 ||
			form.terminalFontSize > 32
		) {
			nextErrors.terminalFontSize = 'Use 8 to 32 pixels.';
		}

		if (
			!Number.isInteger(form.rdpClipboardFileTransferSizeLimitMiB) ||
			form.rdpClipboardFileTransferSizeLimitMiB < 1 ||
			form.rdpClipboardFileTransferSizeLimitMiB > 1024
		) {
			nextErrors.rdpClipboardFileTransferSizeLimitMiB = 'Use 1 to 1024 MiB.';
		}

		return nextErrors;
	}

	function resetForm() {
		if (!persisted) return;
		form = createForm(persisted);
		fieldErrors = {};
		error = null;
		success = null;
	}

	async function submit() {
		fieldErrors = validateForm();
		error = null;
		success = null;

		if (Object.keys(fieldErrors).length > 0) return;

		saving = true;
		try {
			const saved = await saveAppSettings(createSettingsInput(form)).updates(getAppSettings);
			persisted = saved;
			form = createForm(saved);
			success = 'Settings saved.';
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Could not save settings.';
		} finally {
			saving = false;
		}
	}

	function settingsSignature(settings: SettingsForm | BasicAppSettings): string {
		const settingsForm = 'rdpClipboard' in settings ? createForm(settings) : settings;
		return JSON.stringify(createSettingsInput(settingsForm));
	}

	function createSettingsInput(settings: SettingsForm): BasicAppSettingsInput {
		const payloadEnabled = settings.rdpClipboardText || settings.rdpClipboardFiles;

		return {
			ticketTtlSeconds: settings.ticketTtlSeconds,
			terminalFontSize: settings.terminalFontSize,
			clipboardSync:
				settings.rdpClipboardText &&
				settings.rdpClipboardClientToRemote &&
				settings.rdpClipboardRemoteToClient,
			rdpClipboard: {
				text: settings.rdpClipboardText,
				files: settings.rdpClipboardFiles,
				clientToRemote: payloadEnabled ? settings.rdpClipboardClientToRemote : false,
				remoteToClient: payloadEnabled ? settings.rdpClipboardRemoteToClient : false,
				fileTransferSizeLimitMiB: settings.rdpClipboardFileTransferSizeLimitMiB
			},
			rdpPerformancePreset: settings.rdpPerformancePreset,
			rdpAudioRedirection: settings.rdpAudioRedirection,
			rememberLastActiveTab: settings.rememberLastActiveTab
		};
	}

	function setRdpClipboardText(checked: boolean) {
		form.rdpClipboardText = checked;
		restoreClipboardDirectionsWhenEnabled();
		disableClipboardDirectionsWhenNoPayloads();
	}

	function setRdpClipboardFiles(checked: boolean) {
		form.rdpClipboardFiles = checked;
		restoreClipboardDirectionsWhenEnabled();
		disableClipboardDirectionsWhenNoPayloads();
	}

	function restoreClipboardDirectionsWhenEnabled() {
		if (!form.rdpClipboardText && !form.rdpClipboardFiles) return;
		if (form.rdpClipboardClientToRemote || form.rdpClipboardRemoteToClient) return;
		form.rdpClipboardClientToRemote = true;
		form.rdpClipboardRemoteToClient = true;
	}

	function disableClipboardDirectionsWhenNoPayloads() {
		if (form.rdpClipboardText || form.rdpClipboardFiles) return;
		form.rdpClipboardClientToRemote = false;
		form.rdpClipboardRemoteToClient = false;
	}
</script>

<section class="space-y-4 p-4">
	<div>
		<h1 class="text-lg font-semibold">Settings</h1>
		<p class="text-sm text-muted-foreground">Basic application and session defaults.</p>
	</div>

	<form class="grid max-w-3xl gap-4" onsubmit={(event) => (event.preventDefault(), submit())}>
		<Card.Root>
			<Card.Header>
				<Card.Title>Session defaults</Card.Title>
				<Card.Description>Defaults applied when launching new browser sessions.</Card.Description>
			</Card.Header>
			<Card.Content class="grid gap-4 sm:grid-cols-2">
				<div class="space-y-2">
					<Label for="timeout">Ticket TTL seconds</Label>
					<Input
						id="timeout"
						type="number"
						min="10"
						max="300"
						bind:value={form.ticketTtlSeconds}
						aria-invalid={Boolean(fieldErrors.ticketTtlSeconds)}
						aria-describedby={fieldErrors.ticketTtlSeconds ? 'ticket-ttl-error' : undefined}
					/>
					{#if fieldErrors.ticketTtlSeconds}
						<p id="ticket-ttl-error" class="text-xs text-destructive">
							{fieldErrors.ticketTtlSeconds}
						</p>
					{/if}
				</div>
				<div class="space-y-2">
					<Label for="terminal">Terminal font size</Label>
					<Input
						id="terminal"
						type="number"
						min="8"
						max="32"
						bind:value={form.terminalFontSize}
						aria-invalid={Boolean(fieldErrors.terminalFontSize)}
						aria-describedby={fieldErrors.terminalFontSize ? 'terminal-font-error' : undefined}
					/>
					{#if fieldErrors.terminalFontSize}
						<p id="terminal-font-error" class="text-xs text-destructive">
							{fieldErrors.terminalFontSize}
						</p>
					{/if}
				</div>
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header>
				<Card.Title>RDP clipboard policy</Card.Title>
				<Card.Description>Application controls for browser RDP clipboard behavior.</Card.Description
				>
			</Card.Header>
			<Card.Content class="space-y-5">
				<div class="flex flex-wrap items-center gap-2 text-sm">
					<Badge variant={textClipboardAllowed ? 'secondary' : 'outline'}>
						<Clipboard class="size-3" />
						{textClipboardAllowed ? 'Text clipboard allowed' : 'Text clipboard restricted'}
					</Badge>
					<Badge variant={form.rdpClipboardFiles ? 'secondary' : 'outline'}>
						<FileArchive class="size-3" />
						Files {form.rdpClipboardFiles
							? `${form.rdpClipboardFileTransferSizeLimitMiB} MiB limit`
							: 'disabled'}
					</Badge>
				</div>

				<div class="grid gap-4 md:grid-cols-2">
					<label class="flex items-center justify-between gap-4 text-sm">
						<span>
							<span class="block font-medium">Text clipboard</span>
							<span class="text-muted-foreground">Allow text clipboard payloads for RDP.</span>
						</span>
						<Switch
							checked={form.rdpClipboardText}
							onCheckedChange={setRdpClipboardText}
							aria-label="RDP text clipboard"
						/>
					</label>
					<label class="flex items-center justify-between gap-4 text-sm">
						<span>
							<span class="block font-medium">File clipboard</span>
							<span class="text-muted-foreground">Allow RDP file clipboard transfer controls.</span>
						</span>
						<Switch
							checked={form.rdpClipboardFiles}
							onCheckedChange={setRdpClipboardFiles}
							aria-label="RDP file clipboard"
						/>
					</label>
					<label class="flex items-center justify-between gap-4 text-sm">
						<span>
							<span class="block font-medium">Client to remote</span>
							<span class="text-muted-foreground"
								>Permit local clipboard data to enter the RDP host.</span
							>
						</span>
						<Switch
							bind:checked={form.rdpClipboardClientToRemote}
							disabled={!clipboardPayloadEnabled}
							aria-label="RDP client to remote clipboard"
						/>
					</label>
					<label class="flex items-center justify-between gap-4 text-sm">
						<span>
							<span class="block font-medium">Remote to client</span>
							<span class="text-muted-foreground"
								>Permit remote clipboard data to reach the browser.</span
							>
						</span>
						<Switch
							bind:checked={form.rdpClipboardRemoteToClient}
							disabled={!clipboardPayloadEnabled}
							aria-label="RDP remote to client clipboard"
						/>
					</label>
				</div>

				<div class="grid gap-2 sm:max-w-xs">
					<Label for="rdp-file-limit">File transfer limit (MiB)</Label>
					<Input
						id="rdp-file-limit"
						type="number"
						min="1"
						max="1024"
						bind:value={form.rdpClipboardFileTransferSizeLimitMiB}
						disabled={!form.rdpClipboardFiles}
						aria-invalid={Boolean(fieldErrors.rdpClipboardFileTransferSizeLimitMiB)}
						aria-describedby={fieldErrors.rdpClipboardFileTransferSizeLimitMiB
							? 'rdp-file-limit-error'
							: undefined}
					/>
					{#if fieldErrors.rdpClipboardFileTransferSizeLimitMiB}
						<p id="rdp-file-limit-error" class="text-xs text-destructive">
							{fieldErrors.rdpClipboardFileTransferSizeLimitMiB}
						</p>
					{:else}
						<p class="text-xs text-muted-foreground">
							Applied before local files are sent into the RDP clipboard.
						</p>
					{/if}
				</div>
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header>
				<Card.Title>Protocol features</Card.Title>
				<Card.Description>Feature flags shared by supported connection panes.</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-4">
				<div class="grid gap-2 sm:max-w-xs">
					<Label for="rdp-performance-preset">RDP resize behavior</Label>
					<NativeSelect.Root
						id="rdp-performance-preset"
						class="w-full"
						bind:value={form.rdpPerformancePreset}
					>
						<NativeSelect.Option value="balanced">
							{rdpDisplayPresets.balanced.label}
						</NativeSelect.Option>
						<NativeSelect.Option value="performance">
							{rdpDisplayPresets.performance.label}
						</NativeSelect.Option>
						<NativeSelect.Option value="quality"
							>{rdpDisplayPresets.quality.label}</NativeSelect.Option
						>
					</NativeSelect.Root>
					<p class="text-xs text-muted-foreground">
						{rdpDisplayPresets[form.rdpPerformancePreset].detail}
					</p>
				</div>
				<label class="flex items-center justify-between gap-4 text-sm">
					<span>
						<span class="block font-medium">RDP audio redirection</span>
						<span class="text-muted-foreground"
							>Request remote audio when the deployment and client support it.</span
						>
					</span>
					<Switch bind:checked={form.rdpAudioRedirection} aria-label="RDP audio redirection" />
				</label>
				<label class="flex items-center justify-between gap-4 text-sm">
					<span>
						<span class="block font-medium">Remember last active tab per host</span>
						<span class="text-muted-foreground"
							>Reopen hosts on the protocol tab used most recently.</span
						>
					</span>
					<Switch
						bind:checked={form.rememberLastActiveTab}
						aria-label="Remember last active tab per host"
					/>
				</label>
			</Card.Content>
		</Card.Root>

		{#if error}
			<Alert.Root variant="destructive">
				<AlertCircle class="size-4" />
				<Alert.Title>Save failed</Alert.Title>
				<Alert.Description>{error}</Alert.Description>
			</Alert.Root>
		{/if}

		{#if success}
			<Alert.Root>
				<CheckCircle2 class="size-4" />
				<Alert.Title>{success}</Alert.Title>
				<Alert.Description>New sessions will use these defaults.</Alert.Description>
			</Alert.Root>
		{/if}

		<div class="flex flex-wrap gap-2">
			<Button type="submit" disabled={!canSubmit}>
				<Save class="size-4" />{saving ? 'Saving...' : 'Save settings'}
			</Button>
			<Button type="button" variant="outline" disabled={!isDirty || saving} onclick={resetForm}>
				<RotateCcw class="size-4" />Reset
			</Button>
		</div>
	</form>
</section>
