<script lang="ts">
	import { DatabaseZap, Lock, UserPlus } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Separator } from '$lib/components/ui/separator';
	import { firstRunForm, loginForm } from '$lib/remotes/auth.remote';
	import MicrosoftSignIn from './MicrosoftSignIn.svelte';

	type MicrosoftAuth = {
		enabled?: boolean;
		href?: string | null;
	};

	let {
		mode = 'login',
		microsoftAuth
	}: { mode?: 'login' | 'first-run'; microsoftAuth?: MicrosoftAuth } = $props();

	const showMicrosoftSignIn = $derived(
		microsoftAuth?.enabled === true && typeof microsoftAuth.href === 'string'
	);
</script>

<main class="grid min-h-screen place-items-center bg-muted/20 p-4">
	<section class="w-full max-w-sm rounded-md border bg-background p-5 shadow-sm">
		<div class="mb-5 flex items-center gap-2">
			<div
				class="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground"
			>
				<DatabaseZap class="size-4" />
			</div>
			<div>
				<h1 class="text-base font-semibold">{mode === 'login' ? 'Sign in' : 'Create admin'}</h1>
				<p class="text-xs text-muted-foreground">
					{mode === 'login' && showMicrosoftSignIn
						? 'Use your Microsoft account.'
						: mode === 'login'
							? 'Use a local TermKit account.'
							: 'First-run local administrator setup.'}
				</p>
			</div>
		</div>

		{#if mode === 'first-run'}
			{#if showMicrosoftSignIn && microsoftAuth?.href}
				<div class="mb-4 space-y-4">
					<MicrosoftSignIn href={microsoftAuth.href} />
					<div class="relative flex items-center">
						<Separator />
						<span
							class="absolute left-1/2 -translate-x-1/2 bg-background px-2 text-xs text-muted-foreground"
							>or</span
						>
					</div>
				</div>
			{/if}
			<form class="space-y-4" {...firstRunForm}>
				<div class="space-y-2">
					<Label for="username">Username</Label>
					<Input
						id="username"
						autocomplete="username"
						{...firstRunForm.fields.username.as('text', 'admin')}
					/>
				</div>
				<div class="space-y-2">
					<Label for="password">Password</Label>
					<Input
						id="password"
						autocomplete="new-password"
						{...firstRunForm.fields.password.as('password')}
					/>
				</div>
				<div class="space-y-2">
					<Label for="confirmPassword">Confirm password</Label>
					<Input
						id="confirmPassword"
						autocomplete="new-password"
						{...firstRunForm.fields.confirmPassword.as('password')}
					/>
				</div>
				{#if firstRunForm.fields.allIssues()?.length}
					<div
						class="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive"
					>
						{#each firstRunForm.fields.allIssues() ?? [] as issue, index (index)}
							<p>{issue.message}</p>
						{/each}
					</div>
				{/if}
				<Button class="w-full" type="submit" disabled={firstRunForm.pending > 0}>
					<UserPlus class="size-4" />Create admin
				</Button>
			</form>
		{:else}
			{#if showMicrosoftSignIn && microsoftAuth?.href}
				<div class="mb-4 space-y-4">
					<MicrosoftSignIn href={microsoftAuth.href} />
				</div>
			{/if}
			{#if showMicrosoftSignIn}
				<details class="group rounded-md border bg-muted/20 p-3">
					<summary
						class="cursor-pointer text-sm font-medium text-muted-foreground transition-colors group-open:mb-4 group-open:text-foreground"
					>
						Local account
					</summary>
					<form class="space-y-4" {...loginForm}>
						<div class="space-y-2">
							<Label for="username">Username</Label>
							<Input
								id="username"
								autocomplete="username"
								{...loginForm.fields.username.as('text')}
							/>
						</div>
						<div class="space-y-2">
							<Label for="password">Password</Label>
							<Input
								id="password"
								autocomplete="current-password"
								{...loginForm.fields.password.as('password')}
							/>
						</div>
						{#if loginForm.fields.allIssues()?.length}
							<div
								class="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive"
							>
								{#each loginForm.fields.allIssues() ?? [] as issue, index (index)}
									<p>{issue.message}</p>
								{/each}
							</div>
						{/if}
						<Button class="w-full" type="submit" disabled={loginForm.pending > 0}>
							<Lock class="size-4" />Sign in locally
						</Button>
					</form>
				</details>
			{:else}
				<form class="space-y-4" {...loginForm}>
					<div class="space-y-2">
						<Label for="username">Username</Label>
						<Input
							id="username"
							autocomplete="username"
							{...loginForm.fields.username.as('text')}
						/>
					</div>
					<div class="space-y-2">
						<Label for="password">Password</Label>
						<Input
							id="password"
							autocomplete="current-password"
							{...loginForm.fields.password.as('password')}
						/>
					</div>
					{#if loginForm.fields.allIssues()?.length}
						<div
							class="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive"
						>
							{#each loginForm.fields.allIssues() ?? [] as issue, index (index)}
								<p>{issue.message}</p>
							{/each}
						</div>
					{/if}
					<Button class="w-full" type="submit" disabled={loginForm.pending > 0}>
						<Lock class="size-4" />Sign in
					</Button>
				</form>
			{/if}
		{/if}
	</section>
</main>
