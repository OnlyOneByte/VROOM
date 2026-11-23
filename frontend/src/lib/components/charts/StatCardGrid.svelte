<script lang="ts">
	import StatCard, { type StatCardChange } from './StatCard.svelte';
	import type { AnyIcon } from './types';

	export interface StatCardItem {
		label: string;
		value: string | number;
		unit?: string;
		icon?: AnyIcon;
		iconColor?: string;
		subtitle?: string;
		change?: StatCardChange | null;
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

	let hasDual = $derived(items.some(item => item.secondaryValue !== undefined));
	let joined = $derived(items.length === 3 && !hasDual);

	let gridClass = $derived.by(() => {
		if (joined) {
			return 'max-sm:grid-cols-1 sm:grid-cols-3 max-sm:gap-0 max-sm:rounded-xl max-sm:border max-sm:bg-card max-sm:shadow-sm max-sm:[&_[data-stat-icon]]:hidden max-sm:[&_[data-slot=card-content]]:grid max-sm:[&_[data-slot=card-content]]:grid-cols-[minmax(0,1fr)_auto] max-sm:[&_[data-slot=card-content]]:items-center max-sm:[&_[data-slot=card-content]]:gap-x-3 max-sm:[&_[data-slot=card-content]]:py-3 max-sm:[&_[data-stat-value]]:col-start-2 max-sm:[&_[data-stat-value]]:row-start-1 max-sm:[&_[data-slot=card-content]:has(>:nth-child(3))_[data-stat-value]]:row-[1/span_3] max-sm:[&_[data-stat-value]]:mt-0 max-sm:[&_[data-stat-value]]:whitespace-nowrap max-sm:[&_[data-stat-unit-bar]]:h-4';
		}
		return `${hasDual ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-2'} ${gridCols}`;
	});

	function tileClass(index: number): string {
		if (joined) {
			return index === 0
				? 'min-w-0 max-sm:rounded-none max-sm:border-0 max-sm:shadow-none max-sm:bg-transparent'
				: 'min-w-0 max-sm:rounded-none max-sm:border-0 max-sm:border-t max-sm:shadow-none max-sm:bg-transparent';
		}
		if (items.length % 2 === 0 || index !== items.length - 1) return 'min-w-0';
		if (hasDual)
			return items.length === 1 ? 'min-w-0 sm:col-span-2' : 'min-w-0 sm:col-span-2 lg:col-span-1';
		return items.length === 1 ? 'min-w-0 col-span-2' : 'min-w-0 col-span-2 lg:col-span-1';
	}
</script>

<div class="grid {gridClass} gap-4 {className ?? ''}">
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
			change={item.change}
			secondaryLabel={item.secondaryLabel}
			secondaryValue={item.secondaryValue}
			secondaryUnit={item.secondaryUnit}
			{isLoading}
		/>
	{/each}
</div>
