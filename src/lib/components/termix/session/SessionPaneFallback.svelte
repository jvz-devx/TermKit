<script lang="ts">
	import type { HostSummary } from '$lib/termix.remote';
	import StatePanel from '../StatePanel.svelte';
	import type { SessionPaneKind } from './workspace-layout';

	const titles: Record<SessionPaneKind, string> = {
		ssh: 'SSH unavailable',
		sftp: 'SFTP unavailable',
		rdp: 'RDP unavailable',
		vnc: 'VNC unavailable',
		telnet: 'Telnet unavailable',
		ftp: 'FTP unavailable',
		ftps: 'FTPS unavailable',
		'ssh-tunnel': 'SSH tunnel unavailable'
	};

	let {
		kind,
		host
	}: {
		kind: SessionPaneKind;
		host: HostSummary;
	} = $props();

	let detail = $derived(fallbackDetail(kind, host));

	function fallbackDetail(paneKind: SessionPaneKind, paneHost: HostSummary) {
		if (paneKind === 'sftp' && paneHost.protocol !== 'ssh') {
			return 'SFTP uses the SSH host adapter. Select an SSH host to open this pane.';
		}
		if (paneKind === 'ftp' || paneKind === 'ftps') {
			return `${paneKind.toUpperCase()} panes require a saved ${paneKind.toUpperCase()} host.`;
		}
		if (paneKind === 'ssh-tunnel') {
			return 'SSH tunnel panes require a saved SSH host.';
		}
		return `${paneKind.toUpperCase()} is not available for ${paneHost.name}.`;
	}
</script>

<div class="min-h-0 flex-1 p-3">
	<StatePanel state="disconnected" title={titles[kind]} {detail} />
</div>
