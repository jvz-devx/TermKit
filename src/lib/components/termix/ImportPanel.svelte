<script lang="ts">
	import { onMount } from 'svelte';
	import { AlertTriangle, CheckCircle2, FileUp, Play } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import ImportJobHistory, { type ImportJob } from './ImportJobHistory.svelte';
	import StatePanel from './StatePanel.svelte';

	type ImportSummary = {
		totalRecords: number;
		validHosts: number;
		validCredentials: number;
		importedHosts: number;
		importedCredentials: number;
		skippedRecords: number;
		warnings: number;
		failures: number;
	};

	type ImportWarning = {
		sourceId: string;
		code: string;
		message: string;
	};

	type ImportResult = {
		job: {
			id: string;
			mode: 'validate' | 'import';
			status: string;
			sourceName: string;
			sourceKind: string;
			summary: ImportSummary;
			warnings: ImportWarning[];
			failures: string[];
		};
		preview: {
			hosts: Array<{
				sourceId: string;
				name: string;
				protocol: string;
				hostname: string;
				port: number;
			}>;
			credentials: Array<{ sourceId: string; name: string; kind: string }>;
		};
	};

	let selectedFile = $state<File | null>(null);
	let sourceSecret = $state('');
	let result = $state<ImportResult | null>(null);
	let errorMessage = $state<string | null>(null);
	let activeAction = $state<'validate' | 'import' | null>(null);
	let importJobs = $state<ImportJob[]>([]);
	let importJobsLoading = $state(false);
	let importJobsError = $state<string | null>(null);
	let showAllWarnings = $state(false);
	let showAllFailures = $state(false);
	let importJobsRequestId = 0;

	let statusTitle = $derived.by(() => {
		if (activeAction === 'validate') return 'Validating import';
		if (activeAction === 'import') return 'Import running';
		if (errorMessage) return 'Importer failed';
		if (result?.job.status === 'completed') return 'Import completed';
		if (result?.job.status === 'validated') return 'Validation completed';
		if (result?.job.status === 'completed_with_errors') return 'Import completed with errors';
		return 'Importer idle';
	});

	let statusDetail = $derived.by(() => {
		if (activeAction) return selectedFile ? selectedFile.name : 'Processing upload';
		if (errorMessage) return errorMessage;
		if (result) return `${result.job.sourceName} (${result.job.sourceKind})`;
		return 'No import job is currently running.';
	});

	let statusState = $derived<'loading' | 'error' | 'ready'>(
		activeAction ? 'loading' : errorMessage ? 'error' : 'ready'
	);
	let summary = $derived(result?.job.summary);
	let canSubmit = $derived(Boolean(selectedFile) && !activeAction);
	let visibleWarnings = $derived(
		result?.job.warnings
			? showAllWarnings
				? result.job.warnings
				: result.job.warnings.slice(0, 4)
			: []
	);
	let visibleFailures = $derived(
		result?.job.failures
			? showAllFailures
				? result.job.failures
				: result.job.failures.slice(0, 4)
			: []
	);

	function handleFileChange(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		selectedFile = input.files?.[0] ?? null;
		result = null;
		errorMessage = null;
	}

	async function submitImport(action: 'validate' | 'import') {
		if (!selectedFile) {
			errorMessage = 'Choose a Termix export file first.';
			return;
		}

		activeAction = action;
		errorMessage = null;

		const form = new FormData();
		form.set('file', selectedFile);
		if (sourceSecret.trim()) form.set('sourceSecret', sourceSecret.trim());

		try {
			const response = await fetch(
				action === 'validate' ? '/api/import/validate' : '/api/import/jobs',
				{
					method: 'POST',
					body: form
				}
			);
			const body = await response.json().catch(() => ({}));

			if (!response.ok) {
				const issues = Array.isArray(body.issues) ? body.issues.join('; ') : undefined;
				throw new Error(issues || body.error || 'Import request failed');
			}

			result = body as ImportResult;
			showAllWarnings = false;
			showAllFailures = false;
			await loadImportJobs({ quiet: true });
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : 'Import request failed';
			await loadImportJobs({ quiet: true });
		} finally {
			activeAction = null;
		}
	}

	async function loadImportJobs(options: { quiet?: boolean } = {}) {
		const requestId = (importJobsRequestId += 1);
		if (!options.quiet) importJobsLoading = true;
		importJobsError = null;

		try {
			const response = await fetch('/api/import/jobs');
			const body = await response.json().catch(() => ({}));
			if (!response.ok) throw new Error(body.error ?? 'Could not load import jobs');
			if (requestId === importJobsRequestId) {
				importJobs = Array.isArray(body.jobs) ? body.jobs : [];
			}
		} catch (error) {
			if (requestId === importJobsRequestId) {
				importJobsError = error instanceof Error ? error.message : 'Could not load import jobs';
			}
		} finally {
			if (requestId === importJobsRequestId) importJobsLoading = false;
		}
	}

	onMount(() => {
		void loadImportJobs();
	});
