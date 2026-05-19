<script lang="ts" module>
	import DatabaseZapIcon from '@lucide/svelte/icons/database-zap';
	import ServerIcon from '@lucide/svelte/icons/server';
	import Settings2Icon from '@lucide/svelte/icons/settings-2';
	import SquareTerminalIcon from '@lucide/svelte/icons/square-terminal';
	import WorkflowIcon from '@lucide/svelte/icons/workflow';
	import type { Component } from 'svelte';

	type NavItem = {
		title: string;
		url: string;
		icon?: Component;
		adminOnly?: boolean;
		items?: {
			title: string;
			url: string;
			adminOnly?: boolean;
		}[];
	};

	const data: {
		teams: {
			name: string;
			logo: Component;
			plan: string;
		}[];
		navMain: NavItem[];
	} = {
		teams: [
			{
				name: 'TermKit',
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
				items: [
					{ title: 'Sessions', url: '/sessions' },
					{ title: 'History', url: '/history' }
				]
			},
			{
				title: 'Fleet operations',
				url: '/fleet',
				icon: WorkflowIcon,
				items: [
					{ title: 'Overview', url: '/fleet' },
					{ title: 'Runbooks', url: '/fleet/runbooks' },
					{ title: 'Targets', url: '/fleet/targets' },
					{ title: 'Executions', url: '/fleet/executions' }
				]
			},
			{
				title: 'Administration',
				url: '/settings',
				icon: Settings2Icon,
				items: [
					{ title: 'Admin panel', url: '/admin', adminOnly: true },
					{ title: 'Application', url: '/settings' }
				]
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
		isAdmin = false,
		ref = $bindable(null),
		collapsible = 'icon',
		...restProps
	}: ComponentProps<typeof Sidebar.Root> & { user: SidebarUser; isAdmin?: boolean } = $props();

	const navItems = $derived(
		data.navMain
			.filter((item) => !item.adminOnly || isAdmin)
			.map((item) => ({
				...item,
				items: item.items?.filter((subItem) => !subItem.adminOnly || isAdmin)
			}))
	);
</script>

<Sidebar.Root bind:ref {collapsible} {...restProps}>
	<Sidebar.Header>
		<TeamSwitcher teams={data.teams} />
	</Sidebar.Header>
	<Sidebar.Content>
		<NavMain items={navItems} />
	</Sidebar.Content>
	<Sidebar.Footer>
		<NavUser {user} />
	</Sidebar.Footer>
	<Sidebar.Rail />
</Sidebar.Root>
