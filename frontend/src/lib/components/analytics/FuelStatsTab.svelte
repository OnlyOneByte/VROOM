<script lang="ts">
	import { onMount } from 'svelte';
	import {
		LoaderCircle,
		CircleAlert,
		Fuel,
		Droplet,
		Gauge,
		DollarSign,
		Navigation,
		TrendingUp,
		TrendingDown
	} from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { analyticsApi, getDefaultDateRange } from '$lib/services/analytics-api';
	import type { FuelStatsResponse, FuelAdvancedResponse } from '$lib/types';
	import { formatCurrency } from '$lib/utils/formatters';
	import {
		getDistanceUnitLabel,
		getVolumeUnitLabel,
		getFuelEfficiencyLabel,
		getCostPerDistanceLabel,
		getLongFormLabel
	} from '$lib/utils/units';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import FuelCharts from './FuelCharts.svelte';
	import AdvancedCharts from './AdvancedCharts.svelte';

	let {
		fuelStats: fuelStatsProp = null,
		fuelAdvanced: fuelAdvancedProp = null
	}: {
		fuelStats?: FuelStatsResponse | null;
		fuelAdvanced?: FuelAdvancedResponse | null;
	} = $props();

	let localFuelStats = $state<FuelStatsResponse | null>(null);
	let localFuelAdvanced = $state<FuelAdvancedResponse | null>(null);
	let internalLoading = $state(true);
	let error = $state<string | null>(null);

	let fuelStats = $derived(fuelStatsProp ?? localFuelStats);
	let fuelAdvanced = $derived(fuelAdvancedProp ?? localFuelAdvanced);
	let isLoading = $derived((!fuelStats || !fuelAdvanced) && internalLoading);

	// Unit labels derived from response units metadata, falling back to global settings
	let units = $derived(fuelStats?.units ?? settingsStore.unitPreferences);
	let distLabelShort = $derived(getDistanceUnitLabel(units.distanceUnit, true));
	let volLabelShort = $derived(getVolumeUnitLabel(units.volumeUnit, true));
	let volLabelLong = $derived(getLongFormLabel(units.volumeUnit));
	let effLabel = $derived(getFuelEfficiencyLabel(units.distanceUnit, units.volumeUnit));
	let costPerDistLabel = $derived(getCostPerDistanceLabel(units.distanceUnit));

	function pctChange(current: number, previous: number): number | null {
		if (previous === 0) return null;
		return Math.round(((current - previous) / previous) * 100);
	}

	async function loadData() {
		try {
			internalLoading = true;
			error = null;
			const range = getDefaultDateRange();
			const [stats, advanced] = await Promise.all([
				analyticsApi.getFuelStats(range),
				analyticsApi.getFuelAdvanced(range)
			]);
			localFuelStats = stats;
			localFuelAdvanced = advanced;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load fuel stats';
		} finally {
			internalLoading = false;
		}
	}

	onMount(() => {
		if (!fuelStatsProp || !fuelAdvancedProp) {
			loadData();
		}
	});
</script>

