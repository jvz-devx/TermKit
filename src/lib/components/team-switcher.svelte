<script lang="ts">
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';

	// This should be `Component` after @lucide/svelte updates types
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let { teams }: { teams: { name: string; logo: any; plan: string }[] } = $props();

	// svelte-ignore state_referenced_locally
	let activeTeam = $state(teams[0]);
</script>

<Sidebar.Menu>
	<Sidebar.MenuItem>
		<Sidebar.MenuButton size="lg">
			<div
				class="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground"
			>
				<activeTeam.logo class="size-4" />
			</div>
			<div class="grid flex-1 text-start text-sm leading-tight">
				<span class="truncate font-medium">{activeTeam.name}</span>
				<span class="truncate text-xs">{activeTeam.plan}</span>
			</div>
		</Sidebar.MenuButton>
	</Sidebar.MenuItem>
</Sidebar.Menu>
