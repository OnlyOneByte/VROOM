<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { LoaderCircle, ChevronLeft, ChevronRight } from '@lucide/svelte';

	interface Props {
		currentOffset: number;
		pageSize: number;
		totalCount: number;
		isLoading?: boolean;
		onPageChange: (_offset: number) => void;
	}

	let { currentOffset, pageSize, totalCount, isLoading = false, onPageChange }: Props = $props();

	let currentPage = $derived(Math.floor(currentOffset / pageSize) + 1);
	let totalPages = $derived(Math.ceil(totalCount / pageSize));
	let isPrevDisabled = $derived(currentOffset === 0);
	let isNextDisabled = $derived(currentOffset + pageSize >= totalCount);
</script>

<div class="flex items-center justify-between border-t px-4 py-3">
	<p class="text-sm text-muted-foreground">
		Page {currentPage} of {totalPages}
	</p>
	<div class="flex items-center gap-2">
		{#if isLoading}
			<LoaderCircle class="h-4 w-4 animate-spin text-muted-foreground" />
		{/if}
		<Button
			variant="outline"
			size="sm"
			disabled={isPrevDisabled || isLoading}
			onclick={() => onPageChange(currentOffset - pageSize)}
		>
			<ChevronLeft class="h-4 w-4" />
			Previous
		</Button>
		<Button
			variant="outline"
			size="sm"
			disabled={isNextDisabled || isLoading}
			onclick={() => onPageChange(currentOffset + pageSize)}
		>
			Next
			<ChevronRight class="h-4 w-4" />
		</Button>
	</div>
</div>
