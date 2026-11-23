<script lang="ts">
	import type { Snippet } from 'svelte';
	import { ChevronDown } from '@lucide/svelte';
	import { cn } from '#lib/utils.ts';

	let { children, class: className }: { children: Snippet; class?: string } = $props();
</script>

<details class={cn('group', className)} data-slot="how-it-works">
	<summary
		class="inline-flex min-h-10 cursor-pointer list-none items-center gap-1 rounded-sm text-sm font-medium text-primary outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden"
	>
		<ChevronDown
			class="h-4 w-4 group-open:rotate-180 motion-safe:transition-transform motion-safe:duration-200"
			aria-hidden="true"
		/>
		How it works
	</summary>
	{@render children()}
</details>
