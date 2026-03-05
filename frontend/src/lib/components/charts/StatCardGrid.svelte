<script lang="ts">
	import StatCard from './StatCard.svelte';
	import type { SvelteComponent, Component } from 'svelte';

	// Lucide-svelte v0.x exports Svelte 4 class components (SvelteComponentTyped)
	// which aren't assignable to Svelte 5's function-based Component type.
	// Use a union to accept both legacy class constructors and modern components.

	type AnyIcon = Component<Record<string, unknown>> | (new (..._args: any[]) => SvelteComponent);

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
		<StatCard
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
