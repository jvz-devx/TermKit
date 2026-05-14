import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const workflowPath = '.github/workflows/microsoft-acceptance.yml';
const workflowName = 'Microsoft Acceptance Smoke';
const artifactName = 'microsoft-smoke-proof';
const requiredSecrets = [
	'MICROSOFT_TENANT_ID',
	'MICROSOFT_CLIENT_ID',
	'MICROSOFT_CLIENT_SECRET',
	'MICROSOFT_ALLOWED_DOMAINS',
	'MICROSOFT_ADMIN_EMAILS'
];

const options = parseArgs(process.argv.slice(2));
const repo = options.repo ?? currentRepo();
const ref = options.ref ?? currentBranch();

if (options.help) {
	printHelp();
	process.exit(0);
}

if (!repo) {
	console.error(
		'Could not determine GitHub repository. Pass --repo OWNER/REPO or run this from a checkout with an origin remote.'
	);
	process.exit(1);
}

const workflow = findWorkflow(repo);
if (options.syncSecrets) syncRequiredSecrets(repo);
if (options.syncOrigin) syncOriginVariable(repo);
const secretNames = new Set(listNames('secret', repo));
const variableNames = new Set(listNames('variable', repo));
const missingSecrets = requiredSecrets.filter((name) => !secretNames.has(name));
const hasOriginVariable = variableNames.has('MICROSOFT_ACCEPTANCE_ORIGIN');

console.log(`Repository: ${repo}`);
console.log(`Workflow: ${workflow.name} (${workflow.state})`);
console.log(`Ref: ${ref}`);
console.log(
	`Required secrets: ${requiredSecrets.length - missingSecrets.length}/${requiredSecrets.length}`
);

if (missingSecrets.length > 0) {
	console.log(`Missing secrets: ${missingSecrets.join(', ')}`);
	for (const name of missingSecrets) {
		console.log(`  gh secret set ${name} --repo ${repo}`);
	}
} else {
	console.log('Missing secrets: none');
}

if (hasOriginVariable) {
	console.log('Optional variable MICROSOFT_ACCEPTANCE_ORIGIN: configured');
} else {
	console.log(
		`Optional variable MICROSOFT_ACCEPTANCE_ORIGIN: not set; workflow will use https://termix.example`
	);
	console.log(
		`  gh variable set MICROSOFT_ACCEPTANCE_ORIGIN --repo ${repo} --body https://your-origin.example`
	);
}

if (workflow.state !== 'active') {
	console.error(
		`Workflow ${workflowPath} is ${workflow.state}; enable it before running Microsoft acceptance.`
	);
	process.exit(2);
}

if (options.importLatestProof) {
	try {
		importLatestProof(repo, ref);
	} catch (error) {
		if (error instanceof CommandFailedError) process.exit(error.exitCode);
		throw error;
	}
	process.exit(0);
}

if (missingSecrets.length > 0) {
	console.error(
		'Microsoft acceptance workflow is not ready to dispatch until all required secrets exist.'
	);
	process.exit(2);
}

if (!options.dispatch) {
	console.log('Microsoft acceptance workflow is ready.');
	printDispatchCommands(repo, ref, options.clientCredentialsScope);
	process.exit(0);
}

dispatchWorkflow(repo, ref, options.clientCredentialsScope);
printAfterDispatchCommands(repo, ref);

function parseArgs(args) {
	const parsed = {
		dispatch: false,
		help: false,
		clientCredentialsScope: '',
		importLatestProof: false,
		syncOrigin: false,
		syncSecrets: false
	};

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === '--help' || arg === '-h') {
			parsed.help = true;
		} else if (arg === '--dispatch') {
			parsed.dispatch = true;
		} else if (arg === '--import-latest-proof') {
			parsed.importLatestProof = true;
		} else if (arg === '--sync-secrets') {
			parsed.syncSecrets = true;
		} else if (arg === '--sync-origin') {
			parsed.syncOrigin = true;
		} else if (arg === '--repo') {
			parsed.repo = requireValue(args, (index += 1), arg);
		} else if (arg.startsWith('--repo=')) {
			parsed.repo = arg.slice('--repo='.length);
		} else if (arg === '--ref') {
			parsed.ref = requireValue(args, (index += 1), arg);
		} else if (arg.startsWith('--ref=')) {
			parsed.ref = arg.slice('--ref='.length);
		} else if (arg === '--client-credentials-scope') {
			parsed.clientCredentialsScope = requireValue(args, (index += 1), arg);
		} else if (arg.startsWith('--client-credentials-scope=')) {
			parsed.clientCredentialsScope = arg.slice('--client-credentials-scope='.length);
		} else {
			console.error(`Unknown argument: ${arg}`);
			printHelp();
			process.exit(1);
		}
	}

	return parsed;
}

