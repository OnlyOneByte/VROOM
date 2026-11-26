<script lang="ts">
	import DriversCard from '#lib/components/drivers/DriversCard.svelte';
	import * as Select from '#lib/components/ui/select/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import { settingsStore } from '#lib/stores/settings.svelte.ts';
	import type { Vehicle } from '#lib/types/index.ts';
	import { getVehicleDisplayName } from '#lib/utils/vehicle-helpers.ts';
	import type { AnalyticsDateRange } from './analytics-filters';

	interface Props {
		vehicles: Vehicle[];
		dateRange: AnalyticsDateRange;
		rangeText: string;
		preferredVehicleId?: string;
	}

	let { vehicles, dateRange, rangeText, preferredVehicleId }: Props = $props();

	let picked = $state('');
	let vehicleId = $derived(
		picked || vehicles.find(v => v.id === preferredVehicleId)?.id || vehicles[0]?.id || ''
	);
	let vehicle = $derived(vehicles.find(v => v.id === vehicleId));
	let from = $derived(new Date(dateRange.startDate * 1000));
	let to = $derived(new Date(dateRange.endDate * 1000));
</script>

<div class="space-y-4">
	{#if vehicles.length > 1}
		<div class="flex items-center gap-3">
			<Label for="drivers-vehicle">Vehicle</Label>
			<Select.Root type="single" value={vehicleId} onValueChange={v => (picked = v)}>
				<Select.Trigger id="drivers-vehicle" class="w-auto">
					{getVehicleDisplayName(vehicle)}
				</Select.Trigger>
				<Select.Content>
					{#each vehicles as v (v.id)}
						<Select.Item value={v.id} label={getVehicleDisplayName(v)}>
							{getVehicleDisplayName(v)}
						</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
	{/if}
	{#if vehicle}
		<DriversCard
			{vehicleId}
			distanceUnit={(vehicle.unitPreferences ?? settingsStore.unitPreferences).distanceUnit}
			{from}
			{to}
			description={rangeText}
			hiddenMessage="You can't see driver figures for this car. Ask its owner for access."
		/>
		{#await import('#lib/components/drivers/BalancesCard.svelte') then { default: BalancesCard }}
			<BalancesCard {vehicleId} {from} {to} description={rangeText} />
		{/await}
	{/if}
</div>
