<script lang="ts">
	import { Button } from '$lib/components/ui/button';

	let { href }: { href: string } = $props();
</script>

<Button {href} variant="outline" class="w-full justify-center">
	<span class="grid size-4 grid-cols-2 gap-px" aria-hidden="true">
		<span class="bg-[#f25022]"></span>
		<span class="bg-[#7fba00]"></span>
		<span class="bg-[#00a4ef]"></span>
		<span class="bg-[#ffb900]"></span>
	</span>
	Sign in with Microsoft
</Button>
