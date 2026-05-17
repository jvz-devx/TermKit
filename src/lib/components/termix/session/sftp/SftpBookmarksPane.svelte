<script lang="ts">
	import {
		Bookmark,
		ChevronDown,
		ChevronRight,
		File as FileIcon,
		FileSymlink,
		Folder,
		X
	} from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import type { RemoteEntry } from './file-manager-state';

	type BookmarkEntry = {
		id: string;
		path: string;
		label: string;
		createdAt: string;
	};

	let {
		path,
		bookmarks,
		bookmarksOpen = $bindable(true),
		remoteSearchResults,
		loadDirectory,
		removeBookmark,
		openSearchResult
	}: {
		path: string;
		bookmarks: BookmarkEntry[];
		bookmarksOpen: boolean;
		remoteSearchResults: RemoteEntry[];
		loadDirectory: (path: string) => void | Promise<void>;
		removeBookmark: (id: string) => void;
		openSearchResult: (entry: RemoteEntry) => void | Promise<void>;
	} = $props();
</script>

<aside
	class={`h-full min-h-0 border-b p-2 transition-[padding] lg:border-r lg:border-b-0 ${
		bookmarksOpen ? '' : 'lg:p-1'
	}`}
>
	<Collapsible.Root bind:open={bookmarksOpen}>
		<Collapsible.Trigger
			class={`mb-2 flex h-7 w-full items-center rounded-md text-xs font-medium text-muted-foreground outline-hidden hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring ${
				bookmarksOpen ? 'justify-between px-1 text-left' : 'justify-center px-0'
			}`}
			aria-label={`${bookmarksOpen ? 'Collapse' : 'Expand'} bookmarks`}
			title={`${bookmarksOpen ? 'Collapse' : 'Expand'} bookmarks`}
		>
			<span
				class={`flex min-w-0 items-center ${bookmarksOpen ? 'gap-1.5' : 'justify-center gap-1'}`}
			>
				{#if bookmarksOpen}
					<ChevronDown class="size-3.5 shrink-0" />
				{:else}
					<ChevronRight class="size-3.5 shrink-0" />
				{/if}
				{#if bookmarksOpen}
					<span>Bookmarks</span>
					<span class="text-[11px] text-muted-foreground/75">({bookmarks.length})</span>
				{/if}
			</span>
			<Bookmark class="size-3.5 shrink-0 text-muted-foreground" />
		</Collapsible.Trigger>
		<Collapsible.Content>
			<div class="space-y-1">
				{#each bookmarks as bookmark (bookmark.id)}
					<div class="flex items-center gap-1">
						<Button
							size="xs"
							variant={bookmark.path === path ? 'secondary' : 'ghost'}
							class="min-w-0 flex-1 justify-start font-mono"
							title={bookmark.path}
							onclick={() => loadDirectory(bookmark.path)}
						>
							<span class="truncate">{bookmark.label}</span>
						</Button>
						<Button
							size="icon-xs"
							variant="ghost"
							aria-label={`Remove bookmark ${bookmark.path}`}
							onclick={() => removeBookmark(bookmark.id)}
						>
							<X class="size-3" />
						</Button>
					</div>
				{:else}
					<div class="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
						No bookmarks for this host.
					</div>
				{/each}
			</div>
		</Collapsible.Content>
	</Collapsible.Root>

	{#if bookmarksOpen && remoteSearchResults.length}
		<div class="mt-4 border-t pt-3">
			<div class="mb-2 text-xs font-medium text-muted-foreground">
				Search results ({remoteSearchResults.length})
			</div>
			<div class="max-h-52 space-y-1 overflow-auto">
				{#each remoteSearchResults as result (result.path)}
					<Button
						size="xs"
						variant="ghost"
						class="w-full justify-start font-mono"
						title={result.path}
						onclick={() => openSearchResult(result)}
					>
						{#if result.type === 'directory'}
							<Folder class="size-3.5 text-amber-500" />
						{:else if result.type === 'symlink'}
							<FileSymlink class="size-3.5 text-sky-500" />
						{:else}
							<FileIcon class="size-3.5 text-muted-foreground" />
						{/if}
						<span class="truncate">{result.path}</span>
					</Button>
				{/each}
			</div>
		</div>
	{/if}
</aside>
