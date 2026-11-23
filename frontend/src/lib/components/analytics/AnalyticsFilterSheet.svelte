<script lang="ts">
	import { untrack } from 'svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Checkbox } from '#lib/components/ui/checkbox/index.ts';
	import DateRangePicker from '#lib/components/common/date-range-picker.svelte';
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
		onRetryVehicles?: () => void;
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

	let customFrom = $state<string | undefined>(undefined);
	let customTo = $state<string | undefined>(undefined);
	let seeded = '';

	$effect(() => {
		if (menu !== 'range') return;
		untrack(() => {
			const range = filterDateRange(filters);
			customFrom = filters.from ?? toDayString(new Date(range.startDate * 1000));
			customTo = filters.to ?? toDayString(new Date((range.endDate - 1) * 1000));
			seeded = `${customFrom}|${customTo}`;
		});
	});

	$effect(() => {
		const picked = `${customFrom}|${customTo}`;
		if (menu !== 'range' || !customFrom || !customTo || picked === seeded) return;
		untrack(() => applyCustom(customFrom as string, customTo as string));
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
	<Sheet.Content {side} class={side === 'bottom' ? 'max-h-[85vh]' : 'sm:max-w-sm'}>
		<Sheet.Header>
			<Sheet.Title>{menu === 'cars' ? 'Cars' : 'Date range'}</Sheet.Title>
			<Sheet.Description>
				{menu === 'cars' ? 'Every tab shows only these cars.' : 'Every tab shows this period.'}
			</Sheet.Description>
		</Sheet.Header>

		<div class="px-4">
			{#if menu === 'cars' && vehiclesError}
				<div class="space-y-3" role="alert">
					<p class="text-sm">Couldn't load your cars. {vehiclesError}</p>
					{#if onRetryVehicles}
						<Button variant="outline" onclick={onRetryVehicles}>Try Again</Button>
					{/if}
				</div>
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
				<div class="mt-3 space-y-2 border-t pt-3">
					<Label for="analytics-range-custom" class="text-sm font-medium">Custom range</Label>
					<DateRangePicker
						id="analytics-range-custom"
						bind:startValue={customFrom}
						bind:endValue={customTo}
						placeholder="Pick a start and end date"
					/>
				</div>
			{/if}
		</div>

		<Sheet.Footer class="pb-[max(1rem,env(safe-area-inset-bottom))]">
			<Button size="lg" class="w-full" onclick={() => (menu = null)}>Done</Button>
		</Sheet.Footer>
	</Sheet.Content>
</Sheet.Root>
