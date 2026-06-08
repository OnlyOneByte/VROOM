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
		const cols = columns ?? Math.min(items.length, 4);
		if (cols === 2) return 'lg:grid-cols-2';
		if (cols === 3) return 'lg:grid-cols-3';
		return 'lg:grid-cols-4';
	});
</script>

<div class="grid grid-cols-2 {gridCols} gap-4 {className ?? ''}">
	{#each items as item (item.label)}
		<!-- min-w-0: grid items default to min-width:auto and refuse to shrink below
		     their content, which lets a wide StatCard (e.g. a dual-metric money card)
		     blow out the track on the narrow 2-col mobile grid. This is the canonical
		     CSS-grid overflow guard. -->
		<StatCard
			class="min-w-0"
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
