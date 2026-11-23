<script lang="ts">
	import StatCard from './StatCard.svelte';
	import type { AnyIcon } from './types';

	export interface StatCardItem {
		label: string;
		value: string | number;
		unit?: string;
		icon?: AnyIcon;
		iconColor?: string;
		subtitle?: string;
		secondaryLabel?: string;
		secondaryValue?: string | number;
		secondaryUnit?: string;
	}

	interface Props {
		items: StatCardItem[];
		columns?: 2 | 3 | 4;
		isLoading?: boolean;
		class?: string;
	}

	let { items, columns, isLoading = false, class: className }: Props = $props();

	let gridCols = $derived.by(() => {
		const cols = Math.min(columns ?? 4, items.length);
		if (cols <= 2) return 'lg:grid-cols-2';
		if (cols === 3) return 'lg:grid-cols-3';
		return 'lg:grid-cols-4';
	});

	function tileClass(index: number): string {
		if (items.length % 2 === 0 || index !== items.length - 1) return 'min-w-0';
		return items.length === 1 ? 'min-w-0 col-span-2' : 'min-w-0 col-span-2 lg:col-span-1';
	}
</script>

<div class="grid grid-cols-2 {gridCols} gap-4 {className ?? ''}">
	{#each items as item, index (item.label)}
		<!-- min-w-0 is required: grid items default to min-width auto and overflow. -->
		<StatCard
			class={tileClass(index)}
			label={item.label}
			value={item.value}
			unit={item.unit}
			icon={item.icon}
			iconColor={item.iconColor}
			subtitle={item.subtitle}
			secondaryLabel={item.secondaryLabel}
			secondaryValue={item.secondaryValue}
			secondaryUnit={item.secondaryUnit}
			{isLoading}
		/>
	{/each}
</div>
