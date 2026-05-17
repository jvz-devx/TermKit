<script lang="ts">
	import type { HostSummary } from '$lib/remotes/sessions.remote';
	import StatePanel from '../../StatePanel.svelte';
	import type { SessionPaneKind } from './workspace-layout';

	const titles: Record<SessionPaneKind, string> = {
		ssh: 'SSH unsupported for this host',
		sftp: 'SFTP unsupported for this host',
		rdp: 'RDP unsupported for this host',
		vnc: 'VNC unsupported for this host',
		telnet: 'Telnet unsupported for this host',
		ftp: 'FTP unsupported for this host',
		ftps: 'FTPS unsupported for this host',
		'ssh-tunnel': 'SSH tunnel unsupported for this host'
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
			return `${paneHost.name} is a ${paneHost.protocol.toUpperCase()} host. SFTP uses the SSH adapter; select an SSH host or switch this pane to ${paneHost.protocol.toUpperCase()}.`;
		}
		if (paneKind === 'ftp' || paneKind === 'ftps') {
			return `${paneHost.name} is a ${paneHost.protocol.toUpperCase()} host. ${paneKind.toUpperCase()} panes require a saved ${paneKind.toUpperCase()} host.`;
		}
		if (paneKind === 'ssh-tunnel') {
			return `${paneHost.name} is a ${paneHost.protocol.toUpperCase()} host. SSH tunnel panes require a saved SSH host.`;
		}
		return `${paneHost.name} is a ${paneHost.protocol.toUpperCase()} host. Select a ${paneKind.toUpperCase()} host or switch this pane back to ${paneHost.protocol.toUpperCase()}.`;
	}
</script>

<div class="min-h-0 flex-1 p-3">
	<StatePanel state="error" title={titles[kind]} {detail} />
</div>
