<script lang="ts">
	import { Plus } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import { Textarea } from '$lib/components/ui/textarea';
</script>

<Dialog.Root>
	<Dialog.Trigger>
		<Button size="sm"><Plus class="size-4" />Host</Button>
	</Dialog.Trigger>
	<Dialog.Content class="max-w-2xl">
		<Dialog.Header>
			<Dialog.Title>Host configuration</Dialog.Title>
			<Dialog.Description>Connection target and credential binding shell.</Dialog.Description>
		</Dialog.Header>
		<div class="grid gap-4 sm:grid-cols-2">
			<div class="space-y-2">
				<Label for="host-name">Name</Label>
				<Input id="host-name" value="edge-01" />
			</div>
			<div class="space-y-2">
				<Label>Protocol</Label>
				<Select.Root type="single" value="ssh">
					<Select.Trigger class="w-full">SSH</Select.Trigger>
					<Select.Content>
						<Select.Item value="ssh">SSH</Select.Item>
						<Select.Item value="rdp">RDP</Select.Item>
						<Select.Item value="vnc">VNC</Select.Item>
						<Select.Item value="telnet">Telnet</Select.Item>
					</Select.Content>
				</Select.Root>
			</div>
			<div class="space-y-2">
				<Label for="hostname">Hostname</Label>
				<Input id="hostname" value="10.40.0.11" />
			</div>
			<div class="space-y-2">
				<Label for="port">Port</Label>
				<Input id="port" type="number" value="22" />
			</div>
			<div class="space-y-2">
				<Label for="username">Username</Label>
				<Input id="username" value="ops" />
			</div>
			<div class="space-y-2">
				<Label>Credential</Label>
				<Select.Root type="single" value="ops">
					<Select.Trigger class="w-full">ops ssh key</Select.Trigger>
					<Select.Content>
						<Select.Item value="ops">ops ssh key</Select.Item>
						<Select.Item value="domain">domain password</Select.Item>
						<Select.Item value="console">console password</Select.Item>
					</Select.Content>
				</Select.Root>
			</div>
			<div class="space-y-2">
				<Label for="folder">Folder</Label>
				<Input id="folder" value="Production" />
			</div>
			<div class="space-y-2">
				<Label for="tags">Tags</Label>
				<Input id="tags" value="linux, gateway" />
			</div>
			<div class="space-y-2 sm:col-span-2">
				<Label for="notes">Notes</Label>
				<Textarea id="notes" value="Primary SSH entrypoint." />
			</div>
		</div>
		<Dialog.Footer>
			<Button variant="outline">Cancel</Button>
			<Button>Save host</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
