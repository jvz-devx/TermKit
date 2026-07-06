<script lang="ts">
	import { page } from '$app/state';
	import AppSidebar from '$lib/components/app-sidebar.svelte';
	import * as Breadcrumb from '$lib/components/ui/breadcrumb/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import HostShareInbox from './HostShareInbox.svelte';
	import PwaInstallPrompt from './PwaInstallPrompt.svelte';

	type ShellUser = {
		username: string;
		isAdmin: boolean;
	} | null;

	let { children, user }: { children: import('svelte').Snippet; user?: ShellUser } = $props();

	const titles: Record<string, string> = {
		'/hosts': 'Hosts',
		'/sessions': 'Sessions',
		'/history': 'History',
		'/credentials': 'Credentials',
		'/import': 'Import',
		'/admin': 'Admin',
		'/settings': 'Settings'
	};

	const pageTitle = $derived(titleForPath(page.url.pathname));
	const isSessionsRoute = $derived(page.url.pathname.startsWith('/sessions'));

	function titleForPath(pathname: string) {
		if (titles[pathname]) return titles[pathname];

		return 'Operations';
	}

	function sidebarUser(user: { username: string; isAdmin: boolean } | null) {
		const username = user?.username?.trim() || 'User';
		return {
			name: username,
			email: user?.isAdmin ? 'admin' : 'standard user',
			initials: initials(username)
		};
	}

	function initials(value: string) {
		const parts = value
			.split(/[^a-z0-9]+/i)
			.map((part) => part.trim())
			.filter(Boolean);
		const raw = parts.length >= 2 ? `${parts[0][0]}${parts[1][0]}` : value.slice(0, 2);
		return raw.toUpperCase();
	}
</script>

<Sidebar.Provider>
	<AppSidebar user={sidebarUser(user ?? null)} isAdmin={user?.isAdmin ?? false} />
	<Sidebar.Inset class="h-svh min-h-0 overflow-hidden">
		<header
			class="flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-4 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12"
		>
			<div class="flex items-center gap-2">
				<Sidebar.Trigger class="-ms-1" />
				<Separator orientation="vertical" class="me-2 data-[orientation=vertical]:h-4" />
				<Breadcrumb.Root>
					<Breadcrumb.List>
						<Breadcrumb.Item class="hidden md:block">
							<Breadcrumb.Link href="/">TermKit</Breadcrumb.Link>
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
				App session
			</div>
		</header>
		<main
			class={isSessionsRoute ? 'min-h-0 flex-1 overflow-hidden' : 'min-h-0 flex-1 overflow-auto'}
		>
			{@render children()}
		</main>
	</Sidebar.Inset>
	<HostShareInbox />
	<PwaInstallPrompt />
</Sidebar.Provider>
