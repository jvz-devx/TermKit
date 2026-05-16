<script lang="ts">
	import { Download, File as FileIcon, FileSymlink, Folder, Link } from '@lucide/svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Table from '$lib/components/ui/table';
	import StatePanel from '../../StatePanel.svelte';
	import {
		entryTypeLabel,
		formatSize,
		isDownloadableFile,
		type RemoteEntry
	} from '../file-manager-state';

	let {
		path,
		label,
		entries,
		selected,
		selectedPaths,
		selection,
		searchQuery,
		dragging,
		loading,
		error,
		toggleVisible,
		toggleEntry,
		selectEntry,
		activateEntry,
		symlinkTarget,
		modeLabel,
		formatModified,
		downloadUrl
	}: {
		path: string;
		label: string;
		entries: RemoteEntry[];
		selected: RemoteEntry | null;
		selectedPaths: string[];
		selection: { allVisible: boolean; someVisible: boolean };
		searchQuery: string;
		dragging: boolean;
		loading: boolean;
		error: string | null;
		toggleVisible: (checked: boolean) => void;
		toggleEntry: (entry: RemoteEntry, checked: boolean) => void;
		selectEntry: (entry: RemoteEntry) => void;
		activateEntry: (entry: RemoteEntry) => void | Promise<void>;
		symlinkTarget: (entry: RemoteEntry) => string | null;
		modeLabel: (entry: RemoteEntry) => string | null;
		formatModified: (entry: RemoteEntry) => string;
		downloadUrl: (entry: RemoteEntry) => string;
	} = $props();
</script>

<div class="relative h-full min-h-0 min-w-0 overflow-auto">
	{#if dragging}
		<div
			class="pointer-events-none absolute inset-3 z-20 grid place-items-center rounded-md border-2 border-dashed border-primary bg-background/85 text-sm font-medium"
		>
			Drop files or folders to upload into {path}
		</div>
	{/if}

	<Table.Root>
		<Table.Header class="sticky top-0 z-10 bg-background">
			<Table.Row>
				<Table.Head class="w-10">
					<Checkbox
						aria-label="Select visible entries"
						checked={selection.allVisible}
						indeterminate={selection.someVisible}
						onclick={(event) => {
							event.stopPropagation();
							toggleVisible(!selection.allVisible);
						}}
					/>
				</Table.Head>
				<Table.Head>Name</Table.Head>
				<Table.Head class="w-28">Type</Table.Head>
				<Table.Head class="w-28">Size</Table.Head>
				<Table.Head class="w-44">Modified</Table.Head>
				<Table.Head class="w-20" aria-label="Actions"></Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each entries as entry (entry.path)}
				<Table.Row
					data-selected={selected?.path === entry.path || selectedPaths.includes(entry.path)}
					onclick={() => selectEntry(entry)}
				>
					<Table.Cell>
						<Checkbox
							aria-label={`Select ${entry.name}`}
							checked={selectedPaths.includes(entry.path)}
							onclick={(event) => {
								event.stopPropagation();
								toggleEntry(entry, !selectedPaths.includes(entry.path));
							}}
						/>
					</Table.Cell>
					<Table.Cell>
						<Button
							variant="ghost"
							size="sm"
							class="max-w-full justify-start px-1 font-normal"
							title={entry.path}
							onclick={(event) => (event.stopPropagation(), activateEntry(entry))}
						>
							{#if entry.type === 'directory'}
								<Folder class="size-4 text-amber-500" />
							{:else if entry.type === 'symlink'}
								<FileSymlink class="size-4 text-sky-500" />
							{:else}
								<FileIcon class="size-4 text-muted-foreground" />
							{/if}
							<span class="truncate">{entry.name}</span>
						</Button>
						{#if symlinkTarget(entry)}
							<div
								class="mt-1 flex items-center gap-1 pl-1 font-mono text-[11px] text-muted-foreground"
							>
								<Link class="size-3" />
								<span class="truncate">{symlinkTarget(entry)}</span>
							</div>
						{/if}
					</Table.Cell>
					<Table.Cell>
						<Badge variant={entry.type === 'symlink' ? 'outline' : 'secondary'}>
							{entryTypeLabel(entry)}
						</Badge>
					</Table.Cell>
					<Table.Cell class="font-mono text-xs text-muted-foreground">
						{entry.type === 'directory' ? '-' : formatSize(entry.size)}
						{#if modeLabel(entry)}
							<div>{modeLabel(entry)}</div>
						{/if}
					</Table.Cell>
					<Table.Cell class="font-mono text-xs text-muted-foreground">
						{formatModified(entry)}
					</Table.Cell>
					<Table.Cell>
						{#if isDownloadableFile(entry)}
							<Button
								size="icon-sm"
								variant="ghost"
								href={downloadUrl(entry)}
								download={entry.name}
								aria-label={`Download ${entry.name}`}
								onclick={(event) => event.stopPropagation()}
							>
								<Download class="size-4" />
							</Button>
						{/if}
					</Table.Cell>
				</Table.Row>
			{:else}
				<Table.Row>
					<Table.Cell colspan={6} class="h-24 text-center text-muted-foreground">
						{searchQuery ? 'No matching entries.' : 'No entries.'}
					</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>

	{#if loading || error}
		<StatePanel
			state={error ? 'error' : 'loading'}
			title={error ? `${label} request failed` : 'Loading remote directory'}
			detail={error ?? path}
			class="absolute right-3 bottom-3 left-3 bg-background"
		/>
	{/if}
</div>
