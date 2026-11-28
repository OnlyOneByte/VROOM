<script lang="ts">
	import LoadErrorCard from '#lib/components/common/LoadErrorCard.svelte';
	import { userFacingErrorMessage } from '#lib/utils/error-handling.ts';
	import { onMount } from 'svelte';
	import {
		LoaderCircle,
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
	import { expenseApi } from '#lib/services/expense-api.ts';
	import type {
		AnalyticsQueryCoverage,
		FuelStatsResponse,
		FuelAdvancedResponse,
		PeriodCounts
	} from '#lib/types/index.ts';
	import { formatCurrency, formatNumber, formatNumberUpTo } from '#lib/utils/formatters.ts';
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
	import ChartGroup from './ChartGroup.svelte';
	import FuelOverview from './FuelOverview.svelte';
	import SharedCurrencyNote from '../SharedCurrencyNote.svelte';
	import StatCardGrid from '#lib/components/charts/StatCardGrid.svelte';
	import type { StatCardChange } from '#lib/components/charts/StatCard.svelte';
	import { buildVehicleColorMap } from '#lib/utils/chart-colors.ts';
	import type { AnalyticsDateRange } from '../analytics-filters';

	let {
		fuelStats: fuelStatsProp = null,
		fuelAdvanced: fuelAdvancedProp = null,
		vehicleColors: vehicleColorsProp,
		filterLabel,
		onClearFilters,
		previousPeriodLabel = 'vs the 12 months before',
		dateRange,
		vehicleIds,
		rangeText = 'Last 12 months',
		coverage
	}: {
		rangeText?: string;
		coverage?: AnalyticsQueryCoverage;
		fuelStats?: FuelStatsResponse | null;
		fuelAdvanced?: FuelAdvancedResponse | null;
		vehicleColors?: Record<string, string>;
		filterLabel?: string;
		onClearFilters?: () => void;
		previousPeriodLabel?: string;
		dateRange?: AnalyticsDateRange;
		vehicleIds?: string[];
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

	let vehicleColors = $derived.by(() => {
		const rows = [
			...(fuelStats?.fillupCostByVehicle ?? []),
			...(fuelStats?.odometerProgression ?? []),
			...(fuelStats?.costPerDistance ?? []),
			...(fuelAdvanced?.vehicleRadar ?? [])
		];
		const fallback = buildVehicleColorMap(rows.map(r => r.vehicleId));
		return Object.fromEntries(
			Object.keys(fallback).map(id => [id, vehicleColorsProp?.[id] ?? (fallback[id] as string)])
		);
	});

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

	function spreadTone(best: number | null, worst: number | null, tone: string): string {
		if (best == null || worst == null) return 'text-foreground';
		return formatNumber(best, 1) === formatNumber(worst, 1) ? 'text-foreground' : tone;
	}

	let costPerDistance = $derived(fuelStats?.averageCost.costPerDistance ?? null);
	let monthlySpend = $derived.by(() => {
		const spend = fuelStats?.monthlySpend;
		const fuel = spend?.fuel ?? null;
		const charging = spend?.charging ?? null;
		const over = spend ? `${spend.months} ${spend.months === 1 ? 'month' : 'months'}` : null;
		const prev = fuelStats?.previous?.monthlySpend;
		if (fuel != null && charging != null) {
			return {
				label: 'Fuel & charging spend per month',
				value: fuel + charging,
				previous: prev ? (prev.fuel ?? 0) + (prev.charging ?? 0) : null,
				subtitle: `Fuel ${formatCurrency(fuel)}, charging ${formatCurrency(charging)}, over ${over}`
			};
		}
		return {
			label:
				charging != null || !showGasCards ? 'Charging spend per month' : 'Fuel spend per month',
			value: fuel ?? charging,
			previous: (fuel != null ? prev?.fuel : prev?.charging) ?? null,
			subtitle: over ? `Averaged over ${over}` : undefined
		};
	});
	let summaryEfficiency = $derived(
		showGasCards
			? (fuelStats?.fuelConsumption.avgEfficiency ?? null)
			: (charging?.efficiency.avgEfficiency ?? null)
	);
	let previousEfficiency = $derived(
		showGasCards
			? (fuelStats?.previous?.avgEfficiency ?? null)
			: (fuelStats?.previous?.chargeAvgEfficiency ?? null)
	);

	function tileChange(
		current: number | null,
		previous: number | null | undefined,
		goodWhen: 'up' | 'down'
	): StatCardChange | null {
		if (current == null || previous == null) return null;
		const percent = pctChange(current, previous);
		return percent == null ? null : { percent, goodWhen, label: previousPeriodLabel };
	}

	let summaryItems = $derived([
		{
			label: `${showGasCards ? 'Fuel' : 'Charging'} cost per ${distLabelShort}`,
			value: costPerDistance != null ? formatCurrency(costPerDistance) : 'N/A',
			change: tileChange(costPerDistance, fuelStats?.previous?.costPerDistance, 'down'),
			icon: DollarSign,
			iconColor: 'chart-1'
		},
		{
			label: monthlySpend.label,
			value: monthlySpend.value != null ? formatCurrency(monthlySpend.value) : 'N/A',
			subtitle: monthlySpend.subtitle,
			change: tileChange(monthlySpend.value, monthlySpend.previous, 'down'),
			icon: Fuel,
			iconColor: 'chart-3'
		},
		{
			label: `Average ${showGasCards ? effLabel : electricEffLabel}`,
			value: summaryEfficiency != null ? formatNumber(summaryEfficiency, 1) : 'N/A',
			change: tileChange(summaryEfficiency, previousEfficiency, 'up'),
			icon: Gauge,
			iconColor: 'chart-2'
		}
	]);

	let hasFuelData = $derived(
		!!fuelStats &&
			(fuelStats.fillups.currentYear > 0 ||
				fuelStats.fillups.previousYear > 0 ||
				fuelStats.distance.totalDistance > 0 ||
				hasChargeData)
	);

	let hasOlderFuel = $state<boolean | null>(null);
	let filteredEmpty = $derived(!!fuelStats && !hasFuelData && !!filterLabel && !!onClearFilters);
	let checkingFuelHistory = $derived(
		!!fuelStats && !hasFuelData && !filteredEmpty && hasOlderFuel === null
	);

	$effect(() => {
		if (checkingFuelHistory) void checkFuelHistory();
	});

	async function checkFuelHistory() {
		try {
			const result = await expenseApi.getAllExpenses({ category: 'fuel', limit: 1 });
			hasOlderFuel = result.pagination.totalCount > 0;
		} catch {
			hasOlderFuel = true;
		}
	}

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
			const range = { ...(dateRange ?? getDefaultDateRange()), vehicleIds };
			const [stats, advanced] = await Promise.all([
				analyticsApi.getFuelStats(range),
				analyticsApi.getFuelAdvanced(range)
			]);
			localFuelStats = stats;
			localFuelAdvanced = advanced;
			error = null;
		} catch (e) {
			error = userFacingErrorMessage(e);
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
				<h4 class="font-semibold text-foreground">{title}</h4>
			</div>

			<div class="space-y-3 border-b pb-3">
				<div class="flex items-baseline justify-between">
					<span class="text-xs text-muted-foreground">This period</span>
					<span class="text-2xl font-bold">{formatNumber(counts.currentYear, decimals)}</span>
				</div>
				{#if counts.previousYear > 0}
					<div class="flex items-center justify-between">
						<span class="text-xs text-muted-foreground">Last period</span>
						<div class="flex items-center gap-2">
							<span class="text-sm text-muted-foreground">
								{formatNumber(counts.previousYear, decimals)}
							</span>
							{@render changeBadge(counts.currentYear, counts.previousYear)}
						</div>
					</div>
				{/if}
			</div>

			<div class="space-y-3 pt-3">
				<div class="flex items-baseline justify-between">
					<span class="text-xs text-muted-foreground">This month</span>
					<span class="text-2xl font-bold">{formatNumber(counts.currentMonth, decimals)}</span>
				</div>
				<div class="flex items-center justify-between">
					<span class="text-xs text-muted-foreground">Last month</span>
					<div class="flex items-center gap-2">
						<span class="text-sm text-muted-foreground">
							{formatNumber(counts.previousMonth, decimals)}
						</span>
						{@render changeBadge(counts.currentMonth, counts.previousMonth)}
					</div>
				</div>
			</div>
		</Card.Content>
	</Card.Root>
{/snippet}

{#if !isLoading && !error && !checkingFuelHistory}
	<SharedCurrencyNote {coverage} class="mb-4" />
{/if}

{#if (isLoading && !error) || checkingFuelHistory}
	<div class="flex justify-center p-12">
		<LoaderCircle class="h-8 w-8 animate-spin text-muted-foreground" />
	</div>
{:else if error}
	<LoadErrorCard title="Couldn't load fuel statistics" message={error} onRetry={loadData} />
{:else if filteredEmpty}
	<EmptyState level={3}>
		{#snippet icon()}
			<div class="mb-4 rounded-full bg-muted p-4">
				<Fuel class="h-8 w-8 text-muted-foreground" aria-hidden="true" />
			</div>
		{/snippet}
		{#snippet title()}No fill-ups or charging for {filterLabel}{/snippet}
		{#snippet description()}
			Try a longer date range or more cars. Your other fill-ups are still in your expenses.
		{/snippet}
		{#snippet action()}
			<Button variant="outline" size="lg" onclick={onClearFilters}>Clear filters</Button>
		{/snippet}
	</EmptyState>
{:else if fuelStats && !hasFuelData}
	<EmptyState>
		{#snippet icon()}
			<div class="mb-4 rounded-full bg-muted p-4">
				<Fuel class="h-8 w-8 text-muted-foreground" />
			</div>
		{/snippet}
		{#snippet title()}
			{#if hasOlderFuel}
				No fill-ups in the last 12 months
			{:else}
				No fuel data yet
			{/if}
		{/snippet}
		{#snippet description()}
			{#if hasOlderFuel}
				Fuel and charging stats cover the last 12 months. Any older fill-ups or charging sessions
				are still in your expenses.
			{:else}
				Log a fill-up to unlock fuel efficiency, cost, and consumption insights — your fill-up stats
				and trend charts will appear here once you have data.
			{/if}
		{/snippet}
		{#snippet action()}
			{#if hasOlderFuel}
				<div class="flex flex-col gap-3 sm:flex-row">
					<Button variant="outline" size="lg" href={resolve(routes.expenses)}>View expenses</Button>
					<Button size="lg" onclick={logFillup}>
						<Fuel class="mr-2 h-4 w-4" />
						Log a fill-up
					</Button>
				</div>
			{:else}
				<Button size="lg" onclick={logFillup}>
					<Fuel class="mr-2 h-4 w-4" />
					Log a fill-up
				</Button>
			{/if}
		{/snippet}
	</EmptyState>
{:else if fuelStats}
	<div class="space-y-6">
		<FuelOverview
			{fuelStats}
			{fuelAdvanced}
			{vehicleColors}
			{rangeText}
			volumeUnit={volLabelShort}
			volumeLabel={volLabelLong}
			chargeUnit={chargeLabel}
			efficiencyUnit={effLabel}
			electricEfficiencyUnit={electricEffLabel}
			showCharging={hasChargeData}
		/>
		<ChartGroup
			title="More detail"
			description="Spending tiles, price and cost charts, fill-up details, patterns and comparisons"
		>
			<div class="space-y-6">
				<StatCardGrid items={summaryItems} columns={3} />

				<FuelCharts
					{fuelStats}
					dayOfWeekPatterns={fuelAdvanced?.dayOfWeekPatterns}
					showGasCharts={showGasCards}
					{vehicleColors}
					group="primary"
				/>

				<ChartGroup
					level={3}
					title="Fill-up details"
					description="Counts, volume, efficiency, cost and distance for the last 12 months"
				>
					<div class="space-y-6">
						{#if showGasCards}
							<div class="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6 lg:grid-cols-3">
								{@render periodCard('Fill-ups', Fuel, fuelStats.fillups, 0)}
								{@render periodCard(volLabelLong, Droplet, fuelStats.volume, 1)}

								<Card.Root>
									<Card.Content class="p-6">
										<div class="mb-4 flex items-center gap-2">
											<Gauge class="h-5 w-5 text-muted-foreground" />
											<h4 class="font-semibold text-foreground">Fuel consumption</h4>
										</div>

										<div class="border-b pb-3 text-center">
											<span class="text-xs text-muted-foreground">
												Average {effLabel}
											</span>
											<p class="text-3xl font-bold">
												{fuelStats.fuelConsumption.avgEfficiency != null
													? formatNumber(fuelStats.fuelConsumption.avgEfficiency, 1)
													: 'N/A'}
											</p>
										</div>

										<div class="grid grid-cols-2 gap-4 pt-3">
											<div class="text-center">
												<span class="text-xs text-muted-foreground">
													Best {effLabel}
												</span>
												<p
													class="text-xl font-bold {spreadTone(
														fuelStats.fuelConsumption.bestEfficiency,
														fuelStats.fuelConsumption.worstEfficiency,
														'text-chart-2'
													)}"
												>
													{fuelStats.fuelConsumption.bestEfficiency != null
														? formatNumber(fuelStats.fuelConsumption.bestEfficiency, 1)
														: 'N/A'}
												</p>
											</div>
											<div class="text-center">
												<span class="text-xs text-muted-foreground">
													Worst {effLabel}
												</span>
												<p
													class="text-xl font-bold {spreadTone(
														fuelStats.fuelConsumption.bestEfficiency,
														fuelStats.fuelConsumption.worstEfficiency,
														'text-destructive'
													)}"
												>
													{fuelStats.fuelConsumption.worstEfficiency != null
														? formatNumber(fuelStats.fuelConsumption.worstEfficiency, 1)
														: 'N/A'}
												</p>
											</div>
										</div>
									</Card.Content>
								</Card.Root>
							</div>
						{/if}

						{#if charging && hasChargeData}
							<div class="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6 xl:grid-cols-4">
								{@render periodCard('Charging sessions', BatteryCharging, charging.sessions, 0)}
								{@render periodCard(`Energy (${chargeLabel})`, Zap, charging.energy, 1)}

								<Card.Root>
									<Card.Content class="p-6">
										<div class="mb-4 flex items-center gap-2">
											<Gauge class="h-5 w-5 text-muted-foreground" />
											<h4 class="font-semibold text-foreground">Charging efficiency</h4>
										</div>

										<div class="border-b pb-3 text-center">
											<span class="text-xs text-muted-foreground">
												Average {electricEffLabel}
											</span>
											<p class="text-3xl font-bold">
												{charging.efficiency.avgEfficiency != null
													? formatNumber(charging.efficiency.avgEfficiency, 1)
													: 'N/A'}
											</p>
										</div>

										<div class="grid grid-cols-2 gap-4 pt-3">
											<div class="text-center">
												<span class="text-xs text-muted-foreground">
													Best {electricEffLabel}
												</span>
												<p
													class="text-xl font-bold {spreadTone(
														charging.efficiency.bestEfficiency,
														charging.efficiency.worstEfficiency,
														'text-chart-2'
													)}"
												>
													{charging.efficiency.bestEfficiency != null
														? formatNumber(charging.efficiency.bestEfficiency, 1)
														: 'N/A'}
												</p>
											</div>
											<div class="text-center">
												<span class="text-xs text-muted-foreground">
													Worst {electricEffLabel}
												</span>
												<p
													class="text-xl font-bold {spreadTone(
														charging.efficiency.bestEfficiency,
														charging.efficiency.worstEfficiency,
														'text-destructive'
													)}"
												>
													{charging.efficiency.worstEfficiency != null
														? formatNumber(charging.efficiency.worstEfficiency, 1)
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
											<h4 class="font-semibold text-foreground">Charging details</h4>
										</div>

										<div class="border-b pb-4 text-center">
											<span class="text-xs text-muted-foreground"> Average session </span>
											<p class="text-3xl font-bold">
												{charging.sessionDetails.avgEnergy != null
													? formatNumber(charging.sessionDetails.avgEnergy, 1) + ' ' + chargeLabel
													: 'N/A'}
											</p>
										</div>

										<div class="space-y-2 pt-3">
											<div class="flex items-center justify-between text-sm">
												<span class="text-muted-foreground">Min session</span>
												<span class="font-semibold">
													{charging.sessionDetails.minEnergy != null
														? formatNumber(charging.sessionDetails.minEnergy, 1) + ' ' + chargeLabel
														: 'N/A'}
												</span>
											</div>
											<div class="flex items-center justify-between text-sm">
												<span class="text-muted-foreground">Max session</span>
												<span class="font-semibold">
													{charging.sessionDetails.maxEnergy != null
														? formatNumber(charging.sessionDetails.maxEnergy, 1) + ' ' + chargeLabel
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
												<span class="text-muted-foreground">Cost per session</span>
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
											<h4 class="font-semibold text-foreground">Fill-up Details</h4>
										</div>

										<div class="border-b pb-4 text-center">
											<span class="text-xs text-muted-foreground"> Average fill-up </span>
											<p class="text-3xl font-bold">
												{fuelStats.fillupDetails.avgVolume != null
													? formatNumber(fuelStats.fillupDetails.avgVolume, 1) + ' ' + volLabelShort
													: 'N/A'}
											</p>
										</div>

										<div class="space-y-2 pt-3">
											<div class="flex items-center justify-between text-sm">
												<span class="text-muted-foreground">Min fill-up</span>
												<span class="font-semibold">
													{fuelStats.fillupDetails.minVolume != null
														? formatNumber(fuelStats.fillupDetails.minVolume, 1) +
															' ' +
															volLabelShort
														: 'N/A'}
												</span>
											</div>
											<div class="flex items-center justify-between text-sm">
												<span class="text-muted-foreground">Max fill-up</span>
												<span class="font-semibold">
													{fuelStats.fillupDetails.maxVolume != null
														? formatNumber(fuelStats.fillupDetails.maxVolume, 1) +
															' ' +
															volLabelShort
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
										<h4 class="font-semibold text-foreground">Average cost</h4>
									</div>

									<div class="border-b pb-4 text-center">
										<span class="text-xs text-muted-foreground">
											{showGasCards ? 'Per fill-up' : 'Per session'}
										</span>
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
												<span class="text-muted-foreground">Avg cost/day</span>
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
										<h4 class="font-semibold text-foreground">Distance with VROOM</h4>
									</div>

									<div class="border-b pb-4 text-center">
										<span class="text-xs text-muted-foreground"> Total distance </span>
										<p class="text-3xl font-bold">
											{formatNumberUpTo(fuelStats.distance.totalDistance, 1)}
											{distLabelShort}
										</p>
									</div>

									<div class="space-y-2 pt-3">
										<div class="flex items-center justify-between text-sm">
											<span class="text-muted-foreground">Avg/day</span>
											<span class="font-semibold">
												{fuelStats.distance.avgPerDay != null
													? formatNumber(fuelStats.distance.avgPerDay, 1) + ' ' + distLabelShort
													: 'N/A'}
											</span>
										</div>
										<div class="flex items-center justify-between text-sm">
											<span class="text-muted-foreground">Avg/month</span>
											<span class="font-semibold">
												{fuelStats.distance.avgPerMonth != null
													? formatNumber(fuelStats.distance.avgPerMonth, 0) + ' ' + distLabelShort
													: 'N/A'}
											</span>
										</div>
									</div>
								</Card.Content>
							</Card.Root>
						</div>
					</div>
				</ChartGroup>

				{#if showGasCards || fuelAdvanced}
					<ChartGroup
						level={3}
						title="Patterns"
						description="When you fill up: by day of the week, by season and how often"
					>
						<div class="space-y-4 md:space-y-6">
							<FuelCharts
								{fuelStats}
								dayOfWeekPatterns={fuelAdvanced?.dayOfWeekPatterns}
								showGasCharts={showGasCards}
								{vehicleColors}
								group="patterns"
							/>
							{#if fuelAdvanced}
								<AdvancedCharts {fuelAdvanced} {vehicleColors} group="patterns" />
							{/if}
						</div>
					</ChartGroup>
				{/if}

				<ChartGroup
					level={3}
					title="Comparisons"
					description="Your vehicles side by side: cost per distance, odometer, performance and spending"
				>
					<div class="space-y-4 md:space-y-6">
						<FuelCharts
							{fuelStats}
							showGasCharts={showGasCards}
							{vehicleColors}
							group="comparisons"
						/>
						{#if fuelAdvanced}
							<AdvancedCharts {fuelAdvanced} {vehicleColors} group="comparisons" />
						{/if}
					</div>
				</ChartGroup>
			</div>
		</ChartGroup>
	</div>
{/if}
