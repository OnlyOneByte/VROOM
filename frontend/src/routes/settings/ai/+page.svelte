<script lang="ts">
	import { resolve } from '$app/paths';
	import { ArrowLeft } from '@lucide/svelte';
	import PageHeader from '#lib/components/common/page-header.svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import ModelProvidersCard from '#lib/components/settings/cards/ModelProvidersCard.svelte';
	import { routes } from '#lib/routes.ts';
</script>

<svelte:head>
	<title>AI helpers - VROOM Car Tracker</title>
	<meta
		name="description"
		content="Connect your own AI providers for receipt scanning and the assistant"
	/>
</svelte:head>

<div class="mx-auto w-full max-w-2xl lg:max-w-5xl">
	<div class="mb-6">
		<PageHeader
			title="AI helpers"
			description="Optional. Use your own provider to scan receipts and answer questions about your costs."
		>
			{#snippet back()}
				<Button
					variant="ghost"
					size="icon-lg"
					class="shrink-0"
					aria-label="Back to Settings"
					href={resolve(routes.settings)}
				>
					<ArrowLeft class="size-5" />
				</Button>
			{/snippet}
		</PageHeader>
	</div>

	<div class="grid gap-x-12 gap-y-6 lg:grid-cols-2 lg:items-start">
		<ModelProvidersCard domain="vlm" />
		<ModelProvidersCard domain="llm" />
	</div>
</div>
