<script lang="ts">
	import { AlertCircle, CheckCircle2, RotateCcw, Save } from '@lucide/svelte';
	import * as Alert from '$lib/components/ui/alert';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import { getAppSettings, saveAppSettings, type BasicAppSettings } from '$lib/settings.remote';

	type SettingsForm = {
		ticketTtlSeconds: number;
		terminalFontSize: number;
		clipboardSync: boolean;
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

	const isDirty = $derived(settingsSignature(form) !== settingsSignature(persisted));
	const canSubmit = $derived(!saving && isDirty);

	function createForm(settings?: BasicAppSettings | null): SettingsForm {
		return {
			ticketTtlSeconds: settings?.ticketTtlSeconds ?? 60,
			terminalFontSize: settings?.terminalFontSize ?? 13,
			clipboardSync: settings?.clipboardSync ?? true,
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
			const saved = await saveAppSettings(form).updates(getAppSettings);
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
		return JSON.stringify({
			ticketTtlSeconds: settings.ticketTtlSeconds,
			terminalFontSize: settings.terminalFontSize,
			clipboardSync: settings.clipboardSync,
			rememberLastActiveTab: settings.rememberLastActiveTab
		});
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
				<Card.Title>Protocol features</Card.Title>
				<Card.Description>Feature flags shared by supported connection panes.</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-4">
				<label class="flex items-center justify-between gap-4 text-sm">
					<span>
						<span class="block font-medium">Clipboard sync when supported</span>
						<span class="text-muted-foreground"
							>Allow compatible clients to mirror clipboard data.</span
						>
					</span>
					<Switch bind:checked={form.clipboardSync} aria-label="Clipboard sync when supported" />
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
