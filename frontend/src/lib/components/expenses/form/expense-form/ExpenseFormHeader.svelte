<script lang="ts">
	import type { Snippet } from 'svelte';
	import { ArrowLeft } from '@lucide/svelte';

	interface Props {
		title: string;
		onBack: () => void;
		subtitle: Snippet;
	}

	let { title, onBack, subtitle }: Props = $props();
</script>

<div class="flex items-center gap-4">
	<button aria-label="Go back" onclick={onBack} class="p-2 hover:bg-muted rounded-lg">
		<ArrowLeft class="h-5 w-5" />
	</button>

	<div>
		<h1 class="text-2xl font-bold text-foreground">{title}</h1>
		<p class="text-muted-foreground">
			{@render subtitle()}
		</p>
	</div>
</div>
