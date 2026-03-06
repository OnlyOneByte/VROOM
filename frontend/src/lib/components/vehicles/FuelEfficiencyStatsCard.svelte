<script lang="ts">
	import { Gauge, Plus } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import { StatCardGrid } from '$lib/components/charts';
	import EmptyState from '$lib/components/common/empty-state.svelte';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import {
		getVolumeUnitLabel,
		getChargeUnitLabel,
		getDistanceUnitLabel,
		getFuelEfficiencyLabel,
		getElectricEfficiencyLabel
	} from '$lib/utils/units';
	import { formatCurrency } from '$lib/utils/formatters';
	import { COMMON_MESSAGES, EXPENSE_MESSAGES } from '$lib/constants/messages';
	import type { VehicleStats } from '$lib/types';

	interface Props {
		/** Unique identifier for the vehicle */
		vehicleId: string;
		/** Vehicle statistics data or null if not loaded */
		vehicleStatsData: VehicleStats | null;
		/** Loading state for statistics */
		isLoadingStats: boolean;
		/** Selected time period for statistics */
		selectedStatsPeriod: string;
	}

	let { vehicleId, vehicleStatsData, isLoadingStats, selectedStatsPeriod }: Props = $props();

	// Derived state
	let hasFuelData = $derived(
		vehicleStatsData &&
			(vehicleStatsData.fuelExpenseCount > 0 || vehicleStatsData.chargeExpenseCount > 0)
	);
	let distanceUnit = $derived(settingsStore.unitPreferences.distanceUnit);
	let volumeUnit = $derived(settingsStore.unitPreferences.volumeUnit);
	let chargeUnit = $derived(settingsStore.unitPreferences.chargeUnit);
	let isKilometers = $derived(distanceUnit === 'kilometers');

	let statItems = $derived.by(() => {
		if (!vehicleStatsData || !hasFuelData) return [];

		const items: {
			label: string;
			value: string | number;
			unit?: string;
			secondaryLabel?: string;
			secondaryValue?: string | number;
			secondaryUnit?: string;
		}[] = [];

		if (vehicleStatsData.currentMileage !== null) {
			items.push({
				label: `Current ${isKilometers ? 'Odometer' : 'Mileage'}`,
				value: vehicleStatsData.currentMileage.toLocaleString(),
				unit: getDistanceUnitLabel(distanceUnit, false),
				secondaryLabel: `${isKilometers ? 'Distance' : 'Miles'} Driven`,
				secondaryValue: vehicleStatsData.totalMileage.toLocaleString(),
				secondaryUnit: selectedStatsPeriod === 'all' ? 'lifetime' : `in ${selectedStatsPeriod}`
			});
		}

		if (vehicleStatsData.totalFuelConsumed > 0) {
			items.push({
				label: 'Fuel Consumed',
				value: vehicleStatsData.totalFuelConsumed.toFixed(1),
				unit: getVolumeUnitLabel(volumeUnit, true),
				secondaryLabel: 'Total Fuel Cost',
				secondaryValue: formatCurrency(vehicleStatsData.totalFuelCost),
				secondaryUnit: `${vehicleStatsData.fuelExpenseCount} fill-ups`
			});
		}

		if (vehicleStatsData.totalChargeConsumed > 0) {
			items.push({
				label: 'Charge Consumed',
				value: vehicleStatsData.totalChargeConsumed.toFixed(1),
				unit: getChargeUnitLabel(chargeUnit, true),
				secondaryLabel: 'Total Charge Cost',
				secondaryValue: formatCurrency(vehicleStatsData.totalChargeCost),
				secondaryUnit: `${vehicleStatsData.chargeExpenseCount} charges`
			});
		}

		if (vehicleStatsData.averageMpg !== null) {
			items.push({
				label: `Average ${getFuelEfficiencyLabel(distanceUnit, volumeUnit)}`,
				value: vehicleStatsData.averageMpg.toFixed(1),
				unit: 'fuel efficiency',
				secondaryLabel: `Cost per ${getDistanceUnitLabel(distanceUnit, true)}`,
				secondaryValue:
					vehicleStatsData.costPerMile !== null
						? formatCurrency(vehicleStatsData.costPerMile)
						: 'N/A',
				secondaryUnit: 'fuel only'
			});
		}

		if (vehicleStatsData.averageMilesPerKwh !== null) {
			items.push({
				label: 'Efficiency',
				value: vehicleStatsData.averageMilesPerKwh.toFixed(2),
				unit: getElectricEfficiencyLabel(distanceUnit, chargeUnit),
				secondaryLabel: `Cost per ${getDistanceUnitLabel(distanceUnit, true)}`,
				secondaryValue:
					vehicleStatsData.costPerMile !== null
						? formatCurrency(vehicleStatsData.costPerMile)
						: 'N/A',
				secondaryUnit: 'charge only'
			});
		}

		return items;
	});
</script>

{#if hasFuelData || isLoadingStats}
	<div class="space-y-3">
		<div class="flex items-center gap-2">
			<Gauge class="h-5 w-5" />
			<h3 class="text-lg font-semibold">Mileage & Fuel Statistics</h3>
		</div>
		<StatCardGrid
			items={isLoadingStats ? Array(3).fill({ label: '', value: '' }) : statItems}
			columns={3}
			isLoading={isLoadingStats}
		/>
	</div>
{:else if vehicleStatsData}
	<EmptyState>
		{#snippet icon()}
			<Gauge class="h-12 w-12 text-muted-foreground mb-4" />
		{/snippet}
		{#snippet title()}
			{COMMON_MESSAGES.NO_FUEL_DATA}
		{/snippet}
		{#snippet description()}
			{EXPENSE_MESSAGES.ADD_FUEL_DESC}
		{/snippet}
		{#snippet action()}
			<Button
				href="/expenses/new?vehicleId={vehicleId}&returnTo=/vehicles/{vehicleId}&category=fuel"
			>
				<Plus class="h-4 w-4 mr-2" />
				{COMMON_MESSAGES.ADD_FUEL_EXPENSE}
			</Button>
		{/snippet}
	</EmptyState>
{/if}
