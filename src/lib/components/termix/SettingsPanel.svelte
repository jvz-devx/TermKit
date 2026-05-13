<script lang="ts">
	import { Save } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
</script>

<section class="space-y-4 p-4">
	<div>
		<h1 class="text-lg font-semibold">Settings</h1>
		<p class="text-sm text-muted-foreground">Basic application and session defaults.</p>
	</div>
	<div class="grid max-w-3xl gap-4">
		<div class="rounded-md border p-4">
			<h2 class="text-sm font-medium">Session defaults</h2>
			<div class="mt-4 grid gap-4 sm:grid-cols-2">
				<div class="space-y-2">
					<Label for="timeout">Ticket TTL seconds</Label><Input
						id="timeout"
						type="number"
						value="60"
					/>
				</div>
				<div class="space-y-2">
					<Label for="terminal">Terminal font size</Label><Input
						id="terminal"
						type="number"
						value="13"
					/>
				</div>
			</div>
		</div>
		<div class="rounded-md border p-4">
			<h2 class="text-sm font-medium">Protocol features</h2>
			<div class="mt-4 space-y-3">
				<label class="flex items-center justify-between gap-4 text-sm"
					><span>Clipboard sync when supported</span><Switch checked /></label
				>
				<label class="flex items-center justify-between gap-4 text-sm"
					><span>Remember last active tab per host</span><Switch checked /></label
				>
			</div>
		</div>
		<Button class="w-fit"><Save class="size-4" />Save settings</Button>
	</div>
</section>
