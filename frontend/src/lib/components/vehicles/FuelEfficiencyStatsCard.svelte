<script lang="ts">
	import { Gauge, Plus } from 'lucide-svelte';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { Button } from '$lib/components/ui/button';
	import StatCardDual from '$lib/components/ui/stat-card-dual.svelte';
	import EmptyState from '$lib/components/ui/empty-state.svelte';
	import { settingsStore } from '$lib/stores/settings';
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
	let hasFuelData = $derived(vehicleStatsData && vehicleStatsData.fuelExpenseCount > 0);
	let settings = $derived($settingsStore.settings);
	let distanceUnit = $derived(settings?.distanceUnit || 'miles');
	let volumeUnit = $derived(settings?.volumeUnit || 'gallons_us');
	let chargeUnit = $derived(settings?.chargeUnit || 'kwh');
	let isKilometers = $derived(distanceUnit === 'kilometers');
</script>

{#if isLoadingStats}
	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-2">
				<Gauge class="h-5 w-5" />
				Mileage & Fuel Statistics
			</CardTitle>
		</CardHeader>
		<CardContent>
			<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
				{#each Array(3) as _}
					<div class="flex flex-col p-4 rounded-lg border bg-card">
						<div class="flex items-start justify-between gap-4">
							<div class="flex-1 space-y-1">
								<Skeleton class="h-4 w-24" />
								<Skeleton class="h-8 w-20" />
							</div>
							<div class="w-px bg-border self-stretch my-1"></div>
							<div class="flex-1 space-y-1">
								<Skeleton class="h-4 w-20" />
								<Skeleton class="h-8 w-16" />
							</div>
						</div>
					</div>
				{/each}
			</div>
		</CardContent>
	</Card>
{:else if hasFuelData && vehicleStatsData}
	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-2">
				<Gauge class="h-5 w-5" />
				Mileage & Fuel Statistics
			</CardTitle>
		</CardHeader>
		<CardContent>
			<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
				{#if vehicleStatsData.currentMileage !== null}
					<StatCardDual
						label="Current {isKilometers ? 'Odometer' : 'Mileage'}"
						value={vehicleStatsData.currentMileage.toLocaleString()}
						unit={getDistanceUnitLabel(distanceUnit, false)}
						secondaryLabel="{isKilometers ? 'Distance' : 'Miles'} Driven"
						secondaryValue={vehicleStatsData.totalMileage.toLocaleString()}
						secondaryUnit={selectedStatsPeriod === 'all' ? 'lifetime' : `in ${selectedStatsPeriod}`}
					/>
				{/if}

				{#if vehicleStatsData.totalFuelConsumed > 0}
					<StatCardDual
						label="Fuel Consumed"
						value={vehicleStatsData.totalFuelConsumed.toFixed(1)}
						unit={getVolumeUnitLabel(volumeUnit, true)}
						secondaryLabel="Total Fuel Cost"
						secondaryValue={formatCurrency(vehicleStatsData.totalFuelCost)}
						secondaryUnit="{vehicleStatsData.fuelExpenseCount} fill-ups"
					/>
				{/if}

				{#if vehicleStatsData.totalChargeConsumed > 0}
					<StatCardDual
						label="Charge Consumed"
						value={vehicleStatsData.totalChargeConsumed.toFixed(1)}
						unit={getChargeUnitLabel(chargeUnit, true)}
						secondaryLabel="Total Charge Cost"
						secondaryValue={formatCurrency(vehicleStatsData.totalFuelCost)}
						secondaryUnit="{vehicleStatsData.fuelExpenseCount} charges"
					/>
				{/if}

				{#if vehicleStatsData.averageMpg !== null}
					<StatCardDual
						label="Average {getFuelEfficiencyLabel(distanceUnit, volumeUnit)}"
						value={vehicleStatsData.averageMpg.toFixed(1)}
						unit="fuel efficiency"
						secondaryLabel="Cost per {getDistanceUnitLabel(distanceUnit, true)}"
						secondaryValue={vehicleStatsData.costPerMile !== null
							? formatCurrency(vehicleStatsData.costPerMile)
							: 'N/A'}
						secondaryUnit="fuel only"
					/>
				{/if}

				{#if vehicleStatsData.averageMilesPerKwh !== null}
					<StatCardDual
						label="Efficiency"
						value={vehicleStatsData.averageMilesPerKwh.toFixed(2)}
						unit={getElectricEfficiencyLabel(distanceUnit, chargeUnit)}
						secondaryLabel="Cost per {getDistanceUnitLabel(distanceUnit, true)}"
						secondaryValue={vehicleStatsData.costPerMile !== null
							? formatCurrency(vehicleStatsData.costPerMile)
							: 'N/A'}
						secondaryUnit="charge only"
					/>
				{/if}
			</div>
		</CardContent>
	</Card>
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
