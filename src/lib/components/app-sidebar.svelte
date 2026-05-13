<script lang="ts" module>
	import DatabaseZapIcon from '@lucide/svelte/icons/database-zap';
	import FolderSyncIcon from '@lucide/svelte/icons/folder-sync';
	import KeyRoundIcon from '@lucide/svelte/icons/key-round';
	import MonitorIcon from '@lucide/svelte/icons/monitor';
	import NetworkIcon from '@lucide/svelte/icons/network';
	import ServerIcon from '@lucide/svelte/icons/server';
	import Settings2Icon from '@lucide/svelte/icons/settings-2';
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
	import SquareTerminalIcon from '@lucide/svelte/icons/square-terminal';
	import TerminalIcon from '@lucide/svelte/icons/terminal';
	import { listHosts, type HostSummary } from '$lib/termix.remote';

	const data = {
		user: {
			name: 'Operator',
			email: 'local session',
			initials: 'OP'
		},
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
					{ title: 'Importer', url: '/import' }
				]
			},
			{
				title: 'Sessions',
				url: '/sessions',
				icon: SquareTerminalIcon,
				items: [
					{ title: 'Workspace', url: '/sessions' },
					{ title: 'SSH terminal', url: '/sessions?tab=ssh' },
					{ title: 'SFTP files', url: '/sessions?tab=sftp' },
					{ title: 'RDP canvas', url: '/sessions?tab=rdp' },
					{ title: 'VNC canvas', url: '/sessions?tab=vnc' },
					{ title: 'Telnet terminal', url: '/sessions?tab=telnet' }
				]
			},
			{
				title: 'Security',
				url: '/credentials',
				icon: ShieldCheckIcon,
				items: [
					{ title: 'Credential vault', url: '/credentials' },
					{ title: 'Settings', url: '/settings' }
				]
			},
			{
				title: 'Settings',
				url: '/settings',
				icon: Settings2Icon,
				items: [{ title: 'Application', url: '/settings' }]
			}
		],
		projects: [{ name: 'Import Termix', url: '/import', icon: FolderSyncIcon }]
	};

	const protocolIcons = {
		ssh: TerminalIcon,
		rdp: MonitorIcon,
		vnc: NetworkIcon,
		telnet: KeyRoundIcon
	};

	function hostProjects(hosts: HostSummary[]) {
		return [
			...hosts.slice(0, 6).map((host) => ({
				name: host.name,
				url: `/sessions?host=${encodeURIComponent(host.id)}&tab=${host.protocol}`,
				icon: protocolIcons[host.protocol]
			})),
			...data.projects
		];
	}
</script>

<script lang="ts">
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import type { ComponentProps } from 'svelte';
	import NavMain from './nav-main.svelte';
	import NavProjects from './nav-projects.svelte';
	import NavUser from './nav-user.svelte';
	import TeamSwitcher from './team-switcher.svelte';

	let {
		ref = $bindable(null),
		collapsible = 'icon',
		...restProps
	}: ComponentProps<typeof Sidebar.Root> = $props();

	const hostsQuery = listHosts();
	let projects = $derived(hostProjects(hostsQuery.current ?? []));
</script>

<Sidebar.Root bind:ref {collapsible} {...restProps}>
	<Sidebar.Header>
		<TeamSwitcher teams={data.teams} />
	</Sidebar.Header>
	<Sidebar.Content>
		<NavMain items={data.navMain} />
		<NavProjects {projects} />
	</Sidebar.Content>
	<Sidebar.Footer>
		<NavUser user={data.user} />
	</Sidebar.Footer>
	<Sidebar.Rail />
</Sidebar.Root>
