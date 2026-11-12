<script lang="ts">
	import { ArrowUpDown } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import type { SortField } from './expense-table-rows';

	interface Props {
		label: string;
		field: SortField;
		sortBy: SortField;
		onSort: (_field: SortField) => void;
		class?: string;
		iconClass?: string;
	}

	let { label, field, sortBy, onSort, class: className = '', iconClass = '' }: Props = $props();
</script>

<Button variant="ghost" size="sm" onclick={() => onSort(field)} class={className}>
	{label}
	{#if sortBy === field}
		<ArrowUpDown class={iconClass} />
	{/if}
</Button>
