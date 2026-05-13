import {
	Database,
	FolderSync,
	Monitor,
	Network,
	Server,
	Settings,
	ShieldCheck,
	Terminal
} from '@lucide/svelte';

export type Protocol = 'ssh' | 'sftp' | 'rdp' | 'vnc' | 'telnet';
export type Host = {
	id: string;
	name: string;
	protocol: Exclude<Protocol, 'sftp'>;
	hostname: string;
	port: number;
	username: string;
	folder: string;
	tags: string[];
	status: 'online' | 'offline' | 'unknown';
	lastSeen: string;
	credential: string;
};

export const navigation = [
	{ href: '/hosts', label: 'Hosts', icon: Server },
	{ href: '/sessions', label: 'Sessions', icon: Terminal },
	{ href: '/credentials', label: 'Credentials', icon: ShieldCheck },
	{ href: '/import', label: 'Import', icon: FolderSync },
	{ href: '/settings', label: 'Settings', icon: Settings }
] as const;

export const hosts: Host[] = [
	{
		id: 'edge-01',
		name: 'edge-01',
		protocol: 'ssh',
		hostname: '10.40.0.11',
		port: 22,
		username: 'ops',
		folder: 'Production',
		tags: ['linux', 'gateway'],
		status: 'online',
		lastSeen: 'active now',
		credential: 'ops ssh key'
	},
	{
		id: 'win-admin',
		name: 'win-admin',
		protocol: 'rdp',
		hostname: '10.40.3.18',
		port: 3389,
		username: 'administrator',
		folder: 'Production',
		tags: ['windows', 'jumpbox'],
		status: 'unknown',
		lastSeen: '12m ago',
		credential: 'domain password'
	},
	{
		id: 'nas-console',
		name: 'nas-console',
		protocol: 'vnc',
		hostname: '10.40.1.20',
		port: 5900,
		username: 'console',
		folder: 'Storage',
		tags: ['vnc'],
		status: 'offline',
		lastSeen: '2h ago',
		credential: 'console password'
	},
	{
		id: 'switch-a',
		name: 'switch-a',
		protocol: 'telnet',
		hostname: '10.40.8.4',
		port: 23,
		username: 'admin',
		folder: 'Network',
		tags: ['legacy', 'network'],
		status: 'online',
		lastSeen: '4m ago',
		credential: 'network password'
	}
];

export const credentials = [
	{
		id: 'ops-ssh-key',
		name: 'ops ssh key',
		kind: 'SSH key',
		username: 'ops',
		usedBy: 8,
		rotation: '91d'
	},
	{
		id: 'domain-password',
		name: 'domain password',
		kind: 'Password',
		username: 'administrator',
		usedBy: 3,
		rotation: '27d'
	},
	{
		id: 'console-password',
		name: 'console password',
		kind: 'Password',
		username: 'console',
		usedBy: 2,
		rotation: '120d'
	}
];

export const protocolTabs = [
	{ value: 'ssh', label: 'SSH', icon: Terminal },
	{ value: 'sftp', label: 'SFTP', icon: Database },
	{ value: 'rdp', label: 'RDP', icon: Monitor },
	{ value: 'vnc', label: 'VNC', icon: Network },
	{ value: 'telnet', label: 'Telnet', icon: Terminal }
] satisfies Array<{ value: Protocol; label: string; icon: typeof Terminal }>;
