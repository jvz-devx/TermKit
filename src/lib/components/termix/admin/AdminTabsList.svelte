<script lang="ts">
	import { Cable, Clock3, Server, Settings2, SquareTerminal, Users } from '@lucide/svelte';
	import * as Tabs from '$lib/components/ui/tabs';
</script>

<Tabs.List class="max-w-full flex-wrap justify-start">
	<Tabs.Trigger value="users"><Users class="size-4" />Users</Tabs.Trigger>
	<Tabs.Trigger value="live"><SquareTerminal class="size-4" />Live sessions</Tabs.Trigger>
	<Tabs.Trigger value="tunnels"><Cable class="size-4" />Tunnels</Tabs.Trigger>
	<Tabs.Trigger value="transfers"><Server class="size-4" />FTP/FTPS</Tabs.Trigger>
	<Tabs.Trigger value="history"><Clock3 class="size-4" />History</Tabs.Trigger>
	<Tabs.Trigger value="settings"><Settings2 class="size-4" />Settings</Tabs.Trigger>
</Tabs.List>
