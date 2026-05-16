<script lang="ts">
	import { Save } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';

	let {
		textPath,
		textValue = $bindable(''),
		textDirty = $bindable(false),
		saveText
	}: {
		textPath: string | null;
		textValue: string;
		textDirty: boolean;
		saveText: () => void | Promise<void>;
	} = $props();
</script>

<div class="flex h-full min-h-0 min-w-0 flex-col border-t p-2 lg:border-t-0 lg:border-l">
	<div class="mb-2 flex h-8 shrink-0 items-center justify-between gap-2">
		<div class="min-w-0 truncate font-mono text-xs text-muted-foreground">
			{textPath ?? 'No text file open'}
		</div>
		<Button
			size="icon-sm"
			variant="outline"
			aria-label="Save text file"
			disabled={!textPath || !textDirty}
			onclick={saveText}
		>
			<Save class="size-4" />
		</Button>
	</div>
	<Textarea
		class="min-h-40 flex-1 resize-none font-mono text-xs"
		placeholder="Open a text file to edit it"
		bind:value={textValue}
		disabled={!textPath}
		oninput={() => (textDirty = Boolean(textPath))}
	/>
</div>