{#snippet changeBadge(current: number, previous: number)}
	{@const change = pctChange(current, previous)}
	{#if change != null}
		<span
			class="inline-flex items-center gap-1 text-xs font-medium {change >= 0
				? 'text-chart-2'
				: 'text-destructive'}"
		>
			{#if change >= 0}
				<TrendingUp class="h-3 w-3" />
			{:else}
				<TrendingDown class="h-3 w-3" />
			{/if}
			{change > 0 ? '+' : ''}{change}%
		</span>
	{/if}
{/snippet}

{#if isLoading}
	<div class="flex justify-center p-12">
		<LoaderCircle class="h-8 w-8 animate-spin text-muted-foreground" />
	</div>
{:else if error}
	<div class="rounded-lg border bg-card p-6">
		<div class="mb-4 flex items-center gap-3 text-destructive">
			<CircleAlert class="h-5 w-5" />
			<p class="font-medium">Failed to load fuel statistics</p>
		</div>
		<p class="mb-4 text-sm text-muted-foreground">{error}</p>
		<Button onclick={loadData}>Retry</Button>
	</div>
{:else if fuelStats}
	<div class="space-y-6">
		<!-- Row 1: Fill-ups, Gallons, Fuel Consumption -->
		<div class="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6 lg:grid-cols-3">
			<!-- Card 1: Fill-ups (ComparisonCard) -->
			<Card.Root>
				<Card.Content class="p-6">
					<div class="mb-4 flex items-center gap-2">
						<Fuel class="h-5 w-5 text-muted-foreground" />
						<h3 class="font-semibold text-foreground">Fill-ups</h3>
					</div>

					<div class="space-y-3 border-b pb-3">
						<div class="flex items-baseline justify-between">
							<span class="text-xs uppercase tracking-wide text-muted-foreground">This Year</span>
							<span class="text-2xl font-bold">{fuelStats.fillups.currentYear}</span>
						</div>
						<div class="flex items-center justify-between">
							<span class="text-xs text-muted-foreground">Last Year</span>
							<div class="flex items-center gap-2">
								<span class="text-sm text-muted-foreground">{fuelStats.fillups.previousYear}</span>
								{@render changeBadge(fuelStats.fillups.currentYear, fuelStats.fillups.previousYear)}
							</div>
						</div>
					</div>

					<div class="space-y-3 pt-3">
						<div class="flex items-baseline justify-between">
							<span class="text-xs uppercase tracking-wide text-muted-foreground">This Month</span>
							<span class="text-2xl font-bold">{fuelStats.fillups.currentMonth}</span>
						</div>
						<div class="flex items-center justify-between">
							<span class="text-xs text-muted-foreground">Last Month</span>
							<div class="flex items-center gap-2">
								<span class="text-sm text-muted-foreground">{fuelStats.fillups.previousMonth}</span>
								{@render changeBadge(
									fuelStats.fillups.currentMonth,
									fuelStats.fillups.previousMonth
								)}
							</div>
						</div>
					</div>
				</Card.Content>
			</Card.Root>

			<!-- Card 2: Volume (ComparisonCard) -->
			<Card.Root>
				<Card.Content class="p-6">
					<div class="mb-4 flex items-center gap-2">
						<Droplet class="h-5 w-5 text-muted-foreground" />
						<h3 class="font-semibold text-foreground">{volLabelLong}</h3>
					</div>

					<div class="space-y-3 border-b pb-3">
						<div class="flex items-baseline justify-between">
							<span class="text-xs uppercase tracking-wide text-muted-foreground">This Year</span>
							<span class="text-2xl font-bold">{fuelStats.volume.currentYear.toFixed(1)}</span>
						</div>
						<div class="flex items-center justify-between">
							<span class="text-xs text-muted-foreground">Last Year</span>
							<div class="flex items-center gap-2">
								<span class="text-sm text-muted-foreground"
									>{fuelStats.volume.previousYear.toFixed(1)}</span
								>
								{@render changeBadge(fuelStats.volume.currentYear, fuelStats.volume.previousYear)}
							</div>
						</div>
					</div>

					<div class="space-y-3 pt-3">
						<div class="flex items-baseline justify-between">
							<span class="text-xs uppercase tracking-wide text-muted-foreground">This Month</span>
							<span class="text-2xl font-bold">{fuelStats.volume.currentMonth.toFixed(1)}</span>
						</div>
						<div class="flex items-center justify-between">
							<span class="text-xs text-muted-foreground">Last Month</span>
							<div class="flex items-center gap-2">
								<span class="text-sm text-muted-foreground"
									>{fuelStats.volume.previousMonth.toFixed(1)}</span
								>
								{@render changeBadge(fuelStats.volume.currentMonth, fuelStats.volume.previousMonth)}
							</div>
						</div>
					</div>
				</Card.Content>
			</Card.Root>

			<!-- Card 3: Fuel Consumption (MetricWithMinMax) -->
			<Card.Root>
				<Card.Content class="p-6">
					<div class="mb-4 flex items-center gap-2">
						<Gauge class="h-5 w-5 text-muted-foreground" />
						<h3 class="font-semibold text-foreground">Fuel Consumption</h3>
					</div>

					<div class="border-b pb-3 text-center">
						<span class="text-xs uppercase tracking-wide text-muted-foreground"
							>Average {effLabel}</span
						>
						<p class="text-3xl font-bold">
							{fuelStats.fuelConsumption.avgEfficiency != null
								? fuelStats.fuelConsumption.avgEfficiency.toFixed(1)
								: 'N/A'}
						</p>
					</div>

					<div class="grid grid-cols-2 gap-4 pt-3">
						<div class="text-center">
							<span class="text-xs uppercase tracking-wide text-muted-foreground"
								>Best {effLabel}</span
							>
							<p class="text-xl font-bold text-chart-2">
								{fuelStats.fuelConsumption.bestEfficiency != null
									? fuelStats.fuelConsumption.bestEfficiency.toFixed(1)
									: 'N/A'}
							</p>
						</div>
						<div class="text-center">
							<span class="text-xs uppercase tracking-wide text-muted-foreground"
								>Worst {effLabel}</span
							>
							<p class="text-xl font-bold text-destructive">
								{fuelStats.fuelConsumption.worstEfficiency != null
									? fuelStats.fuelConsumption.worstEfficiency.toFixed(1)
									: 'N/A'}
							</p>
						</div>
					</div>
				</Card.Content>
			</Card.Root>
		</div>

		<!-- Row 2: Fill-up Details, Average Cost, Distance -->
		<div class="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6 lg:grid-cols-3">
			<!-- Card 4: Fill-up Details (DetailedMetricsCard) -->
			<Card.Root>
				<Card.Content class="p-6">
					<div class="mb-4 flex items-center gap-2">
						<Droplet class="h-5 w-5 text-muted-foreground" />
						<h3 class="font-semibold text-foreground">Fill-up Details</h3>
					</div>

					<div class="border-b pb-4 text-center">
						<span class="text-xs uppercase tracking-wide text-muted-foreground"
							>Average Fill-up</span
						>
						<p class="text-3xl font-bold">
							{fuelStats.fillupDetails.avgVolume != null
								? fuelStats.fillupDetails.avgVolume.toFixed(1) + ' ' + volLabelShort
								: 'N/A'}
						</p>
					</div>

					<div class="space-y-2 pt-3">
						<div class="flex items-center justify-between text-sm">
							<span class="text-muted-foreground">Min Fill-up</span>
							<span class="font-semibold">
								{fuelStats.fillupDetails.minVolume != null
									? fuelStats.fillupDetails.minVolume.toFixed(1) + ' ' + volLabelShort
									: 'N/A'}
							</span>
						</div>
						<div class="flex items-center justify-between text-sm">
							<span class="text-muted-foreground">Max Fill-up</span>
							<span class="font-semibold">
								{fuelStats.fillupDetails.maxVolume != null
									? fuelStats.fillupDetails.maxVolume.toFixed(1) + ' ' + volLabelShort
									: 'N/A'}
							</span>
						</div>
					</div>
				</Card.Content>
			</Card.Root>

			<!-- Card 5: Average Cost (DetailedMetricsCard) -->
			<Card.Root>
				<Card.Content class="p-6">
					<div class="mb-4 flex items-center gap-2">
						<DollarSign class="h-5 w-5 text-muted-foreground" />
						<h3 class="font-semibold text-foreground">Average Cost</h3>
					</div>

					<div class="border-b pb-4 text-center">
						<span class="text-xs uppercase tracking-wide text-muted-foreground">Per Fill-up</span>
						<p class="text-3xl font-bold">
							{fuelStats.averageCost.perFillup != null
								? formatCurrency(fuelStats.averageCost.perFillup)
								: 'N/A'}
						</p>
					</div>

					<div class="space-y-2 pt-3">
						<div class="flex items-center justify-between text-sm">
							<span class="text-muted-foreground">Best {costPerDistLabel}</span>
							<span class="font-semibold">
								{fuelStats.averageCost.bestCostPerDistance != null
									? formatCurrency(fuelStats.averageCost.bestCostPerDistance)
									: 'N/A'}
							</span>
						</div>
						<div class="flex items-center justify-between text-sm">
							<span class="text-muted-foreground">Worst {costPerDistLabel}</span>
							<span class="font-semibold">
								{fuelStats.averageCost.worstCostPerDistance != null
									? formatCurrency(fuelStats.averageCost.worstCostPerDistance)
									: 'N/A'}
							</span>
						</div>
						{#if fuelStats.averageCost.avgCostPerDay != null}
							<div class="flex items-center justify-between text-sm">
								<span class="text-muted-foreground">Avg Cost/Day</span>
								<span class="font-semibold">
									{formatCurrency(fuelStats.averageCost.avgCostPerDay)}
								</span>
							</div>
						{/if}
					</div>
				</Card.Content>
			</Card.Root>

			<!-- Card 6: Distance (DetailedMetricsCard) -->
			<Card.Root>
				<Card.Content class="p-6">
					<div class="mb-4 flex items-center gap-2">
						<Navigation class="h-5 w-5 text-muted-foreground" />
						<h3 class="font-semibold text-foreground">Distance with VROOM</h3>
					</div>

					<div class="border-b pb-4 text-center">
						<span class="text-xs uppercase tracking-wide text-muted-foreground">Total Distance</span
						>
						<p class="text-3xl font-bold">
							{fuelStats.distance.totalDistance.toLocaleString()}
							{distLabelShort}
						</p>
					</div>

					<div class="space-y-2 pt-3">
						<div class="flex items-center justify-between text-sm">
							<span class="text-muted-foreground">Avg/Day</span>
							<span class="font-semibold">
								{fuelStats.distance.avgPerDay != null
									? fuelStats.distance.avgPerDay.toFixed(1) + ' ' + distLabelShort
									: 'N/A'}
							</span>
						</div>
						<div class="flex items-center justify-between text-sm">
							<span class="text-muted-foreground">Avg/Month</span>
							<span class="font-semibold">
								{fuelStats.distance.avgPerMonth != null
									? fuelStats.distance.avgPerMonth.toFixed(0) + ' ' + distLabelShort
									: 'N/A'}
							</span>
						</div>
					</div>
				</Card.Content>
			</Card.Root>
		</div>

		<!-- Fuel Charts -->
		<FuelCharts {fuelStats} dayOfWeekPatterns={fuelAdvanced?.dayOfWeekPatterns} />

		<!-- Advanced Charts -->
		{#if fuelAdvanced}
			<AdvancedCharts {fuelAdvanced} />
		{/if}
	</div>
{/if}
