<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import { ChevronDown } from '@lucide/svelte';

	interface Props {
		title: string;
		description: string;
		children: Snippet;
	}

	let { title, description, children }: Props = $props();

	let open = $state(false);

	onMount(() => {
		open = window.matchMedia('(min-width: 1024px)').matches;
	});
</script>

<details bind:open class="group" data-slot="chart-group">
	<summary
		class="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3 text-left [&::-webkit-details-marker]:hidden"
	>
		<span class="min-w-0">
			<span class="block font-semibold text-foreground">{title}</span>
			<span class="block text-sm text-muted-foreground">{description}</span>
		</span>
		<ChevronDown
			class="h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
			aria-hidden="true"
		/>
	</summary>
	<div class="mt-4">
		{@render children()}
	</div>
</details>
