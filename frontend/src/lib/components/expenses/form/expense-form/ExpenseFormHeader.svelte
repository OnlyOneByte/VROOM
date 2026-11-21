<script lang="ts">
	import type { Snippet } from 'svelte';
	import { ArrowLeft } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import PageHeader from '#lib/components/common/page-header.svelte';

	interface Props {
		title: string;
		onBack: () => void;
		subtitle: Snippet;
	}

	let { title, onBack, subtitle }: Props = $props();
</script>

<PageHeader {title} description={subtitle}>
	{#snippet back()}
		<Button variant="ghost" size="icon-lg" aria-label="Go back" onclick={onBack} class="shrink-0">
			<ArrowLeft class="size-5" />
		</Button>
	{/snippet}
</PageHeader>
