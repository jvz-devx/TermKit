<script lang="ts">
	import AuthPanel from '$lib/components/termix/AuthPanel.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<AuthPanel mode="login" microsoftAuth={data.microsoftAuth} />
