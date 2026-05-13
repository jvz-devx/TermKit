<script lang="ts">
	import { DatabaseZap, Lock, UserPlus } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';

	let { mode = 'login' }: { mode?: 'login' | 'first-run' } = $props();
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
					{mode === 'login'
						? 'Use a local TermixKit account.'
						: 'First-run local administrator setup.'}
				</p>
			</div>
		</div>

		<form class="space-y-4">
			<div class="space-y-2">
				<Label for="username">Username</Label>
				<Input id="username" autocomplete="username" value={mode === 'first-run' ? 'admin' : ''} />
			</div>
			<div class="space-y-2">
				<Label for="password">Password</Label>
				<Input
					id="password"
					type="password"
					autocomplete={mode === 'login' ? 'current-password' : 'new-password'}
				/>
			</div>
			{#if mode === 'first-run'}
				<div class="space-y-2">
					<Label for="confirm">Confirm password</Label>
					<Input id="confirm" type="password" autocomplete="new-password" />
				</div>
			{/if}
			<Button class="w-full">
				{#if mode === 'login'}<Lock class="size-4" />Sign in{:else}<UserPlus class="size-4" />Create
					admin{/if}
			</Button>
		</form>
	</section>
</main>
