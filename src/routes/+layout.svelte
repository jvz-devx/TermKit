<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<link rel="manifest" href="/manifest.webmanifest" />
	<link rel="apple-touch-icon" href="/pwa/icon.svg" />
	<meta name="application-name" content="TermixKit" />
	<meta name="apple-mobile-web-app-title" content="TermixKit" />
	<meta name="apple-mobile-web-app-capable" content="yes" />
	<meta name="mobile-web-app-capable" content="yes" />
	<meta name="theme-color" content="#18181b" />
</svelte:head>
{@render children()}
