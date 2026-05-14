<script lang="ts">
	import { AlertTriangle, CheckCircle2, Clock3, DatabaseZap, FileText } from '@lucide/svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
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

	export type ImportJob = {
		id: string;
		mode: 'validate' | 'import';
		status: string;
		sourceName: string;
		sourceKind: string;
		summary: ImportSummary;
		warnings: ImportWarning[];
		failures: string[];
		startedAt: string | Date;
		finishedAt: string | Date | null;
		createdAt: string | Date;
		updatedAt: string | Date;
	};

	let {
		jobs,
		loading = false,
		error = null,
		onRefresh
	}: {
		jobs: ImportJob[];
		loading?: boolean;
		error?: string | null;
		onRefresh?: () => void;
	} = $props();

	function statusVariant(status: string) {
		if (status === 'failed' || status === 'completed_with_errors') return 'destructive';
		if (status === 'completed' || status === 'validated') return 'default';
		return 'secondary';
	}

	function formatDate(value: string | Date | null) {
		if (!value) return 'not finished';
		return new Date(value).toLocaleString();
	}

	function jobTitle(job: ImportJob) {
		return `${job.mode === 'validate' ? 'Validated' : 'Imported'} ${job.sourceName}`;
	}
</script>

<div class="rounded-md border">
	<div class="flex items-center justify-between gap-3 border-b px-3 py-2">
		<div>
			<div class="text-sm font-medium">Import jobs</div>
			<div class="text-xs text-muted-foreground">Persisted validation and import runs</div>
		</div>
		<Button size="sm" variant="outline" disabled={loading} onclick={onRefresh}>
			<Clock3 class="size-4" />Refresh
		</Button>
	</div>

	{#if error}
		<div class="p-3">
			<StatePanel state="error" title="Could not load import jobs" detail={error} />
		</div>
	{:else if loading && !jobs.length}
		<div class="p-3">
			<StatePanel state="loading" title="Loading import jobs" detail="Fetching recent runs." />
		</div>
	{:else if jobs.length}
		<div class="divide-y">
			{#each jobs.slice(0, 8) as job (job.id)}
				<div class="space-y-2 p-3">
					<div class="flex items-start justify-between gap-3">
						<div class="min-w-0">
							<div class="flex items-center gap-2">
								{#if job.sourceKind === 'sqlite'}
									<DatabaseZap class="size-4 text-muted-foreground" />
								{:else}
									<FileText class="size-4 text-muted-foreground" />
								{/if}
								<div class="truncate text-sm font-medium">{jobTitle(job)}</div>
							</div>
							<div class="mt-1 font-mono text-xs text-muted-foreground">
								{formatDate(job.finishedAt ?? job.updatedAt)}
							</div>
						</div>
						<Badge variant={statusVariant(job.status)}>{job.status}</Badge>
					</div>

					<div class="grid grid-cols-4 gap-2 text-center text-xs">
						<div class="rounded bg-muted/40 p-2">
							<div class="font-semibold">{job.summary.validHosts}</div>
							<div class="text-muted-foreground">hosts</div>
						</div>
						<div class="rounded bg-muted/40 p-2">
							<div class="font-semibold">{job.summary.validCredentials}</div>
							<div class="text-muted-foreground">creds</div>
						</div>
						<div class="rounded bg-muted/40 p-2">
							<div class="font-semibold">{job.summary.warnings}</div>
							<div class="text-muted-foreground">warn</div>
						</div>
						<div class="rounded bg-muted/40 p-2">
							<div class="font-semibold">{job.summary.failures}</div>
							<div class="text-muted-foreground">fail</div>
						</div>
					</div>

					{#if job.failures.length}
						<div class="flex items-start gap-2 rounded border border-destructive/40 p-2 text-xs">
							<AlertTriangle class="mt-0.5 size-4 shrink-0 text-destructive" />
							<div class="min-w-0 text-muted-foreground">
								{job.failures[0]}{job.failures.length > 1
									? ` +${job.failures.length - 1} more`
									: ''}
							</div>
						</div>
					{:else if job.status === 'completed' || job.status === 'validated'}
						<div class="flex items-center gap-2 text-xs text-muted-foreground">
							<CheckCircle2 class="size-4 text-emerald-600" />
							Completed without recorded failures
						</div>
					{/if}
				</div>
			{/each}
		</div>
		{#if jobs.length > 8}
			<div class="border-t px-3 py-2 text-xs text-muted-foreground">
				Showing 8 of {jobs.length} persisted jobs.
			</div>
		{/if}
	{:else}
		<div class="p-3">
			<StatePanel
				state="ready"
				title="No import jobs"
				detail="Validated and imported files will appear here."
			/>
		</div>
	{/if}
</div>
