<script lang="ts">
	import { page } from '$app/state';
	import AppSidebar from '$lib/components/app-sidebar.svelte';
	import * as Breadcrumb from '$lib/components/ui/breadcrumb/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';

	let { children }: { children: import('svelte').Snippet } = $props();

	const titles: Record<string, string> = {
		'/hosts': 'Hosts',
		'/sessions': 'Sessions',
		'/credentials': 'Credentials',
		'/import': 'Import',
		'/settings': 'Settings'
	};

	const pageTitle = $derived(titles[page.url.pathname] ?? 'Operations');
</script>

<Sidebar.Provider>
	<AppSidebar />
	<Sidebar.Inset>
		<header
			class="flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-4 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12"
		>
			<div class="flex items-center gap-2">
				<Sidebar.Trigger class="-ms-1" />
				<Separator orientation="vertical" class="me-2 data-[orientation=vertical]:h-4" />
				<Breadcrumb.Root>
					<Breadcrumb.List>
						<Breadcrumb.Item class="hidden md:block">
							<Breadcrumb.Link href="/">TermixKit</Breadcrumb.Link>
						</Breadcrumb.Item>
						<Breadcrumb.Separator class="hidden md:block" />
						<Breadcrumb.Item>
							<Breadcrumb.Page>{pageTitle}</Breadcrumb.Page>
						</Breadcrumb.Item>
					</Breadcrumb.List>
				</Breadcrumb.Root>
			</div>
			<div class="ms-auto flex items-center gap-2 text-xs text-muted-foreground">
				<span class="size-2 rounded-full bg-emerald-500"></span>
				Connected
			</div>
		</header>
		<main class="min-h-0 flex-1 overflow-auto">{@render children()}</main>
	</Sidebar.Inset>
</Sidebar.Provider>
