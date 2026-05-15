<script lang="ts">
	import { onMount } from 'svelte';
	import { Download, MonitorDown, X } from '@lucide/svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';

	type BeforeInstallPromptEvent = Event & {
		prompt: () => Promise<void>;
		userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
	};

	const dismissedStorageKey = 'termixkit:pwa-install-dismissed-at';
	const dismissedTtlMs = 7 * 24 * 60 * 60 * 1000;

	let installPrompt = $state<BeforeInstallPromptEvent | null>(null);
	let visible = $state(false);

	onMount(() => {
		if (isStandalone() || recentlyDismissed()) return;

		const handleBeforeInstallPrompt = (event: Event) => {
			event.preventDefault();
			installPrompt = event as BeforeInstallPromptEvent;
			visible = true;
		};
		const handleAppInstalled = () => {
			visible = false;
			installPrompt = null;
			localStorage.removeItem(dismissedStorageKey);
		};

		window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
		window.addEventListener('appinstalled', handleAppInstalled);

		return () => {
			window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
			window.removeEventListener('appinstalled', handleAppInstalled);
		};
	});

	async function install() {
		if (!installPrompt) return;

		const prompt = installPrompt;
		visible = false;
		installPrompt = null;
		await prompt.prompt();
		const choice = await prompt.userChoice;
		if (choice.outcome === 'dismissed') rememberDismissed();
	}

	function dismiss() {
		visible = false;
		installPrompt = null;
		rememberDismissed();
	}

	function rememberDismissed() {
		localStorage.setItem(dismissedStorageKey, Date.now().toString());
	}

	function recentlyDismissed() {
		const raw = localStorage.getItem(dismissedStorageKey);
		const dismissedAt = raw ? Number(raw) : 0;
		return Number.isFinite(dismissedAt) && Date.now() - dismissedAt < dismissedTtlMs;
	}

	function isStandalone() {
		const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
		return (
			window.matchMedia('(display-mode: standalone)').matches ||
			Boolean(navigatorWithStandalone.standalone)
		);
	}
</script>

{#if visible && installPrompt}
	<section
		class="fixed right-3 bottom-3 z-50 w-[min(calc(100vw-1.5rem),24rem)] overflow-hidden rounded-md border bg-background shadow-xl"
		aria-label="Install TermixKit"
	>
		<div class="flex items-start gap-3 border-b bg-muted/30 p-3">
			<div
				class="grid size-9 shrink-0 place-items-center rounded-md border bg-zinc-950 text-cyan-300"
			>
				<MonitorDown class="size-4" />
			</div>
			<div class="min-w-0 flex-1">
				<div class="flex items-center gap-2">
					<h2 class="truncate text-sm font-semibold">Install TermixKit</h2>
					<Badge variant="secondary">PWA</Badge>
				</div>
				<p class="mt-1 text-xs text-muted-foreground">
					Open it as a standalone app with cached shell assets.
				</p>
			</div>
			<Button size="icon-sm" variant="ghost" aria-label="Dismiss install prompt" onclick={dismiss}>
				<X class="size-4" />
			</Button>
		</div>
		<div class="flex justify-end gap-2 p-3">
			<Button size="sm" variant="outline" onclick={dismiss}>Not now</Button>
			<Button size="sm" onclick={install}>
				<Download class="size-4" />
				Install
			</Button>
		</div>
	</section>
{/if}
