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
		TrendingDown,
		BatteryCharging,
		Plug,
		Zap
	} from '@lucide/svelte';
	import { resolve } from '$app/paths';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import EmptyState from '#lib/components/common/empty-state.svelte';
	import { routes } from '#lib/routes.ts';
	import { gotoWithQuery } from '#lib/utils/navigation.ts';
	import { analyticsApi, getDefaultDateRange } from '#lib/services/analytics-api.ts';
	import type { FuelStatsResponse, FuelAdvancedResponse, PeriodCounts } from '#lib/types/index.ts';
	import { formatCurrency } from '#lib/utils/formatters.ts';
	import {
		getDistanceUnitLabel,
		getVolumeUnitLabel,
		getFuelEfficiencyLabel,
		getCostPerDistanceLabel,
		getLongFormLabel,
		getChargeUnitLabel,
		getElectricEfficiencyLabel
	} from '#lib/utils/units.ts';
	import { settingsStore } from '#lib/stores/settings.svelte.ts';
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

	let units = $derived(fuelStats?.units ?? settingsStore.unitPreferences);
	let distLabelShort = $derived(getDistanceUnitLabel(units.distanceUnit, true));
	let volLabelShort = $derived(getVolumeUnitLabel(units.volumeUnit, true));
	let volLabelLong = $derived(getLongFormLabel(units.volumeUnit));
	let effLabel = $derived(getFuelEfficiencyLabel(units.distanceUnit, units.volumeUnit));
	let costPerDistLabel = $derived(getCostPerDistanceLabel(units.distanceUnit));
	let chargeLabel = $derived(getChargeUnitLabel(units.chargeUnit, true));
	let electricEffLabel = $derived(getElectricEfficiencyLabel(units.distanceUnit, units.chargeUnit));

	let charging = $derived(fuelStats?.charging);
	let hasChargeData = $derived(
		!!charging && (charging.sessions.currentYear > 0 || charging.sessions.previousYear > 0)
	);
	let hasGasData = $derived(
		!!fuelStats && (fuelStats.fillups.currentYear > 0 || fuelStats.fillups.previousYear > 0)
	);
	let showGasCards = $derived(hasGasData || !hasChargeData);
	let perVisitCost = $derived(
		showGasCards
			? (fuelStats?.averageCost.perFillup ?? null)
			: (charging?.averageCost.perSession ?? null)
	);

	let hasFuelData = $derived(
		!!fuelStats &&
			(fuelStats.fillups.currentYear > 0 ||
				fuelStats.fillups.previousYear > 0 ||
				fuelStats.distance.totalDistance > 0 ||
				hasChargeData)
	);

	function logFillup() {
		gotoWithQuery(resolve(routes.expenseNew), { category: 'fuel', returnTo: routes.analytics });
	}

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
		<!-- Tinted percentage text fails WCAG AA; only the icon takes the direction colour. -->
		<span class="inline-flex items-center gap-1 text-xs font-medium text-foreground">
			{#if change >= 0}
				<TrendingUp class="h-3 w-3 text-chart-2" />
			{:else}
				<TrendingDown class="h-3 w-3 text-destructive" />
			{/if}
			{change > 0 ? '+' : ''}{change}%
		</span>
	{/if}
{/snippet}

{#snippet periodCard(title: string, Icon: typeof Fuel, counts: PeriodCounts, decimals: number)}
	<Card.Root>
		<Card.Content class="p-6">
			<div class="mb-4 flex items-center gap-2">
				<Icon class="h-5 w-5 text-muted-foreground" />
				<h3 class="font-semibold text-foreground">{title}</h3>
			</div>

			<div class="space-y-3 border-b pb-3">
				<div class="flex items-baseline justify-between">
					<span class="text-xs uppercase tracking-wide text-muted-foreground">This Period</span>
					<span class="text-2xl font-bold">{counts.currentYear.toFixed(decimals)}</span>
				</div>
				<div class="flex items-center justify-between">
					<span class="text-xs text-muted-foreground">Last Period</span>
					<div class="flex items-center gap-2">
						<span class="text-sm text-muted-foreground"
							>{counts.previousYear.toFixed(decimals)}</span
						>
						{@render changeBadge(counts.currentYear, counts.previousYear)}
					</div>
				</div>
			</div>

			<div class="space-y-3 pt-3">
				<div class="flex items-baseline justify-between">
					<span class="text-xs uppercase tracking-wide text-muted-foreground">This Month</span>
					<span class="text-2xl font-bold">{counts.currentMonth.toFixed(decimals)}</span>
				</div>
				<div class="flex items-center justify-between">
					<span class="text-xs text-muted-foreground">Last Month</span>
					<div class="flex items-center gap-2">
						<span class="text-sm text-muted-foreground"
							>{counts.previousMonth.toFixed(decimals)}</span
						>
						{@render changeBadge(counts.currentMonth, counts.previousMonth)}
					</div>
				</div>
			</div>
		</Card.Content>
	</Card.Root>
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
{:else if fuelStats && !hasFuelData}
	<EmptyState>
		{#snippet icon()}
			<div class="mb-4 rounded-full bg-muted p-4">
				<Fuel class="h-8 w-8 text-muted-foreground" />
			</div>
		{/snippet}
		{#snippet title()}No fuel data yet{/snippet}
		{#snippet description()}
			Log a fill-up to unlock fuel efficiency, cost, and consumption insights — your fill-up stats
			and trend charts will appear here once you have data.
		{/snippet}
		{#snippet action()}
			<Button onclick={logFillup}>
				<Fuel class="mr-2 h-4 w-4" />
				Log a Fill-up
			</Button>
		{/snippet}
	</EmptyState>
{:else if fuelStats}
	<div class="space-y-6">
		{#if showGasCards}
			<div class="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6 lg:grid-cols-3">
				{@render periodCard('Fill-ups', Fuel, fuelStats.fillups, 0)}
				{@render periodCard(volLabelLong, Droplet, fuelStats.volume, 1)}

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
		{/if}

		{#if charging && hasChargeData}
			<div class="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6 lg:grid-cols-4">
				{@render periodCard('Charging Sessions', BatteryCharging, charging.sessions, 0)}
				{@render periodCard(`Energy (${chargeLabel})`, Zap, charging.energy, 1)}

				<Card.Root>
					<Card.Content class="p-6">
						<div class="mb-4 flex items-center gap-2">
							<Gauge class="h-5 w-5 text-muted-foreground" />
							<h3 class="font-semibold text-foreground">Charging Efficiency</h3>
						</div>

						<div class="border-b pb-3 text-center">
							<span class="text-xs uppercase tracking-wide text-muted-foreground"
								>Average {electricEffLabel}</span
							>
							<p class="text-3xl font-bold">
								{charging.efficiency.avgEfficiency != null
									? charging.efficiency.avgEfficiency.toFixed(1)
									: 'N/A'}
							</p>
						</div>

						<div class="grid grid-cols-2 gap-4 pt-3">
							<div class="text-center">
								<span class="text-xs uppercase tracking-wide text-muted-foreground"
									>Best {electricEffLabel}</span
								>
								<p class="text-xl font-bold text-chart-2">
									{charging.efficiency.bestEfficiency != null
										? charging.efficiency.bestEfficiency.toFixed(1)
										: 'N/A'}
								</p>
							</div>
							<div class="text-center">
								<span class="text-xs uppercase tracking-wide text-muted-foreground"
									>Worst {electricEffLabel}</span
								>
								<p class="text-xl font-bold text-destructive">
									{charging.efficiency.worstEfficiency != null
										? charging.efficiency.worstEfficiency.toFixed(1)
										: 'N/A'}
								</p>
							</div>
						</div>
					</Card.Content>
				</Card.Root>

				<Card.Root>
					<Card.Content class="p-6">
						<div class="mb-4 flex items-center gap-2">
							<Plug class="h-5 w-5 text-muted-foreground" />
							<h3 class="font-semibold text-foreground">Charging Details</h3>
						</div>

						<div class="border-b pb-4 text-center">
							<span class="text-xs uppercase tracking-wide text-muted-foreground"
								>Average Session</span
							>
							<p class="text-3xl font-bold">
								{charging.sessionDetails.avgEnergy != null
									? charging.sessionDetails.avgEnergy.toFixed(1) + ' ' + chargeLabel
									: 'N/A'}
							</p>
						</div>

						<div class="space-y-2 pt-3">
							<div class="flex items-center justify-between text-sm">
								<span class="text-muted-foreground">Min Session</span>
								<span class="font-semibold">
									{charging.sessionDetails.minEnergy != null
										? charging.sessionDetails.minEnergy.toFixed(1) + ' ' + chargeLabel
										: 'N/A'}
								</span>
							</div>
							<div class="flex items-center justify-between text-sm">
								<span class="text-muted-foreground">Max Session</span>
								<span class="font-semibold">
									{charging.sessionDetails.maxEnergy != null
										? charging.sessionDetails.maxEnergy.toFixed(1) + ' ' + chargeLabel
										: 'N/A'}
								</span>
							</div>
							<div class="flex items-center justify-between text-sm">
								<span class="text-muted-foreground">Cost per {chargeLabel}</span>
								<span class="font-semibold">
									{charging.averageCost.perEnergyUnit != null
										? formatCurrency(charging.averageCost.perEnergyUnit, undefined, 3)
										: 'N/A'}
								</span>
							</div>
							<div class="flex items-center justify-between text-sm">
								<span class="text-muted-foreground">Cost per Session</span>
								<span class="font-semibold">
									{charging.averageCost.perSession != null
										? formatCurrency(charging.averageCost.perSession)
										: 'N/A'}
								</span>
							</div>
						</div>
					</Card.Content>
				</Card.Root>
			</div>
		{/if}

		<div class="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6 lg:grid-cols-3">
			{#if showGasCards}
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
			{/if}

			<Card.Root>
				<Card.Content class="p-6">
					<div class="mb-4 flex items-center gap-2">
						<DollarSign class="h-5 w-5 text-muted-foreground" />
						<h3 class="font-semibold text-foreground">Average Cost</h3>
					</div>

					<div class="border-b pb-4 text-center">
						<span class="text-xs uppercase tracking-wide text-muted-foreground"
							>{showGasCards ? 'Per Fill-up' : 'Per Session'}</span
						>
						<p class="text-3xl font-bold">
							{perVisitCost != null ? formatCurrency(perVisitCost) : 'N/A'}
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

		<FuelCharts {fuelStats} dayOfWeekPatterns={fuelAdvanced?.dayOfWeekPatterns} />

		{#if fuelAdvanced}
			<AdvancedCharts {fuelAdvanced} />
		{/if}
	</div>
{/if}
