<script lang="ts">
	import { resolve } from '$app/paths';
	import { appBuildInfo } from '$lib/app-version';
	import { logoutForm } from '$lib/remotes/auth.remote';
	import * as Avatar from '$lib/components/ui/avatar/index.js';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import { useSidebar } from '$lib/components/ui/sidebar/index.js';
	import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down';
	import InfoIcon from '@lucide/svelte/icons/info';
	import LaptopIcon from '@lucide/svelte/icons/laptop';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import MoonIcon from '@lucide/svelte/icons/moon';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
	import SunIcon from '@lucide/svelte/icons/sun';
	import { setMode, userPrefersMode } from 'mode-watcher';

	let { user }: { user: { name: string; email: string; initials: string } } = $props();
	const sidebar = useSidebar();
	type ThemeMode = 'light' | 'dark' | 'system';
	const themeModes = ['light', 'dark', 'system'] as const;
	let aboutOpen = $state(false);

	function setThemeMode(value: string) {
		if (!themeModes.includes(value as ThemeMode)) return;
		setMode(value as ThemeMode);
	}
</script>

<Sidebar.Menu>
	<Sidebar.MenuItem>
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<Sidebar.MenuButton
						size="lg"
						aria-label="Account menu"
						tooltipContent="Account menu"
						class="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
						{...props}
					>
						<Avatar.Root class="size-8 rounded-lg">
							<Avatar.Fallback class="rounded-lg">{user.initials}</Avatar.Fallback>
						</Avatar.Root>
						<div class="grid flex-1 text-start text-sm leading-tight">
							<span class="truncate font-medium">{user.name}</span>
							<span class="truncate text-xs">{user.email}</span>
						</div>
						<ChevronsUpDownIcon class="ms-auto size-4" />
					</Sidebar.MenuButton>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content
				class="w-(--bits-dropdown-menu-anchor-width) min-w-56 rounded-lg"
				side={sidebar.isMobile ? 'bottom' : 'right'}
				align="end"
				sideOffset={4}
			>
				<DropdownMenu.Label class="p-0 font-normal">
					<div class="flex items-center gap-2 px-1 py-1.5 text-start text-sm">
						<Avatar.Root class="size-8 rounded-lg">
							<Avatar.Fallback class="rounded-lg">{user.initials}</Avatar.Fallback>
						</Avatar.Root>
						<div class="grid flex-1 text-start text-sm leading-tight">
							<span class="truncate font-medium">{user.name}</span>
							<span class="truncate text-xs">{user.email}</span>
						</div>
					</div>
				</DropdownMenu.Label>
				<DropdownMenu.Separator />
				<DropdownMenu.Group>
					<DropdownMenu.Item>
						{#snippet child({ props })}
							<a href={resolve('/credentials')} {...props}>
								<ShieldCheckIcon />
								Credentials
							</a>
						{/snippet}
					</DropdownMenu.Item>
					<DropdownMenu.Item>
						{#snippet child({ props })}
							<a href={resolve('/settings')} {...props}>
								<SettingsIcon />
								Settings
							</a>
						{/snippet}
					</DropdownMenu.Item>
				</DropdownMenu.Group>
				<DropdownMenu.Separator />
				<DropdownMenu.Label>Theme</DropdownMenu.Label>
				<DropdownMenu.RadioGroup
					value={userPrefersMode.current}
					onValueChange={setThemeMode}
					aria-label="Theme"
				>
					<DropdownMenu.RadioItem value="light">
						<SunIcon />
						Light
					</DropdownMenu.RadioItem>
					<DropdownMenu.RadioItem value="dark">
						<MoonIcon />
						Dark
					</DropdownMenu.RadioItem>
					<DropdownMenu.RadioItem value="system">
						<LaptopIcon />
						System
					</DropdownMenu.RadioItem>
				</DropdownMenu.RadioGroup>
				<DropdownMenu.Separator />
				<DropdownMenu.Item onclick={() => (aboutOpen = true)}>
					<InfoIcon />
					About TermixKit
				</DropdownMenu.Item>
				<form {...logoutForm}>
					<DropdownMenu.Item>
						{#snippet child({ props })}
							<button type="submit" disabled={logoutForm.pending > 0} {...props}>
								<LogOutIcon />
								Log out
							</button>
						{/snippet}
					</DropdownMenu.Item>
				</form>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	</Sidebar.MenuItem>
</Sidebar.Menu>

<Dialog.Root bind:open={aboutOpen}>
	<Dialog.Content class="max-w-md">
		<Dialog.Header>
			<Dialog.Title>About TermixKit</Dialog.Title>
			<Dialog.Description>
				Running build {appBuildInfo.displayVersion}
			</Dialog.Description>
		</Dialog.Header>
		<div class="grid gap-3 text-sm">
			<div class="grid grid-cols-[7rem_minmax(0,1fr)] gap-2">
				<span class="text-muted-foreground">Version</span>
				<span class="font-mono">{appBuildInfo.shortCommitSha}</span>
			</div>
			<div class="grid grid-cols-[7rem_minmax(0,1fr)] gap-2">
				<span class="text-muted-foreground">Commit</span>
				<span class="truncate font-mono" title={appBuildInfo.commitSha}>
					{appBuildInfo.commitSha}
				</span>
			</div>
			<div class="grid grid-cols-[7rem_minmax(0,1fr)] gap-2">
				<span class="text-muted-foreground">Package</span>
				<span class="font-mono">{appBuildInfo.packageVersion}</span>
			</div>
			<div class="grid grid-cols-[7rem_minmax(0,1fr)] gap-2">
				<span class="text-muted-foreground">Built</span>
				<span class="font-mono">{appBuildInfo.buildDate}</span>
			</div>
			<div class="grid grid-cols-[7rem_minmax(0,1fr)] gap-2">
				<span class="text-muted-foreground">Mode</span>
				<span>{appBuildInfo.environment}</span>
			</div>
		</div>
	</Dialog.Content>
</Dialog.Root>
