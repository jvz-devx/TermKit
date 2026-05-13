<script lang="ts">
	import { onMount } from 'svelte';
	import { Download, Folder, File, RefreshCw, Upload } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Table from '$lib/components/ui/table';
	import StatePanel from '../StatePanel.svelte';

	type SftpEntry = {
		name: string;
		path: string;
		type: 'directory' | 'file' | 'symlink' | 'other';
		size: number;
		mtime: string;
	};

	let { hostId, initialPath = '/' }: { hostId: string; initialPath?: string } = $props();

	let path = $state('/');
	let entries = $state<SftpEntry[]>([]);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let fileInput: HTMLInputElement;

	async function loadDirectory(nextPath = path) {
		path = nextPath;
		loading = true;
		error = null;

		try {
			const response = await fetch(
				`/api/sftp/${encodeURIComponent(hostId)}/list?path=${encodeURIComponent(nextPath)}`
			);
			const body = await response.json();
			if (!response.ok) throw new Error(body.error ?? 'Could not list directory');
			entries = body.entries;
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Could not list directory';
			entries = [];
		} finally {
			loading = false;
		}
	}

	async function uploadFile() {
		const file = fileInput.files?.[0];
		if (!file) return;

		const form = new FormData();
		form.append('file', file);
		const remotePath = `${path.replace(/\/$/, '')}/${file.name}`;
		loading = true;
		error = null;

		try {
			const response = await fetch(
				`/api/sftp/${encodeURIComponent(hostId)}/upload?path=${encodeURIComponent(remotePath)}`,
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

	function downloadUrl(entry: SftpEntry) {
		return `/api/sftp/${encodeURIComponent(hostId)}/download?path=${encodeURIComponent(entry.path)}`;
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

	onMount(() => {
		void loadDirectory(initialPath);
	});
</script>

<div class="grid h-full min-h-[480px] grid-rows-[auto_1fr] overflow-hidden rounded-md border">
	<div class="flex flex-wrap items-center gap-2 border-b bg-muted/20 p-2">
		<Input
			aria-label="Remote path"
			class="h-8 min-w-48 flex-1 font-mono text-xs"
			bind:value={path}
			onkeydown={(event) => event.key === 'Enter' && loadDirectory()}
		/>
		<Button size="sm" variant="outline" onclick={() => loadDirectory(parentPath())}>Parent</Button>
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
					<Table.Row>
						<Table.Cell>
							{#if entry.type === 'directory'}
								<Button
									variant="ghost"
									size="sm"
									class="justify-start px-1 font-normal"
									onclick={() => loadDirectory(entry.path)}
								>
									<Folder class="size-4 text-amber-500" />{entry.name}
								</Button>
							{:else}
								<span class="flex items-center gap-2 text-sm">
									<File class="size-4 text-muted-foreground" />{entry.name}
								</span>
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
								>
									<Download class="size-4" />
								</Button>
							{/if}
						</Table.Cell>
					</Table.Row>
				{/each}
			</Table.Body>
		</Table.Root>

		{#if loading || error}
			<StatePanel
				state={error ? 'error' : 'loading'}
				title={error ? 'SFTP request failed' : 'Loading remote directory'}
				detail={error ?? path}
				class="absolute right-3 bottom-3 left-3 bg-background"
			/>
		{/if}
	</div>
</div>
