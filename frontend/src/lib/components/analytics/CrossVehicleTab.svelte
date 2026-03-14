<script lang="ts">
	import '$lib/components/charts/pie-chart-animations.css';
	import '$lib/components/charts/bar-chart-animations.css';
	import { animateOnView } from '$lib/utils/animate-on-view';
	import { createVisibilityWatch } from '$lib/utils/visibility-watch.svelte';
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { BarChart } from 'layerchart';
	import { LoaderCircle, CircleAlert, TrendingUp } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as Chart from '$lib/components/ui/chart';
	import { analyticsApi, getDefaultDateRange } from '$lib/services/analytics-api';
	import ExpenseTrendChart from '$lib/components/charts/ExpenseTrendChart.svelte';
	import { AppLineChart, AppPieChart } from '$lib/components/charts';
	import { CHART_COLORS, buildChartConfig, buildCategoryPieData } from '$lib/utils/chart-colors';
	import type { CrossVehicleResponse, FinancingResponse, InsuranceResponse } from '$lib/types';
	import { formatCurrency } from '$lib/utils/formatters';
	import { formatCurrencyAxis, parseMonthToDate } from '$lib/utils/chart-formatters';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { getFuelEfficiencyLabel, getDistanceUnitLabel } from '$lib/utils/units';
	import FinancingAnalytics from './cross-vehicle/FinancingAnalytics.svelte';
	import InsuranceAnalytics from './cross-vehicle/InsuranceAnalytics.svelte';

	let crossVehicle = $state<CrossVehicleResponse | null>(null);
	let financing = $state<FinancingResponse | null>(null);
	let insurance = $state<InsuranceResponse | null>(null);
	let isLoading = $state(true);
	let error = $state<string | null>(null);

	// Visibility-gated rendering for inline charts that bypass ChartCard.
	let costBarGate = createVisibilityWatch();

	// Dynamic unit labels — cross-vehicle view uses global unit preferences
	let units = $derived(crossVehicle?.units ?? settingsStore.unitPreferences);
	let efficiencyLabel = $derived(getFuelEfficiencyLabel(units.distanceUnit, units.volumeUnit));
	let distShortLabel = $derived(getDistanceUnitLabel(units.distanceUnit, true));

	async function loadData() {
		try {
			isLoading = true;
			error = null;
			const [cv, fin, ins] = await Promise.all([
				analyticsApi.getCrossVehicle(getDefaultDateRange()),
				analyticsApi.getFinancing(),
				analyticsApi.getInsurance()
			]);
			crossVehicle = cv;
			financing = fin;
			insurance = ins;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load cross-vehicle data';
		} finally {
			isLoading = false;
		}
	}

	onMount(() => {
		loadData();
	});

	// --- Section 1: Monthly Expense Trends ---
	let trendData = $derived(
		(crossVehicle?.monthlyExpenseTrends ?? []).map(d => ({
			...d,
			date: parseMonthToDate(d.month)
		}))
	);

	// --- Section 2: Expense Breakdown Pie ---
	let appPieData = $derived(buildCategoryPieData(crossVehicle?.expenseByCategory ?? []));

	// --- Section 3: Vehicle Cost Comparison Bar ---
	let costBarData = $derived(crossVehicle?.vehicleCostComparison ?? []);

	const costBarConfig: Chart.ChartConfig = {
		totalCost: { label: 'Total Cost', color: 'var(--chart-1)' }
	};

	const costBarSeries = [{ key: 'totalCost', label: 'Total Cost', color: 'var(--chart-1)' }];

	// --- Section 3b: Fuel Efficiency Comparison ---
	let fuelEffVehicleNames = $derived.by(() => {
		const names = new SvelteSet<string>();
		for (const month of crossVehicle?.fuelEfficiencyComparison ?? []) {
			for (const v of month.vehicles) {
				names.add(v.vehicleName);
			}
		}
		return [...names];
	});

	let fuelEffData = $derived.by(() => {
		return (crossVehicle?.fuelEfficiencyComparison ?? []).map(d => {
			const row: Record<string, number | string | Date> = {
				month: d.month,
				date: parseMonthToDate(d.month)
			};
			for (const v of d.vehicles) {
				row[v.vehicleName] = v.efficiency;
			}
			return row;
		});
	});

	let fuelEffSeries = $derived(
		fuelEffVehicleNames.map((name, i) => ({
			key: name,
			label: name,
			color: CHART_COLORS[i % CHART_COLORS.length] ?? 'var(--chart-1)'
		}))
	);

	let fuelEffConfig = $derived(buildChartConfig(fuelEffSeries));
