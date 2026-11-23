<script lang="ts">
	import { untrack } from 'svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Checkbox } from '#lib/components/ui/checkbox/index.ts';
	import { parseDate, type DateValue } from '@internationalized/date';
	import { CalendarRange } from '@lucide/svelte';
	import LoadErrorCard from '#lib/components/common/LoadErrorCard.svelte';
	import { RangeCalendar } from '#lib/components/ui/range-calendar/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import * as RadioGroup from '#lib/components/ui/radio-group/index.ts';
	import * as Sheet from '#lib/components/ui/sheet/index.ts';
	import {
		DEFAULT_RANGE,
		RANGE_PRESETS,
		filterDateRange,
		toDayString,
		type AnalyticsFilters,
		type AnalyticsRange,
		type FilterMenu
	} from './analytics-filters';

	interface Props {
		menu: FilterMenu | null;
		side: 'bottom' | 'right';
		filters: AnalyticsFilters;
		vehicles: Array<{ id: string; name: string }>;
		onChange: (_filters: AnalyticsFilters) => void;
		vehiclesError?: string | null;
		onRetryVehicles?: () => unknown;
	}

	let {
		menu = $bindable(),
		side,
		filters,
		vehicles,
		onChange,
		vehiclesError,
		onRetryVehicles
	}: Props = $props();

	let names = $derived(new Set(vehicles.map(v => v.id)));
	let selectedCars = $derived(filters.cars.filter(id => names.has(id)));

	let customOpen = $state(false);
	let customValue = $state<{ start: DateValue | undefined; end: DateValue | undefined }>();
	let seeded = '';

	$effect(() => {
		if (menu !== 'range') return;
		untrack(() => {
			const range = filterDateRange(filters);
			const from = filters.from ?? toDayString(new Date(range.startDate * 1000));
			const to = filters.to ?? toDayString(new Date((range.endDate - 1) * 1000));
			customValue = { start: parseDate(from), end: parseDate(to) };
			customOpen = filters.range === 'custom';
			seeded = `${from}|${to}`;
		});
	});

	$effect(() => {
		const start = customValue?.start?.toString();
		const end = customValue?.end?.toString();
		if (menu !== 'range' || !start || !end || `${start}|${end}` === seeded) return;
		untrack(() => applyCustom(start, end));
	});

	function pickRange(value: string) {
		onChange({ cars: filters.cars, range: (value as AnalyticsRange) ?? DEFAULT_RANGE });
		menu = null;
	}

	function applyCustom(from: string, to: string) {
		onChange({ cars: filters.cars, range: 'custom', from, to });
		menu = null;
	}

	function toggleCar(id: string, checked: boolean) {
		const next = checked ? [...selectedCars, id] : selectedCars.filter(c => c !== id);
		const ordered = vehicles.map(v => v.id).filter(v => next.includes(v));
		onChange({ ...filters, cars: ordered.length === vehicles.length ? [] : ordered });
	}
</script>

<Sheet.Root
	open={menu !== null}
	onOpenChange={open => {
		if (!open) menu = null;
	}}
>
	<Sheet.Content
		{side}
		class={side === 'bottom' ? 'max-h-[85vh] overflow-y-auto' : 'overflow-y-auto sm:max-w-sm'}
	>
		<Sheet.Header>
			<Sheet.Title>{menu === 'cars' ? 'Cars' : 'Date range'}</Sheet.Title>
			<Sheet.Description>
				{menu === 'cars' ? 'Every tab shows only these cars.' : 'Every tab shows this period.'}
			</Sheet.Description>
		</Sheet.Header>

		<div class="px-4">
			{#if menu === 'cars' && vehiclesError}
				<LoadErrorCard
					title="Couldn't load your cars"
					message={vehiclesError}
					onRetry={() => onRetryVehicles?.()}
				/>
			{:else if menu === 'cars'}
				<div class="space-y-1" role="group" aria-label="Cars">
					<Label
						for="analytics-car-all"
						class="flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-2 font-normal hover:bg-muted"
					>
						<Checkbox
							id="analytics-car-all"
							checked={selectedCars.length === 0}
							onCheckedChange={() => onChange({ ...filters, cars: [] })}
						/>
						All cars
					</Label>
					{#each vehicles as vehicle (vehicle.id)}
						<Label
							for="analytics-car-{vehicle.id}"
							class="flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-2 font-normal hover:bg-muted"
						>
							<Checkbox
								id="analytics-car-{vehicle.id}"
								checked={selectedCars.includes(vehicle.id)}
								onCheckedChange={checked => toggleCar(vehicle.id, checked === true)}
							/>
							<span class="min-w-0 break-words leading-snug">{vehicle.name}</span>
						</Label>
					{/each}
				</div>
			{:else}
				<RadioGroup.Root
					value={filters.range}
					onValueChange={pickRange}
					aria-label="Date range"
					class="gap-1"
				>
					{#each RANGE_PRESETS as preset (preset.value)}
						<Label
							for="analytics-range-{preset.value}"
							class="flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-2 font-normal hover:bg-muted"
						>
							<RadioGroup.Item value={preset.value} id="analytics-range-{preset.value}" />
							{preset.label}
						</Label>
					{/each}
				</RadioGroup.Root>
				<div class="mt-3 space-y-3 border-t pt-3">
					<Button
						variant="outline"
						class="w-full justify-start"
						aria-expanded={customOpen}
						aria-controls="analytics-range-calendar"
						onclick={() => (customOpen = !customOpen)}
					>
						<CalendarRange class="mr-2 h-4 w-4" aria-hidden="true" />
						Pick Custom Dates
					</Button>
					{#if customOpen}
						<div id="analytics-range-calendar" class="flex flex-col items-center gap-2">
							<p class="text-sm text-muted-foreground">Choose the first day, then the last day.</p>
							<RangeCalendar
								bind:value={customValue}
								numberOfMonths={1}
								captionLayout="dropdown"
								class="rounded-md border"
							/>
						</div>
					{/if}
				</div>
			{/if}
		</div>

		<Sheet.Footer class="pb-[max(1rem,env(safe-area-inset-bottom))]">
			<Button size="lg" class="w-full" onclick={() => (menu = null)}>Done</Button>
		</Sheet.Footer>
	</Sheet.Content>
</Sheet.Root>
