<script lang="ts">
	import type { Snippet } from 'svelte';
	import { ArrowLeft } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';

	interface Props {
		title: string;
		onBack: () => void;
		subtitle: Snippet;
	}

	let { title, onBack, subtitle }: Props = $props();
</script>

<div class="flex items-center gap-4">
	<Button variant="ghost" size="icon-lg" aria-label="Go back" onclick={onBack} class="shrink-0">
		<ArrowLeft class="h-5 w-5" />
	</Button>

	<div>
		<h1 class="text-2xl font-bold text-foreground">{title}</h1>
		<p class="text-muted-foreground">
			{@render subtitle()}
		</p>
	</div>
</div>
