<script lang="ts">
	import { CalendarRange, Car, ChevronDown, X } from '@lucide/svelte';
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
	}

	let { filters, vehicles, onChange }: Props = $props();

	const isMobile = new IsMobile();
	const loadSheet = () => import('./AnalyticsFilterSheet.svelte');
	let menu = $state<FilterMenu | null>(null);
	let sheetRequested = $state(false);

	let names = $derived(new Map(vehicles.map(v => [v.id, v.name])));
	let currentRangeLabel = $derived(rangeLabel(filters, d => formatDate(d)));
	let currentCarsLabel = $derived(carsLabel(filters.cars, names));

	function openMenu(next: FilterMenu) {
		sheetRequested = true;
		menu = next;
	}

	function prefetch() {
		void loadSheet();
	}
</script>

{#snippet trigger(target: FilterMenu, Icon: typeof Car, prefix: string, label: string)}
	<Button
		variant="outline"
		class={isMobile.current ? 'min-w-0 flex-1 gap-1.5 px-3' : 'max-w-xs gap-1.5'}
		aria-haspopup="dialog"
		aria-expanded={menu === target}
		onclick={() => openMenu(target)}
		onpointerenter={prefetch}
		onfocus={prefetch}
	>
		<Icon
			class="hidden h-4 w-4 shrink-0 text-muted-foreground min-[400px]:block"
			aria-hidden="true"
		/>
		<span class="sr-only">{prefix}:</span>
		<span class="min-w-0 flex-1 truncate text-left">{label}</span>
		<ChevronDown class="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
	</Button>
{/snippet}

<div class="flex flex-wrap items-center gap-2" role="group" aria-label="Analytics filters">
	{@render trigger('range', CalendarRange, 'Date range', currentRangeLabel)}
	{@render trigger('cars', Car, 'Cars', currentCarsLabel)}

	{#if !isDefaultFilters(filters)}
		<Button
			variant="ghost"
			class={isMobile.current ? 'w-full' : ''}
			onclick={() => onChange({ range: DEFAULT_RANGE, cars: [] })}
		>
			<X class="mr-1 h-4 w-4" aria-hidden="true" />
			Clear filters
		</Button>
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
		/>
	{/await}
{/if}
