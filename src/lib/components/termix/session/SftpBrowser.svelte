<script lang="ts">
	import { onMount } from 'svelte';
	import {
		Download,
		File,
		Folder,
		FolderPlus,
		Pencil,
		RefreshCw,
		Save,
		Trash2,
		Upload
	} from '@lucide/svelte';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Table from '$lib/components/ui/table';
	import { Textarea } from '$lib/components/ui/textarea';
	import StatePanel from '../StatePanel.svelte';

	type SftpEntry = {
		name: string;
		path: string;
		type: 'directory' | 'file' | 'symlink' | 'other';
		size: number;
		mtime: string;
	};

	const sftpUploadMaxBytes = 50 * 1024 * 1024;

	let {
		hostId,
		initialPath = '/',
		apiBase = 'sftp',
		label = 'SFTP'
	}: { hostId: string; initialPath?: string; apiBase?: 'sftp' | 'ftp'; label?: string } = $props();

	let path = $state('/');
	let entries = $state<SftpEntry[]>([]);
	let selected = $state<SftpEntry | null>(null);
	let deleteTarget = $state<SftpEntry | null>(null);
	let deleteDialogOpen = $state(false);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let newFolderName = $state('');
	let renamePath = $state('');
	let textPath = $state<string | null>(null);
	let textValue = $state('');
	let textDirty = $state(false);
	let fileInput: HTMLInputElement;

	async function loadDirectory(nextPath = path) {
		loading = true;
		error = null;

		try {
			const response = await fetch(
				`/api/${apiBase}/${encodeURIComponent(hostId)}/list?path=${encodeURIComponent(nextPath)}`
			);
			const body = await response.json();
			if (!response.ok) throw new Error(body.error ?? 'Could not list directory');
			path = nextPath;
			entries = body.entries;
			selected = null;
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Could not list directory';
		} finally {
			loading = false;
		}
	}

	async function uploadFile() {
		const file = fileInput.files?.[0];
		if (!file) return;
		if (file.size > sftpUploadMaxBytes) {
			error = `File exceeds the ${formatSize(sftpUploadMaxBytes)} upload limit`;
			fileInput.value = '';
			return;
		}

		const form = new FormData();
		form.append('file', file);
		const remotePath = joinPath(path, file.name);
		loading = true;
		error = null;

		try {
			const response = await fetch(
				`/api/${apiBase}/${encodeURIComponent(hostId)}/upload?path=${encodeURIComponent(remotePath)}`,
				{ method: 'POST', body: form }
			);
			const body = await response.json().catch(() => ({}));
			if (!response.ok) throw new Error(body.error ?? 'Could not upload file');
			fileInput.value = '';
			await loadDirectory(path);
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Could not upload file';
		} finally {
			loading = false;
		}
	}

	async function createFolder() {
		if (!newFolderName.trim()) return;
		const created = await mutate(
			'/mkdir',
			{ path: joinPath(path, newFolderName.trim()) },
			'Could not create directory'
		);
		if (created) newFolderName = '';
	}

	async function renameSelected() {
		if (!selected || !renamePath.trim()) return;
		await mutate(
			'/rename',
			{ from: selected.path, to: normalizeTarget(renamePath.trim()) },
			'Could not rename path'
		);
	}

	function requestDeleteSelected() {
		if (!selected) return;
		deleteTarget = selected;
		deleteDialogOpen = true;
	}

	async function deleteSelected() {
		if (!deleteTarget) return;
		const target = deleteTarget;
		const deleted = await request(
			`/delete?path=${encodeURIComponent(target.path)}`,
			{ method: 'DELETE' },
			'Could not delete path'
		);
		if (deleted) {
			deleteDialogOpen = false;
			deleteTarget = null;
			await loadDirectory(path);
		}
	}

	async function openText(entry = selected) {
		if (!entry || entry.type !== 'file') return;
		loading = true;
		error = null;
		try {
			const response = await fetch(
				`/api/${apiBase}/${encodeURIComponent(hostId)}/text?path=${encodeURIComponent(entry.path)}`
			);
			const body = await response.json();
			if (!response.ok) throw new Error(body.error ?? 'Could not read text file');
			textPath = body.path;
			textValue = body.text;
			textDirty = false;
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Could not read text file';
		} finally {
			loading = false;
		}
	}

	async function saveText() {
		if (!textPath) return;
		const saved = await request(
			'/text',
			{
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ path: textPath, text: textValue })
			},
			'Could not save text file'
		);
		if (saved) {
			textDirty = false;
			await loadDirectory(path);
		}
	}

	async function mutate(route: string, body: Record<string, unknown>, fallback: string) {
		const succeeded = await request(
			route,
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			},
			fallback
		);
		if (succeeded) await loadDirectory(path);
		return succeeded;
	}

	async function request(route: string, init: RequestInit, fallback: string) {
		loading = true;
		error = null;
		try {
			const response = await fetch(`/api/${apiBase}/${encodeURIComponent(hostId)}${route}`, init);
			const body = await response.json().catch(() => ({}));
			if (!response.ok) throw new Error(body.error ?? fallback);
			return true;
		} catch (caught) {
			error = caught instanceof Error ? caught.message : fallback;
			return false;
		} finally {
			loading = false;
		}
	}

	function selectEntry(entry: SftpEntry) {
		selected = entry;
		renamePath = entry.path;
	}

	function activateEntry(entry: SftpEntry) {
		selectEntry(entry);
		if (entry.type === 'directory') {
			void loadDirectory(entry.path);
			return;
		}
		if (entry.type === 'file') void openText(entry);
	}

	function downloadUrl(entry: SftpEntry) {
		return `/api/${apiBase}/${encodeURIComponent(hostId)}/download?path=${encodeURIComponent(entry.path)}`;
	}

	function formatSize(size: number) {
		if (size < 1024) return `${size} B`;
		if (size < 1024 * 1024) return `${Math.round(size / 102.4) / 10} KB`;
		return `${Math.round(size / 1024 / 102.4) / 10} MB`;
	}

	function parentPath() {
		if (path === '/') return '/';
		const parent = path.replace(/\/$/, '').split('/').slice(0, -1).join('/');
		return parent || '/';
	}

	function joinPath(directory: string, name: string) {
		return `${directory.replace(/\/$/, '')}/${name}`.replace(/^\/\//, '/');
	}

	function normalizeTarget(value: string) {
		return value.startsWith('/') ? value : joinPath(path, value);
	}

	onMount(() => {
		path = initialPath;
		void loadDirectory(initialPath);
	});
</script>

<div class="grid h-full min-h-[480px] grid-rows-[auto_1fr] overflow-hidden rounded-md border">
	<div class="space-y-2 border-b bg-muted/20 p-2">
		<div class="flex flex-wrap items-center gap-2">
			<Input
				aria-label="Remote path"
				class="h-8 min-w-48 flex-1 font-mono text-xs"
				bind:value={path}
				onkeydown={(event) => event.key === 'Enter' && loadDirectory()}
			/>
			<Button size="sm" variant="outline" onclick={() => loadDirectory(parentPath())}>Parent</Button
			>
			<Button size="icon-sm" variant="outline" aria-label="Refresh" onclick={() => loadDirectory()}>
				<RefreshCw class="size-4" />
			</Button>
			<input
				bind:this={fileInput}
				type="file"
				class="sr-only"
				aria-label="Upload file"
				onchange={uploadFile}
			/>
			<Button size="sm" variant="outline" onclick={() => fileInput.click()}>
				<Upload class="size-4" />Upload
			</Button>
		</div>
		<div class="flex flex-wrap items-center gap-2">
			<Input
				aria-label="New folder name"
				class="h-8 w-40"
				placeholder="folder"
				bind:value={newFolderName}
				onkeydown={(event) => event.key === 'Enter' && createFolder()}
			/>
			<Button size="icon-sm" variant="outline" aria-label="Create folder" onclick={createFolder}>
				<FolderPlus class="size-4" />
			</Button>
			<Input
				aria-label="Rename or move selected path"
				class="h-8 min-w-48 flex-1 font-mono text-xs"
				placeholder="select an entry to rename or move"
				bind:value={renamePath}
				disabled={!selected}
			/>
			<Button
				size="icon-sm"
				variant="outline"
				aria-label="Rename or move selected path"
				disabled={!selected || !renamePath.trim()}
				onclick={renameSelected}
			>
				<Pencil class="size-4" />
			</Button>
			<Button
				size="icon-sm"
				variant="outline"
				aria-label="Open selected text file"
				disabled={!selected || selected.type !== 'file'}
				onclick={() => openText()}
			>
				<File class="size-4" />
			</Button>
			<Button
				size="icon-sm"
				variant="destructive"
				aria-label="Delete selected path"
				disabled={!selected}
				onclick={requestDeleteSelected}
			>
				<Trash2 class="size-4" />
			</Button>
		</div>
	</div>

	<div class="grid min-h-0 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px]">
		<div class="relative min-h-0 overflow-auto">
			<Table.Root>
				<Table.Header class="sticky top-0 z-10 bg-background">
					<Table.Row>
						<Table.Head>Name</Table.Head>
						<Table.Head class="w-28">Size</Table.Head>
						<Table.Head class="w-44">Modified</Table.Head>
						<Table.Head class="w-12" aria-label="Actions"></Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each entries as entry (entry.path)}
						<Table.Row
							data-selected={selected?.path === entry.path}
							onclick={() => selectEntry(entry)}
						>
							<Table.Cell>
								{#if entry.type === 'directory'}
									<Button
										variant="ghost"
										size="sm"
										class="justify-start px-1 font-normal"
										onclick={(event) => (event.stopPropagation(), activateEntry(entry))}
									>
										<Folder class="size-4 text-amber-500" />{entry.name}
									</Button>
								{:else}
									<Button
										variant="ghost"
										size="sm"
										class="justify-start px-1 font-normal"
										onclick={(event) => (event.stopPropagation(), activateEntry(entry))}
									>
										<File class="size-4 text-muted-foreground" />{entry.name}
									</Button>
								{/if}
							</Table.Cell>
							<Table.Cell class="font-mono text-xs text-muted-foreground">
								{entry.type === 'directory' ? '-' : formatSize(entry.size)}
							</Table.Cell>
							<Table.Cell class="font-mono text-xs text-muted-foreground">
								{new Date(entry.mtime).toLocaleString()}
							</Table.Cell>
							<Table.Cell>
								{#if entry.type === 'file'}
									<Button
										size="icon-sm"
										variant="ghost"
										href={downloadUrl(entry)}
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
							<Table.Cell colspan={4} class="h-24 text-center text-muted-foreground">
								No entries.
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

		<div class="min-h-0 border-t p-2 lg:border-t-0 lg:border-l">
			<div class="mb-2 flex h-8 items-center justify-between gap-2">
				<div class="min-w-0 truncate font-mono text-xs text-muted-foreground">
					{textPath ?? 'No text file open'}
				</div>
				<Button
					size="icon-sm"
					variant="outline"
					aria-label="Save text file"
					disabled={!textPath || !textDirty}
					onclick={saveText}
				>
					<Save class="size-4" />
				</Button>
			</div>
			<Textarea
				class="h-[calc(100%-2.5rem)] resize-none font-mono text-xs"
				placeholder="Open a text file to edit it"
				bind:value={textValue}
				disabled={!textPath}
				oninput={() => (textDirty = Boolean(textPath))}
			/>
		</div>
	</div>

	<AlertDialog.Root bind:open={deleteDialogOpen}>
		<AlertDialog.Content>
			<AlertDialog.Header>
				<AlertDialog.Title>Delete remote path?</AlertDialog.Title>
				<AlertDialog.Description>
					{#if deleteTarget}
						This permanently deletes {deleteTarget.path} from the remote host.
					{:else}
						This permanently deletes the selected remote path.
					{/if}
				</AlertDialog.Description>
			</AlertDialog.Header>
			<AlertDialog.Footer>
				<AlertDialog.Cancel disabled={loading}>Cancel</AlertDialog.Cancel>
				<AlertDialog.Action
					variant="destructive"
					disabled={!deleteTarget || loading}
					onclick={(event) => {
						event.preventDefault();
						void deleteSelected();
					}}
				>
					{loading ? 'Deleting...' : 'Delete path'}
				</AlertDialog.Action>
			</AlertDialog.Footer>
		</AlertDialog.Content>
	</AlertDialog.Root>
</div>
