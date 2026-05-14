<script lang="ts" module>
	import DatabaseZapIcon from '@lucide/svelte/icons/database-zap';
	import ServerIcon from '@lucide/svelte/icons/server';
	import Settings2Icon from '@lucide/svelte/icons/settings-2';
	import SquareTerminalIcon from '@lucide/svelte/icons/square-terminal';

	const data = {
		teams: [
			{
				name: 'TermixKit',
				logo: DatabaseZapIcon,
				plan: 'Operations'
			}
		],
		navMain: [
			{
				title: 'Inventory',
				url: '/hosts',
				icon: ServerIcon,
				items: [
					{ title: 'Hosts', url: '/hosts' },
					{ title: 'Credentials', url: '/credentials' },
					{ title: 'Import from Termix', url: '/import' }
				]
			},
			{
				title: 'Connections',
				url: '/sessions',
				icon: SquareTerminalIcon,
				items: [{ title: 'Session workspace', url: '/sessions' }]
			},
			{
				title: 'Administration',
				url: '/settings',
				icon: Settings2Icon,
				items: [{ title: 'Application', url: '/settings' }]
			}
		]
	};
</script>

<script lang="ts">
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import type { ComponentProps } from 'svelte';
	import NavMain from './nav-main.svelte';
	import NavUser from './nav-user.svelte';
	import TeamSwitcher from './team-switcher.svelte';

	type SidebarUser = {
		name: string;
		email: string;
		initials: string;
	};

	let {
		user,
		ref = $bindable(null),
		collapsible = 'icon',
		...restProps
	}: ComponentProps<typeof Sidebar.Root> & { user: SidebarUser } = $props();
</script>

<Sidebar.Root bind:ref {collapsible} {...restProps}>
	<Sidebar.Header>
		<TeamSwitcher teams={data.teams} />
	</Sidebar.Header>
	<Sidebar.Content>
		<NavMain items={data.navMain} />
	</Sidebar.Content>
	<Sidebar.Footer>
		<NavUser {user} />
	</Sidebar.Footer>
	<Sidebar.Rail />
</Sidebar.Root>
