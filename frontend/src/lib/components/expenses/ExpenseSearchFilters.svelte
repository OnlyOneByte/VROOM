<script lang="ts">
	import { Search, X, Car } from '@lucide/svelte';
	import Input from '#lib/components/ui/input/input.svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as CardNs from '#lib/components/ui/card/index.ts';
	import * as Select from '#lib/components/ui/select/index.ts';
	import ExpenseTagFilter from '#lib/components/expenses/ExpenseTagFilter.svelte';
	import DateRangePicker from '#lib/components/common/date-range-picker.svelte';
	import { getVehicleDisplayName } from '#lib/utils/vehicle-helpers.ts';
	import { extractUniqueTags } from '#lib/utils/expense-filters.ts';
	import { COMMON_MESSAGES } from '#lib/constants/messages.ts';
	import type { Vehicle, Expense, ExpenseFilters } from '#lib/types/index.ts';

	interface Props {
		searchTerm: string;
		filters: ExpenseFilters;
		expenses: Expense[];
		vehicles?: Vehicle[];
		showVehicleSelector?: boolean;
		selectedVehicleId?: string | undefined;
		onSearchChange: (_value: string) => void;
		onVehicleChange?: (_vehicleId: string | undefined) => void;
		onClearFilters: () => void;
	}

	let {
		searchTerm,
		filters = $bindable(),
		expenses,
		vehicles = [],
		showVehicleSelector = false,
		selectedVehicleId = undefined,
		onSearchChange,
		onVehicleChange,
		onClearFilters
	}: Props = $props();

	let selectedTags = $derived(filters.tags ?? []);
	let allTags = $derived(extractUniqueTags(expenses));

	let hasActiveFilters = $derived(
		!!searchTerm ||
			!!selectedVehicleId ||
			selectedTags.length > 0 ||
			!!filters.category ||
			!!filters.startDate ||
			!!filters.endDate
	);

	function setTags(tags: string[]): void {
		filters = { ...filters, tags: tags.length > 0 ? tags : undefined };
	}
</script>

<CardNs.Root>
	<CardNs.Header>
		<div class="flex items-center justify-between gap-3">
			<div>
				<CardNs.Title>Search & Filters</CardNs.Title>
				<CardNs.Description>Find and filter your expenses</CardNs.Description>
			</div>
			<div class="flex items-center gap-2">
				<DateRangePicker
					bind:startValue={filters.startDate}
					bind:endValue={filters.endDate}
					placeholder="Date range"
					class="w-auto"
				/>
			</div>
		</div>
	</CardNs.Header>
	<CardNs.Content class="space-y-4">
		<div class="flex flex-col sm:flex-row gap-3">
			<div class="flex-1 relative">
				<div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
					<Search class="h-5 w-5 text-muted-foreground" />
				</div>
				<Input
					type="text"
					value={searchTerm}
					oninput={e => onSearchChange(e.currentTarget.value)}
					placeholder="Search by name, place, tag or amount"
					class="pl-10 w-full"
					aria-label="Search expenses"
				/>
			</div>
			{#if showVehicleSelector && vehicles.length > 0}
				<div class="sm:w-56">
					<Select.Root
						type="single"
						value={selectedVehicleId ?? ''}
						onValueChange={v => onVehicleChange?.(v === '' ? undefined : v)}
					>
						<Select.Trigger aria-label="Vehicle filter" class="w-full">
							<div class="flex items-center gap-2">
								<Car class="h-4 w-4 text-muted-foreground flex-shrink-0" />
								<span class="truncate">
									{#if selectedVehicleId}
										{@const selectedVehicle = vehicles.find(v => v.id === selectedVehicleId)}
										{selectedVehicle
											? getVehicleDisplayName(selectedVehicle)
											: COMMON_MESSAGES.ALL_VEHICLES}
									{:else}
										{COMMON_MESSAGES.ALL_VEHICLES}
									{/if}
								</span>
							</div>
						</Select.Trigger>
						<Select.Content>
							<Select.Item value="" label={COMMON_MESSAGES.ALL_VEHICLES}>
								{COMMON_MESSAGES.ALL_VEHICLES}
							</Select.Item>
							{#each vehicles as vehicle (vehicle.id)}
								<Select.Item value={vehicle.id} label={getVehicleDisplayName(vehicle)}>
									{getVehicleDisplayName(vehicle)}
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
			{/if}
		</div>

		<ExpenseTagFilter {allTags} {selectedTags} onTagsChange={setTags} />

		{#if hasActiveFilters}
			<div class="flex justify-end pt-2">
				<Button variant="outline" size="sm" onclick={onClearFilters}>
					<X class="h-4 w-4 mr-2" />
					{COMMON_MESSAGES.CLEAR_FILTERS}
				</Button>
			</div>
		{/if}
	</CardNs.Content>
</CardNs.Root>
