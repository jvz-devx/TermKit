<script lang="ts">
	import { AlertCircle, CheckCircle2, Loader2, Unplug } from '@lucide/svelte';
	import { cn } from '$lib/utils';

	type State = 'loading' | 'error' | 'disconnected' | 'ready';

	let {
		state,
		title,
		detail,
		class: className = ''
	}: {
		state: State;
		title: string;
		detail: string;
		class?: string;
	} = $props();

	const icons = {
		loading: Loader2,
		error: AlertCircle,
		disconnected: Unplug,
		ready: CheckCircle2
	};

	let Icon = $derived(icons[state]);
</script>

<div class={cn('flex min-h-28 items-center gap-3 rounded-md border bg-muted/25 p-4', className)}>
	<div class="flex size-9 shrink-0 items-center justify-center rounded-md border bg-background">
		<Icon class={cn('size-4', state === 'loading' && 'animate-spin')} />
	</div>
	<div class="min-w-0">
		<p class="truncate text-sm font-medium">{title}</p>
		<p class="text-xs text-muted-foreground">{detail}</p>
	</div>
</div>