</script>

{#if isLoading}
	<div class="flex justify-center p-12">
		<LoaderCircle class="h-8 w-8 animate-spin text-muted-foreground" />
	</div>
{:else if error}
	<div class="rounded-lg border bg-card p-6">
		<div class="flex items-center gap-3 text-destructive mb-4">
			<CircleAlert class="h-5 w-5" />
			<p class="font-medium">Failed to load cross-vehicle analytics</p>
		</div>
		<p class="text-sm text-muted-foreground mb-4">{error}</p>
		<Button onclick={loadData}>Retry</Button>
	</div>
{:else if crossVehicle && financing && insurance}
	<div class="space-y-4 md:space-y-6">
		<!-- Section 1: Monthly Expense Trends -->
		{#if trendData.length > 0}
			<ExpenseTrendChart data={trendData} title="Monthly Expense Trends">
				{#snippet icon()}
					<TrendingUp class="h-5 w-5 text-primary" />
				{/snippet}
			</ExpenseTrendChart>
		{/if}

		<!-- Section 2: Expense by Category + Vehicle Cost Comparison (2-col grid) -->
		<div class="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
			<!-- Expense by Category -->
			{#if appPieData.length > 0}
				<AppPieChart
					title="Expense by Category"
					description="Distribution across all vehicles"
					data={appPieData}
				/>
			{/if}

			<!-- Vehicle Cost Comparison (kept manual — has cost-per-mile list) -->
			{#if costBarData.length > 0}
				<Card.Root class="p-4 sm:p-6">
					<div class="space-y-4">
						<div>
							<h3 class="font-semibold text-sm sm:text-base">Vehicle Cost Comparison</h3>
							<p class="text-xs sm:text-sm text-muted-foreground">Total costs by vehicle</p>
						</div>
						<div class="chart-bar-animate-ready" use:animateOnView={'chart-bar-animated'}>
							<div bind:this={costBarGate.el} style="min-height: 250px">
								{#if costBarGate.visible}
									<Chart.Container config={costBarConfig} class="h-[250px] sm:h-[300px] w-full">
										<BarChart
											data={costBarData}
											x="vehicleName"
											y="totalCost"
											series={costBarSeries}
											padding={{ top: 4, left: 48, bottom: 40, right: 4 }}
											props={{
												bars: { stroke: 'none' },
												xAxis: {
													ticks: costBarData.map(d => d.vehicleName),
													format: (v: string) => {
														if (typeof v !== 'string') return '';
														return v.length > 20 ? v.slice(0, 18) + '…' : v;
													}
												},
												yAxis: { format: formatCurrencyAxis }
											}}
										>
											{#snippet tooltip()}
												<Chart.Tooltip hideLabel />
											{/snippet}
										</BarChart>
									</Chart.Container>
								{/if}
							</div>
						</div>
						<div class="space-y-2 pt-4 border-t border-border">
							{#each costBarData as vehicle (vehicle.vehicleId)}
								<div class="flex items-center justify-between text-sm">
									<span>{vehicle.vehicleName}</span>
									<span class="font-semibold">
										{vehicle.costPerDistance != null
											? `${formatCurrency(vehicle.costPerDistance)}/${distShortLabel}`
											: 'N/A'}
									</span>
								</div>
							{/each}
						</div>
					</div>
				</Card.Root>
			{/if}
		</div>

		<!-- Section 3: Fuel Efficiency Comparison -->
		{#if fuelEffData.length > 0}
			<AppLineChart
				title="Fuel Efficiency Comparison"
				description="{efficiencyLabel} trends across all vehicles"
				data={fuelEffData}
				x="date"
				y={fuelEffVehicleNames}
				series={fuelEffSeries}
				config={fuelEffConfig}
				yAxisFormat={v => `${v.toFixed(0)} ${efficiencyLabel}`}
			/>
		{/if}

		<!-- Section 4: Financing Overview (extracted) -->
		<FinancingAnalytics {financing} />

		<!-- Section 5: Insurance Overview (extracted) -->
		<InsuranceAnalytics {insurance} />
	</div>
{/if}
