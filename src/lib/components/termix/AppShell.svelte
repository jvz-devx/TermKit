<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { DatabaseZap, LogOut, PanelLeftClose, Plus } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Separator } from '$lib/components/ui/separator';
	import { navigation } from './sample-data';

	let { children }: { children: import('svelte').Snippet } = $props();
</script>

<div class="grid min-h-screen bg-background text-foreground lg:grid-cols-[240px_1fr]">
	<aside class="hidden border-r bg-muted/20 lg:flex lg:flex-col">
		<div class="flex h-12 items-center gap-2 border-b px-3">
			<div
				class="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground"
			>
				<DatabaseZap class="size-4" />
			</div>
			<div class="min-w-0">
				<p class="truncate text-sm font-semibold">TermixKit</p>
				<p class="truncate text-[11px] text-muted-foreground">Remote operations</p>
			</div>
		</div>
		<nav class="flex-1 space-y-1 p-2">
			{#each navigation as item (item.href)}
				<a
					href={resolve(item.href)}
					class="flex h-9 items-center gap-2 rounded-md px-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground data-[active=true]:bg-accent data-[active=true]:text-accent-foreground"
					data-active={page.url.pathname === item.href ||
						page.url.pathname.startsWith(`${item.href}/`)}
				>
					<item.icon class="size-4" />
					<span>{item.label}</span>
				</a>
			{/each}
		</nav>
		<Separator />
		<div class="space-y-2 p-2">
			<Button class="w-full justify-start" size="sm" href="/hosts">
				<Plus class="size-4" />
				New host
			</Button>
			<Button class="w-full justify-start" variant="ghost" size="sm" href="/login">
				<LogOut class="size-4" />
				Sign out
			</Button>
		</div>
	</aside>

	<div class="flex min-w-0 flex-col">
		<header class="flex h-12 items-center justify-between border-b bg-background/95 px-3">
			<div class="flex items-center gap-2">
				<Button variant="ghost" size="icon" class="lg:hidden" aria-label="Open navigation">
					<PanelLeftClose class="size-4" />
				</Button>
				<div>
					<p class="text-sm font-medium">Operations console</p>
					<p class="hidden text-xs text-muted-foreground sm:block">
						Hosts, credentials, and active sessions
					</p>
				</div>
			</div>
			<div class="flex items-center gap-2 text-xs text-muted-foreground">
				<span class="size-2 rounded-full bg-emerald-500"></span>
				Connected
			</div>
		</header>
		<main class="min-h-0 flex-1 overflow-auto">{@render children()}</main>
	</div>
</div>
