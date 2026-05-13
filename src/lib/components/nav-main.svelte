<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import * as Collapsible from '$lib/components/ui/collapsible/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import type { Component } from 'svelte';

	let {
		items
	}: {
		items: {
			title: string;
			url: string;
			icon?: Component;
			isActive?: boolean;
			items?: {
				title: string;
				url: string;
			}[];
		}[];
	} = $props();

	function isPathActive(url: string) {
		const [pathname] = url.split('?');
		return page.url.pathname === pathname || page.url.pathname.startsWith(`${pathname}/`);
	}

	function isSubItemActive(url: string) {
		const [pathname, query = ''] = url.split('?');
		if (page.url.pathname !== pathname) return false;
		if (!query) return page.url.search === '';

		const targetParams = new URLSearchParams(query);
		for (const [key, value] of targetParams) {
			if (page.url.searchParams.get(key) !== value) return false;
		}
		return true;
	}

	function isItemActive(item: {
		url: string;
		items?: {
			title: string;
			url: string;
		}[];
	}) {
		return (
			isPathActive(item.url) || Boolean(item.items?.some((subItem) => isSubItemActive(subItem.url)))
		);
	}

	function resolved(url: string) {
		return resolve(url as '/');
	}
</script>

<Sidebar.Group>
	<Sidebar.GroupLabel>Platform</Sidebar.GroupLabel>
	<Sidebar.Menu>
		{#each items as item (item.title)}
			<Collapsible.Root open={item.isActive ?? isItemActive(item)} class="group/collapsible">
				{#snippet child({ props })}
					<Sidebar.MenuItem {...props}>
						<Collapsible.Trigger>
							{#snippet child({ props })}
								<Sidebar.MenuButton {...props} tooltipContent={item.title}>
									{#if item.icon}
										<item.icon />
									{/if}
									<span>{item.title}</span>
									<ChevronRightIcon
										class="ms-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90"
									/>
								</Sidebar.MenuButton>
							{/snippet}
						</Collapsible.Trigger>
						<Collapsible.Content>
							<Sidebar.MenuSub>
								{#each item.items ?? [] as subItem (subItem.title)}
									<Sidebar.MenuSubItem>
										<Sidebar.MenuSubButton>
											{#snippet child({ props })}
												<a
													href={resolved(subItem.url)}
													data-active={isSubItemActive(subItem.url)}
													{...props}
												>
													<span>{subItem.title}</span>
												</a>
											{/snippet}
										</Sidebar.MenuSubButton>
									</Sidebar.MenuSubItem>
								{/each}
							</Sidebar.MenuSub>
						</Collapsible.Content>
					</Sidebar.MenuItem>
				{/snippet}
			</Collapsible.Root>
		{/each}
	</Sidebar.Menu>
</Sidebar.Group>
