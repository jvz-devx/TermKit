<script lang="ts">
	import { KeyRound, MoreHorizontal, Plus, ShieldCheck } from '@lucide/svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Table from '$lib/components/ui/table';
	import { credentials } from './sample-data';
</script>

<section class="space-y-3 p-4">
	<div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
		<div>
			<h1 class="text-lg font-semibold">Credentials</h1>
			<p class="text-sm text-muted-foreground">Encrypted password and SSH key records.</p>
		</div>
		<Button size="sm"><Plus class="size-4" />Credential</Button>
	</div>

	<div class="grid gap-3 lg:grid-cols-[1fr_280px]">
		<div class="space-y-3">
			<Input placeholder="Filter credentials by name, username, or kind" />
			<div class="overflow-hidden rounded-md border">
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>Name</Table.Head>
							<Table.Head>Kind</Table.Head>
							<Table.Head>Username</Table.Head>
							<Table.Head>Used by</Table.Head>
							<Table.Head>Rotation</Table.Head>
							<Table.Head class="w-12"></Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each credentials as credential (credential.id)}
							<Table.Row>
								<Table.Cell class="font-medium">{credential.name}</Table.Cell>
								<Table.Cell><Badge variant="outline">{credential.kind}</Badge></Table.Cell>
								<Table.Cell>{credential.username}</Table.Cell>
								<Table.Cell>{credential.usedBy} hosts</Table.Cell>
								<Table.Cell>{credential.rotation}</Table.Cell>
								<Table.Cell>
									<Button
										variant="ghost"
										size="icon"
										aria-label={`Credential actions for ${credential.name}`}
									>
										<MoreHorizontal class="size-4" />
									</Button>
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>
		</div>
		<div class="rounded-md border p-3">
			<div class="flex items-center gap-2">
				<ShieldCheck class="size-4" />
				<h2 class="text-sm font-medium">Storage state</h2>
			</div>
			<div class="mt-3 space-y-2 text-sm">
				<div class="flex justify-between">
					<span class="text-muted-foreground">Encryption</span><span>ready</span>
				</div>
				<div class="flex justify-between">
					<span class="text-muted-foreground">Master key</span><span>configured</span>
				</div>
				<div class="flex justify-between">
					<span class="text-muted-foreground">Records</span><span>3</span>
				</div>
			</div>
			<div class="mt-4 rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
				<KeyRound class="mb-2 size-4" />
				Secret values stay write-only in the UI shell and are never echoed after save.
			</div>
		</div>
	</div>
</section>
