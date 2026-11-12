<script lang="ts">
	import { ListFilter } from '@lucide/svelte';
	import * as Select from '$lib/components/ui/select';
	import { categoryLabels } from '$lib/utils/expense-helpers';
	import type { ExpenseCategory } from '$lib/types';

	interface Props {
		value: string;
		onChange: (_category: string) => void;
		density: 'compact' | 'table';
	}

	let { value, onChange, density }: Props = $props();

	let isCompact = $derived(density === 'compact');
</script>

<Select.Root
	type="single"
	{value}
	onValueChange={v => {
		onChange(v);
	}}
>
	<Select.Trigger
		class={isCompact
			? 'h-8 px-2 border-none shadow-none hover:bg-muted font-medium text-muted-foreground text-xs'
			: 'h-8 px-2 -ml-2 border-none shadow-none hover:bg-muted font-medium text-muted-foreground'}
	>
		<div class="flex items-center gap-1">
			{#if value}
				<ListFilter class="{isCompact ? 'h-3 w-3' : 'h-3.5 w-3.5'} text-primary" />
				{categoryLabels[value as ExpenseCategory]}
			{:else if isCompact}
				<ListFilter class="h-3 w-3" />
				Category
			{:else}
				Category
			{/if}
		</div>
	</Select.Trigger>
	<Select.Content>
		<Select.Item value="" label="All Categories">All Categories</Select.Item>
		{#each Object.entries(categoryLabels) as [category, label] (category)}
			<Select.Item value={category} {label}>{label}</Select.Item>
		{/each}
	</Select.Content>
</Select.Root>
