<script lang="ts">
	import { FileUp, Play } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import StatePanel from './StatePanel.svelte';
</script>

<section class="space-y-4 p-4">
	<div>
		<h1 class="text-lg font-semibold">Termix import</h1>
		<p class="text-sm text-muted-foreground">
			One-way import shell for SQLite database or export files.
		</p>
	</div>
	<div class="grid gap-4 lg:grid-cols-[1fr_360px]">
		<div class="rounded-md border p-4">
			<div class="grid gap-4 sm:grid-cols-2">
				<div class="space-y-2 sm:col-span-2">
					<Label for="import-file">Source file</Label>
					<Input id="import-file" type="file" />
				</div>
				<div class="space-y-2">
					<Label for="secret">Source decrypt secret</Label>
					<Input id="secret" type="password" />
				</div>
				<div class="space-y-2">
					<Label for="owner">Destination owner</Label>
					<Input id="owner" value="admin" />
				</div>
			</div>
			<div class="mt-4 flex gap-2">
				<Button><Play class="size-4" />Start import</Button>
				<Button variant="outline"><FileUp class="size-4" />Validate only</Button>
			</div>
		</div>
		<div class="space-y-3">
			<StatePanel
				state="ready"
				title="Importer idle"
				detail="No import job is currently running."
			/>
			<div class="rounded-md border p-3 text-sm">
				<div class="font-medium">Last summary</div>
				<div class="mt-2 grid grid-cols-3 gap-2 text-center">
					<div class="rounded bg-muted/40 p-2">
						<div class="font-semibold">18</div>
						<div class="text-xs text-muted-foreground">created</div>
					</div>
					<div class="rounded bg-muted/40 p-2">
						<div class="font-semibold">4</div>
						<div class="text-xs text-muted-foreground">skipped</div>
					</div>
					<div class="rounded bg-muted/40 p-2">
						<div class="font-semibold">2</div>
						<div class="text-xs text-muted-foreground">warnings</div>
					</div>
				</div>
			</div>
		</div>
	</div>
</section>
