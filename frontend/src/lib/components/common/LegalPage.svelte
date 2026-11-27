<script lang="ts">
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import { ArrowLeft } from '@lucide/svelte';
	import PageHeader from '#lib/components/common/page-header.svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { routes } from '#lib/routes.ts';

	let { title, updated, children }: { title: string; updated: string; children: Snippet } =
		$props();
</script>

<div class="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8 sm:py-12">
	<div class="mb-8">
		<PageHeader {title} description="Last updated: {updated}">
			{#snippet back()}
				<Button
					variant="ghost"
					size="icon-lg"
					class="shrink-0"
					aria-label="Back to home"
					href={resolve(routes.home)}
				>
					<ArrowLeft class="size-5" aria-hidden="true" />
				</Button>
			{/snippet}
		</PageHeader>
	</div>

	<div class="max-w-[68ch] space-y-8 leading-relaxed text-foreground">
		{@render children()}
	</div>
</div>
