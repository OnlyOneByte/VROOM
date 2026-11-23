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
		class="grid min-h-10 cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-lg border bg-card px-4 py-3 text-left outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden"
	>
		<h2 class="col-start-1 font-semibold text-foreground">{title}</h2>
		<span class="col-start-1 text-sm text-muted-foreground">{description}</span>
		<ChevronDown
			class="col-start-2 row-span-2 row-start-1 h-5 w-5 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
			aria-hidden="true"
		/>
	</summary>
	<div class="mt-4">
		{@render children()}
	</div>
</details>
