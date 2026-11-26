<script lang="ts">
	import type { Snippet } from 'svelte';
	import { ArrowLeft } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import PageHeader from '#lib/components/common/page-header.svelte';

	interface Props {
		title: string;
		onBack: () => void;
		subtitle?: Snippet;
		quick?: boolean;
	}

	let { title, onBack, subtitle, quick = false }: Props = $props();
</script>

{#if quick}
	<div
		class="text-center [&_h1]:text-sm [&_h1]:font-medium [&_h1]:tracking-normal [&_h1]:text-muted-foreground [&>div>div]:justify-center [&_p]:text-sm"
		data-testid="quick-add-header"
	>
		<PageHeader {title} description={subtitle} />
	</div>
{:else}
	<PageHeader {title} description={subtitle}>
		{#snippet back()}
			<Button variant="ghost" size="icon-lg" aria-label="Go back" onclick={onBack} class="shrink-0">
				<ArrowLeft class="size-5" />
			</Button>
		{/snippet}
	</PageHeader>
{/if}
