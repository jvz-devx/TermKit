<script lang="ts">
	import { onMount } from 'svelte';
	import StatePanel from '../../StatePanel.svelte';

	let {
		title = 'Opening RDP session',
		detail = 'Preparing a persistent RDP session.',
		onCreate
	}: {
		title?: string;
		detail?: string;
		onCreate: () => void;
	} = $props();

	onMount(() => {
		onCreate();
	});
</script>

<StatePanel state="loading" {title} {detail} />
