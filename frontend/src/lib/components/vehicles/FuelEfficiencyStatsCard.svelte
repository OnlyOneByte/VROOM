<script lang="ts">
	import { resolve } from '$app/paths';
	import { routes, paramRoutes } from '#lib/routes.ts';
	import { Gauge, Plus } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import StatCardGrid from '#lib/components/charts/StatCardGrid.svelte';
	import EmptyState from '#lib/components/common/empty-state.svelte';
	import { settingsStore } from '#lib/stores/settings.svelte.ts';
	import {
		getVolumeUnitLabel,
		getChargeUnitLabel,
		getDistanceUnitLabel,
		getFuelEfficiencyLabel,
		getElectricEfficiencyLabel
	} from '#lib/utils/units.ts';
	import { formatCurrency, formatNumber } from '#lib/utils/formatters.ts';
	import { COMMON_MESSAGES, EXPENSE_MESSAGES } from '#lib/constants/messages.ts';
	import type { UnitPreferences, VehicleStats } from '#lib/types/index.ts';

	interface Props {
		vehicleId: string;
		vehicleStatsData: VehicleStats | null;
		isLoadingStats: boolean;
		selectedStatsPeriod: string;
		unitPreferences?: UnitPreferences | undefined;
	}

	let { vehicleId, vehicleStatsData, isLoadingStats, selectedStatsPeriod, unitPreferences }: Props =
		$props();

	let hasFuelData = $derived(
		vehicleStatsData &&
			(vehicleStatsData.fuelExpenseCount > 0 || vehicleStatsData.chargeExpenseCount > 0)
	);
	let units = $derived(unitPreferences ?? settingsStore.unitPreferences);
	let distanceUnit = $derived(units.distanceUnit);
	let volumeUnit = $derived(units.volumeUnit);
	let chargeUnit = $derived(units.chargeUnit);
	let isKilometers = $derived(distanceUnit === 'kilometers');

	const LOADING_ITEMS = ['distance', 'fuel', 'efficiency'].map(label => ({
		label,
		value: '',
		secondaryLabel: '',
		secondaryValue: ''
	}));

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
				value: formatNumber(vehicleStatsData.currentMileage, 0),
				unit: getDistanceUnitLabel(distanceUnit, false),
				secondaryLabel: `${isKilometers ? 'Distance' : 'Miles'} Driven`,
				secondaryValue: formatNumber(vehicleStatsData.totalMileage, 0),
				secondaryUnit: selectedStatsPeriod === 'all' ? 'lifetime' : `in ${selectedStatsPeriod}`
			});
		}

		if (vehicleStatsData.totalFuelConsumed > 0) {
			items.push({
				label: 'Fuel Consumed',
				value: formatNumber(vehicleStatsData.totalFuelConsumed, 1),
				unit: getVolumeUnitLabel(volumeUnit, true),
				secondaryLabel: 'Total Fuel Cost',
				secondaryValue: formatCurrency(vehicleStatsData.totalFuelCost),
				secondaryUnit: `${vehicleStatsData.fuelExpenseCount} fill-ups`
			});
		}

		if (vehicleStatsData.totalChargeConsumed > 0) {
			items.push({
				label: 'Charge Consumed',
				value: formatNumber(vehicleStatsData.totalChargeConsumed, 1),
				unit: getChargeUnitLabel(chargeUnit, true),
				secondaryLabel: 'Total Charge Cost',
				secondaryValue: formatCurrency(vehicleStatsData.totalChargeCost),
				secondaryUnit: `${vehicleStatsData.chargeExpenseCount} charges`
			});
		}

		if (vehicleStatsData.averageMpg !== null) {
			items.push({
				label: `Average ${getFuelEfficiencyLabel(distanceUnit, volumeUnit)}`,
				value: formatNumber(vehicleStatsData.averageMpg, 1),
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
				value: formatNumber(vehicleStatsData.averageMilesPerKwh, 2),
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
			<h2 class="text-lg font-semibold">Mileage & Fuel Statistics</h2>
		</div>
		<StatCardGrid
			items={isLoadingStats && statItems.length === 0 ? LOADING_ITEMS : statItems}
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
				href={`${resolve(routes.expenseNew)}?vehicleId=${vehicleId}&returnTo=${resolve(paramRoutes.vehicle, { id: vehicleId })}&category=fuel`}
			>
				<Plus class="h-4 w-4 mr-2" />
				{COMMON_MESSAGES.ADD_FUEL_EXPENSE}
			</Button>
		{/snippet}
	</EmptyState>
{/if}
