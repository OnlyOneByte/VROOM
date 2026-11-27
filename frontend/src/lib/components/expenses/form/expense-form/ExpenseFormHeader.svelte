<script lang="ts">
	import type { Snippet } from 'svelte';
	import { ArrowLeft, ChevronLeft } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import PageHeader from '#lib/components/common/page-header.svelte';

	interface Props {
		title: string;
		onBack: () => void;
		subtitle?: Snippet;
		quick?: boolean;
		edit?: boolean;
		backLabel?: string;
		actions?: Snippet;
	}

	let {
		title,
		onBack,
		subtitle,
		quick = false,
		edit = false,
		backLabel = 'Back',
		actions
	}: Props = $props();
</script>

{#if quick}
	<div
		class="text-center [&_h1]:text-sm [&_h1]:font-medium [&_h1]:tracking-normal [&_h1]:text-muted-foreground [&>div>div]:justify-center [&_p]:text-sm"
		data-testid="quick-add-header"
	>
		<PageHeader {title} description={subtitle} />
	</div>
{:else if edit}
	<div class="space-y-1" data-testid="expense-edit-header">
		<button
			type="button"
			aria-label={backLabel === 'Back' ? undefined : `Back to ${backLabel}`}
			onclick={onBack}
			class="-ml-1 inline-flex min-h-11 items-center gap-1 rounded-[var(--r-sm)] px-1 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
		>
			<ChevronLeft class="size-4" aria-hidden="true" />
			{backLabel}
		</button>
		<PageHeader variant="display" {title} eyebrow={subtitle} {actions} />
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
