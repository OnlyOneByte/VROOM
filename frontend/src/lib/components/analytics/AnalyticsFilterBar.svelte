<script lang="ts">
	import { tick } from 'svelte';
	import { ChevronDown, X } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { IsMobile } from '#lib/hooks/is-mobile.svelte.ts';
	import { formatDate } from '#lib/utils/formatters.ts';
	import {
		DEFAULT_RANGE,
		carsLabel,
		isDefaultFilters,
		rangeLabel,
		type AnalyticsFilters,
		type FilterMenu
	} from './analytics-filters';

	interface Props {
		filters: AnalyticsFilters;
		vehicles: Array<{ id: string; name: string }>;
		onChange: (_filters: AnalyticsFilters) => void;
		vehiclesError?: string | null;
		onRetryVehicles?: () => void;
		inline?: boolean;
	}

	let {
		filters,
		vehicles,
		onChange,
		vehiclesError,
		onRetryVehicles,
		inline = false
	}: Props = $props();
	let group = $state<HTMLElement | null>(null);

	const isMobile = new IsMobile();
	const loadSheet = () => import('./AnalyticsFilterSheet.svelte');
	let menu = $state<FilterMenu | null>(null);
	let sheetRequested = $state(false);

	let names = $derived(new Map(vehicles.map(v => [v.id, v.name])));
	let currentRangeLabel = $derived(rangeLabel(filters, d => formatDate(d), isMobile.current));
	let currentCarsLabel = $derived(carsLabel(filters.cars, names));

	function openMenu(next: FilterMenu) {
		sheetRequested = true;
		menu = next;
	}

	function prefetch() {
		void loadSheet();
	}

	async function clearFilters() {
		onChange({ range: DEFAULT_RANGE, cars: [] });
		await tick();
		group?.querySelector<HTMLElement>('button')?.focus();
	}
</script>

{#snippet trigger(target: FilterMenu, prefix: string, label: string)}
	<Button
		variant="outline"
		class="h-10 max-w-xs gap-1.5 rounded-full px-4"
		aria-haspopup="dialog"
		aria-expanded={menu === target}
		onclick={() => openMenu(target)}
		onpointerenter={prefetch}
		onfocus={prefetch}
	>
		<span class="text-muted-foreground">{prefix}</span>
		<span class="min-w-0 truncate font-medium">{label}</span>
		<ChevronDown class="h-4 w-4 shrink-0" aria-hidden="true" />
	</Button>
{/snippet}

<div
	bind:this={group}
	class={inline ? 'contents' : 'flex flex-wrap items-center gap-2'}
	role="group"
	aria-label="Analytics filters"
>
	{@render trigger('range', 'Range', currentRangeLabel)}
	{@render trigger('cars', 'Cars', currentCarsLabel)}

	{#if !isDefaultFilters(filters)}
		{#if isMobile.current}
			<Button
				variant="ghost"
				size="icon"
				class="size-10 shrink-0"
				aria-label="Clear filters"
				onclick={clearFilters}
			>
				<X class="h-4 w-4" aria-hidden="true" />
			</Button>
		{:else}
			<Button variant="ghost" onclick={clearFilters}>
				<X class="mr-1 h-4 w-4" aria-hidden="true" />
				Clear filters
			</Button>
		{/if}
	{/if}
</div>

{#if sheetRequested}
	{#await loadSheet() then { default: AnalyticsFilterSheet }}
		<AnalyticsFilterSheet
			bind:menu
			side={isMobile.current ? 'bottom' : 'right'}
			{filters}
			{vehicles}
			{onChange}
			{vehiclesError}
			{onRetryVehicles}
		/>
	{/await}
{/if}