function requireValue(args, index, flag) {
	const value = args[index]?.trim();
	if (!value) {
		console.error(`${flag} requires a value.`);
		process.exit(1);
	}
	return value;
}

function findWorkflow(repo) {
	const workflows = ghJson([
		'workflow',
		'list',
		'--all',
		'--json',
		'name,path,state',
		'--repo',
		repo
	]);
	const workflow = workflows.find((candidate) => candidate.path === workflowPath);
	if (!workflow) {
		console.error(`Could not find ${workflowPath} in ${repo}.`);
		process.exit(1);
	}
	return workflow;
}

function listNames(kind, repo) {
	try {
		const rows = ghJson([kind, 'list', '--json', 'name', '--repo', repo]);
		return rows.map((row) => row.name).filter(Boolean);
	} catch (error) {
		console.error(`Could not list GitHub ${kind}s: ${errorText(error)}`);
		process.exit(1);
	}
}

function syncRequiredSecrets(repo) {
	const missingEnv = requiredSecrets.filter((name) => !process.env[name]?.trim());
	if (missingEnv.length > 0) {
		console.error(
			`Cannot sync Microsoft GitHub secrets; missing local environment variable(s): ${missingEnv.join(', ')}`
		);
		process.exit(1);
	}

	for (const name of requiredSecrets) {
		const value = process.env[name]?.trim();
		const result = spawnSync('gh', ['secret', 'set', name, '--repo', repo], {
			cwd: process.cwd(),
			encoding: 'utf8',
			input: value,
			stdio: ['pipe', 'pipe', 'pipe']
		});

		if (result.status !== 0) {
			if (result.stdout.trim()) console.log(result.stdout.trim());
			if (result.stderr.trim()) console.error(result.stderr.trim());
			console.error(`Could not sync GitHub secret ${name}.`);
			process.exit(result.status ?? 1);
		}
		console.log(`Synced GitHub secret ${name}.`);
	}
}

function syncOriginVariable(repo) {
	const origin = process.env.MICROSOFT_ACCEPTANCE_ORIGIN?.trim() ?? process.env.ORIGIN?.trim();
	if (!origin) {
		console.error(
			'Cannot sync MICROSOFT_ACCEPTANCE_ORIGIN; set MICROSOFT_ACCEPTANCE_ORIGIN or ORIGIN locally.'
		);
		process.exit(1);
	}

	let parsed;
	try {
		parsed = new URL(origin);
	} catch {
		console.error('Cannot sync MICROSOFT_ACCEPTANCE_ORIGIN; origin must be an absolute URL.');
		process.exit(1);
	}

	const isLocalHttp =
		parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
	if (parsed.protocol !== 'https:' && !isLocalHttp) {
		console.error(
			'Cannot sync MICROSOFT_ACCEPTANCE_ORIGIN; origin must use HTTPS outside local development.'
		);
		process.exit(1);
	}

	const normalizedOrigin = parsed.origin;
	const result = spawnSync(
		'gh',
		['variable', 'set', 'MICROSOFT_ACCEPTANCE_ORIGIN', '--repo', repo, '--body', normalizedOrigin],
		{
			cwd: process.cwd(),
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe']
		}
	);

	if (result.status !== 0) {
		if (result.stdout.trim()) console.log(result.stdout.trim());
		if (result.stderr.trim()) console.error(result.stderr.trim());
		console.error('Could not sync GitHub variable MICROSOFT_ACCEPTANCE_ORIGIN.');
		process.exit(result.status ?? 1);
	}

	console.log(`Synced GitHub variable MICROSOFT_ACCEPTANCE_ORIGIN to ${normalizedOrigin}.`);
}

function dispatchWorkflow(repo, ref, clientCredentialsScope) {
	const args = ['workflow', 'run', workflowPath, '--repo', repo, '--ref', ref];
	if (clientCredentialsScope.trim()) {
		args.push('-f', `client_credentials_scope=${clientCredentialsScope.trim()}`);
	}

	const result = spawnSync('gh', args, {
		cwd: process.cwd(),
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe']
	});

	if (result.stdout.trim()) console.log(result.stdout.trim());
	if (result.stderr.trim()) console.error(result.stderr.trim());

	if (result.status !== 0) {
		console.error('Could not dispatch Microsoft acceptance workflow.');
		process.exit(result.status ?? 1);
	}
}

