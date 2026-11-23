<script lang="ts">
	import LoadErrorCard from '#lib/components/common/LoadErrorCard.svelte';
	import { userFacingErrorMessage } from '#lib/utils/error-handling.ts';
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { LoaderCircle, TrendingUp } from '@lucide/svelte';
	import type * as Chart from '#lib/components/ui/chart/index.ts';
	import { analyticsApi, getDefaultDateRange } from '#lib/services/analytics-api.ts';
	import ExpenseTrendChart from '#lib/components/charts/ExpenseTrendChart.svelte';
	import { AppBarChart, AppLineChart, AppPieChart } from '#lib/components/charts/index.ts';
	import { CHART_COLORS, buildChartConfig, buildCategoryPieData } from '#lib/utils/chart-colors.ts';
	import type {
		CrossVehicleResponse,
		FinancingResponse,
		InsuranceResponse
	} from '#lib/types/index.ts';
	import { formatCurrency, formatNumber } from '#lib/utils/formatters.ts';
	import { fitBandTickLabel, parseMonthToDate, unitTooltip } from '#lib/utils/chart-formatters.ts';
	import { settingsStore } from '#lib/stores/settings.svelte.ts';
	import { getFuelEfficiencyLabel, getDistanceUnitLabel } from '#lib/utils/units.ts';
	import FinancingAnalytics from './cross-vehicle/FinancingAnalytics.svelte';
	import InsuranceAnalytics from './cross-vehicle/InsuranceAnalytics.svelte';

	let crossVehicle = $state<CrossVehicleResponse | null>(null);
	let financing = $state<FinancingResponse | null>(null);
	let insurance = $state<InsuranceResponse | null>(null);
	let isLoading = $state(true);
	let error = $state<string | null>(null);

	let units = $derived(crossVehicle?.units ?? settingsStore.unitPreferences);
	let efficiencyLabel = $derived(getFuelEfficiencyLabel(units.distanceUnit, units.volumeUnit));
	let distShortLabel = $derived(getDistanceUnitLabel(units.distanceUnit, true));

	async function loadData() {
		try {
			isLoading = true;
			const [cv, fin, ins] = await Promise.all([
				analyticsApi.getCrossVehicle(getDefaultDateRange()),
				analyticsApi.getFinancing(),
				analyticsApi.getInsurance()
			]);
			crossVehicle = cv;
			financing = fin;
			insurance = ins;
			error = null;
		} catch (e) {
			error = userFacingErrorMessage(e);
		} finally {
			isLoading = false;
		}
	}

	onMount(() => {
		loadData();
	});

	let trendData = $derived(
		(crossVehicle?.monthlyExpenseTrends ?? []).map(d => ({
			...d,
			date: parseMonthToDate(d.month)
		}))
	);

	let appPieData = $derived(buildCategoryPieData(crossVehicle?.expenseByCategory ?? []));

	let costBarData = $derived(crossVehicle?.vehicleCostComparison ?? []);

	const costBarConfig: Chart.ChartConfig = {
		totalCost: { label: 'Total Cost', color: 'var(--chart-1)' }
	};

	const costBarSeries = [{ key: 'totalCost', label: 'Total Cost', color: 'var(--chart-1)' }];

	const costBarPadding = { top: 4, left: 48, bottom: 40, right: 4 };
	let costBarWidth = $state(0);
	let costBarTickFormat = $derived((v: string) =>
		typeof v === 'string'
			? fitBandTickLabel(
					v,
					costBarWidth - costBarPadding.left - costBarPadding.right,
					costBarData.length
				)
			: ''
	);

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

{#if isLoading && !error}
	<div class="flex justify-center p-12">
		<LoaderCircle class="h-8 w-8 animate-spin text-muted-foreground" />
	</div>
{:else if error}
	<LoadErrorCard title="Couldn't load cross-vehicle analytics" message={error} onRetry={loadData} />
{:else if crossVehicle && financing && insurance}
	<div class="space-y-4 md:space-y-6">
		{#if trendData.length > 0}
			<ExpenseTrendChart data={trendData} title="Monthly Expense Trends">
				{#snippet icon()}
					<TrendingUp class="h-5 w-5 text-primary" />
				{/snippet}
			</ExpenseTrendChart>
		{/if}

		<div class="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
			{#if appPieData.length > 0}
				<AppPieChart
					title="Expense by Category"
					description="Distribution across all vehicles"
					data={appPieData}
				/>
			{/if}

			{#if costBarData.length > 0}
				<AppBarChart
					title="Vehicle Cost Comparison"
					description="Total costs by vehicle"
					data={costBarData}
					x="vehicleName"
					y="totalCost"
					series={costBarSeries}
					config={costBarConfig}
					padding={costBarPadding}
					xAxisProps={{ ticks: costBarData.map(d => d.vehicleName), format: costBarTickFormat }}
					bind:plotWidth={costBarWidth}
				>
					{#snippet footer()}
						<div class="mt-4 space-y-2 border-t border-border pt-4">
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
					{/snippet}
				</AppBarChart>
			{/if}
		</div>

		{#if fuelEffData.length > 0}
			<AppLineChart
				title="Fuel Efficiency Comparison"
				description="{efficiencyLabel} trends across all vehicles"
				data={fuelEffData}
				x="date"
				y={fuelEffVehicleNames}
				series={fuelEffSeries}
				config={fuelEffConfig}
				yAxisFormat={v => `${formatNumber(v, 0)} ${efficiencyLabel}`}
				tooltipFormat={unitTooltip(efficiencyLabel)}
			/>
		{/if}

		<FinancingAnalytics {financing} />

		<InsuranceAnalytics {insurance} />
	</div>
{/if}