</script>

<section class="space-y-4 p-4">
	<div>
		<h1 class="text-lg font-semibold">Termix import</h1>
		<p class="text-sm text-muted-foreground">
			Upload a Termix JSON export or SQLite database, validate the mapped records, then import hosts
			and credentials.
		</p>
	</div>
	<div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
		<div class="rounded-md border p-4">
			<div class="grid gap-4 sm:grid-cols-2">
				<div class="space-y-2 sm:col-span-2">
					<Label for="import-file">Source file</Label>
					<Input
						id="import-file"
						type="file"
						accept=".json,.sqlite,.sqlite3,.db,application/json"
						onchange={handleFileChange}
					/>
				</div>
				<div class="space-y-2">
					<Label for="secret">Source decrypt secret</Label>
					<Input id="secret" type="password" bind:value={sourceSecret} autocomplete="off" />
				</div>
				<div class="space-y-2">
					<Label for="owner">Destination owner</Label>
					<Input id="owner" value="Current signed-in user" disabled />
				</div>
			</div>
			<div class="mt-4 flex gap-2">
				<Button disabled={!canSubmit} onclick={() => submitImport('import')}>
					<Play class="size-4" />Start import
				</Button>
				<Button variant="outline" disabled={!canSubmit} onclick={() => submitImport('validate')}>
					<FileUp class="size-4" />Validate only
				</Button>
			</div>
		</div>
		<div class="space-y-3">
			<StatePanel state={statusState} title={statusTitle} detail={statusDetail} />
			{#if summary}
				<div class="rounded-md border p-3 text-sm">
					<div class="font-medium">Last summary</div>
					<div class="mt-2 grid grid-cols-3 gap-2 text-center">
						<div class="rounded bg-muted/40 p-2">
							<div class="font-semibold">{summary.validHosts}</div>
							<div class="text-xs text-muted-foreground">hosts</div>
						</div>
						<div class="rounded bg-muted/40 p-2">
							<div class="font-semibold">{summary.validCredentials}</div>
							<div class="text-xs text-muted-foreground">credentials</div>
						</div>
						<div class="rounded bg-muted/40 p-2">
							<div class="font-semibold">{summary.skippedRecords}</div>
							<div class="text-xs text-muted-foreground">skipped</div>
						</div>
					</div>
					<div class="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
						<div class="flex items-center gap-2">
							<CheckCircle2 class="size-4 text-emerald-600" />
							<span>{summary.importedHosts} hosts imported</span>
						</div>
						<div class="flex items-center gap-2">
							<AlertTriangle class="size-4 text-amber-600" />
							<span>{summary.warnings} warnings</span>
						</div>
					</div>
				</div>
			{/if}
			{#if result?.job.warnings.length}
				<div class="rounded-md border p-3 text-sm">
					<div class="flex items-center justify-between gap-2">
						<div class="font-medium">Warnings</div>
						{#if result.job.warnings.length > 4}
							<Button
								size="sm"
								variant="ghost"
								onclick={() => (showAllWarnings = !showAllWarnings)}
							>
								{showAllWarnings ? 'Show fewer' : `View all ${result.job.warnings.length}`}
							</Button>
						{/if}
					</div>
					<ul class="mt-2 space-y-1 text-xs text-muted-foreground">
						{#each visibleWarnings as warning, index (`${warning.sourceId}:${warning.code}:${index}`)}
							<li>{warning.sourceId}: {warning.message}</li>
						{/each}
					</ul>
				</div>
			{/if}
			{#if result?.job.failures.length}
				<div class="rounded-md border border-destructive/40 p-3 text-sm">
					<div class="flex items-center justify-between gap-2">
						<div class="font-medium text-destructive">Failures</div>
						{#if result.job.failures.length > 4}
							<Button
								size="sm"
								variant="ghost"
								onclick={() => (showAllFailures = !showAllFailures)}
							>
								{showAllFailures ? 'Show fewer' : `View all ${result.job.failures.length}`}
							</Button>
						{/if}
					</div>
					<ul class="mt-2 space-y-1 text-xs text-muted-foreground">
						{#each visibleFailures as failure, index (`${failure}:${index}`)}
							<li>{failure}</li>
						{/each}
					</ul>
				</div>
			{/if}
			{#if result?.preview.hosts.length}
				<div class="rounded-md border p-3 text-sm">
					<div class="font-medium">Preview</div>
					<div class="mt-2 space-y-2">
						{#each result.preview.hosts.slice(0, 3) as host (host.sourceId)}
							<div class="rounded bg-muted/40 p-2">
								<div class="font-medium">{host.name}</div>
								<div class="font-mono text-xs text-muted-foreground">
									{host.protocol}://{host.hostname}:{host.port}
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/if}
			<ImportJobHistory
				jobs={importJobs}
				loading={importJobsLoading}
				error={importJobsError}
				onRefresh={() => void loadImportJobs()}
			/>
		</div>
	</div>
</section>