function importLatestProof(repo, ref) {
	const commit = currentCommit();
	const runs = ghJson([
		'run',
		'list',
		'--repo',
		repo,
		'--workflow',
		workflowName,
		'--branch',
		ref,
		'--status',
		'success',
		'--json',
		'databaseId,headSha,status,conclusion,url',
		'-L',
		'20'
	]);
	const run = runs.find((candidate) => candidate.headSha === commit);
	if (!run) {
		console.error(
			`No successful ${workflowName} run found for current commit ${commit} on ${ref}. Dispatch and wait for the workflow before importing proof.`
		);
		process.exit(2);
	}

	const downloadDir = mkdtempSync(join(tmpdir(), 'termixkit-microsoft-smoke-proof-'));
	try {
		runCommand('gh', [
			'run',
			'download',
			String(run.databaseId),
			'--repo',
			repo,
			'-n',
			artifactName,
			'-D',
			downloadDir
		]);
		runCommand('node', [
			'scripts/import-microsoft-smoke-proof.mjs',
			'--artifact',
			join(downloadDir, 'acceptance-proof.local.json')
		]);
		console.log(`Imported Microsoft smoke proof from workflow run ${run.databaseId}.`);
		console.log(`Workflow run: ${run.url}`);
	} finally {
		rmSync(downloadDir, { force: true, recursive: true });
	}
}

function runCommand(command, args) {
	const result = spawnSync(command, args, {
		cwd: process.cwd(),
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe']
	});

	if (result.stdout.trim()) console.log(result.stdout.trim());
	if (result.stderr.trim()) console.error(result.stderr.trim());
	if (result.status !== 0) throw new CommandFailedError(result.status ?? 1);
}

class CommandFailedError extends Error {
	constructor(exitCode) {
		super(`command failed with exit code ${exitCode}`);
		this.exitCode = exitCode;
	}
}

function printDispatchCommands(repo, ref, clientCredentialsScope) {
	const scopeFlag = clientCredentialsScope.trim()
		? ` -f client_credentials_scope=${shellValue(clientCredentialsScope.trim())}`
		: '';
	console.log('Dispatch with:');
	console.log(
		`  gh workflow run ${workflowPath} --repo ${repo} --ref ${shellValue(ref)}${scopeFlag}`
	);
}

function printAfterDispatchCommands(repo, ref) {
	console.log('After GitHub creates the run, inspect and download the proof artifact with:');
	console.log(
		`  gh run list --repo ${repo} --workflow ${shellValue(workflowName)} --branch ${shellValue(ref)} -L 5`
	);
	console.log(`  gh run watch <run-id> --repo ${repo}`);
	console.log(`  gh run download <run-id> --repo ${repo} -n ${artifactName} -D ${artifactName}`);
	console.log(`  npm run acceptance:import-microsoft-smoke`);
	console.log(`  npm run acceptance:github-microsoft -- --import-latest-proof`);
}

function ghJson(args) {
	const output = execFileSync('gh', args, { encoding: 'utf8' });
	return JSON.parse(output);
}

function currentRepo() {
	try {
		return execFileSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], {
			encoding: 'utf8'
		}).trim();
	} catch {
		return '';
	}
}

function currentBranch() {
	try {
		return execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim() || 'main';
	} catch {
		return 'main';
	}
}

function currentCommit() {
	try {
		return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
	} catch {
		return '<commit-sha>';
	}
}

function shellValue(value) {
	if (/^[A-Za-z0-9_./:@+-]+$/.test(value)) return value;
	return `'${value.replaceAll("'", "'\\''")}'`;
}

function printHelp() {
	console.log(`Usage: npm run acceptance:github-microsoft -- [options]

Checks the GitHub Actions Microsoft acceptance workflow, required repository
secrets, and optional origin variable. With --dispatch, it triggers the workflow
after the repository is ready.

Options:
  --dispatch                         Trigger the workflow after preflight checks
  --import-latest-proof              Download/import latest successful proof for current commit
  --sync-secrets                     Set required repo secrets from local env vars
  --sync-origin                      Set MICROSOFT_ACCEPTANCE_ORIGIN from local env
  --repo OWNER/REPO                  Repository to check; defaults to current repo
  --ref BRANCH_OR_SHA                Ref to dispatch; defaults to current branch
  --client-credentials-scope SCOPE   Optional .default scope for token exchange
  -h, --help                         Show this help
`);
}

function errorText(error) {
	return error instanceof Error ? error.message : String(error);
}
