<script lang="ts">
	import { DollarSign, Search } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import {
		Empty,
		EmptyContent,
		EmptyDescription,
		EmptyHeader,
		EmptyMedia,
		EmptyTitle
	} from '#lib/components/ui/empty/index.ts';

	interface Props {
		hasActiveFilters: boolean;
		emptyTitle: string;
		emptyDescription: string;
		emptyActionLabel: string;
		emptyActionHref: string;
		onClearFilters?: () => void;
	}

	let {
		hasActiveFilters,
		emptyTitle,
		emptyDescription,
		emptyActionLabel,
		emptyActionHref,
		onClearFilters
	}: Props = $props();
</script>

<Empty>
	<EmptyHeader>
		<EmptyMedia>
			{#if hasActiveFilters}
				<Search class="h-12 w-12 text-muted-foreground" />
			{:else}
				<DollarSign class="h-12 w-12 text-muted-foreground" />
			{/if}
		</EmptyMedia>
		<EmptyTitle>
			{hasActiveFilters ? 'No matching expenses' : emptyTitle}
		</EmptyTitle>
		<EmptyDescription>
			{hasActiveFilters
				? "Try adjusting your search or filters to find what you're looking for."
				: emptyDescription}
		</EmptyDescription>
	</EmptyHeader>
	<EmptyContent>
		{#if hasActiveFilters && onClearFilters}
			<Button onclick={onClearFilters} variant="outline">Clear Filters</Button>
		{:else}
			<Button href={emptyActionHref} class="inline-flex items-center gap-2">
				{emptyActionLabel}
			</Button>
		{/if}
	</EmptyContent>
</Empty>
