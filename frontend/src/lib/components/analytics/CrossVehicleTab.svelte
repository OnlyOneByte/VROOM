<script lang="ts">
	import LoadErrorCard from '#lib/components/common/LoadErrorCard.svelte';
	import { userFacingErrorMessage } from '#lib/utils/error-handling.ts';
	import { SvelteMap } from 'svelte/reactivity';
	import { LoaderCircle, SearchX, TrendingUp } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import EmptyState from '#lib/components/common/empty-state.svelte';
	import type * as Chart from '#lib/components/ui/chart/index.ts';
	import { analyticsApi, getDefaultDateRange } from '#lib/services/analytics-api.ts';
	import type { AnalyticsDateRange } from './analytics-filters';
	import ExpenseTrendChart from '#lib/components/charts/ExpenseTrendChart.svelte';
	import { AppBarChart, AppLineChart } from '#lib/components/charts/index.ts';
	import {
		buildChartConfig,
		buildCategoryPieData,
		buildVehicleColorMap
	} from '#lib/utils/chart-colors.ts';
	import type {
		AnalyticsQueryResponse,
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
	import CrossVehicleOverview from './cross-vehicle/CrossVehicleOverview.svelte';
	import ChartGroup from './fuel/ChartGroup.svelte';
	import {
		carValues,
		categoryMatrix,
		crossHero,
		overviewRequests
	} from './cross-vehicle/cross-overview';

	interface Props {
		dateRange?: AnalyticsDateRange;
		vehicleIds?: string[];
		vehicleColors?: Record<string, string>;
		filterLabel?: string;
		onClearFilters?: () => void;
		rangeText?: string;
		hiddenFinancials?: ReadonlySet<string>;
	}

	let {
		dateRange = getDefaultDateRange(),
		vehicleIds,
		vehicleColors,
		filterLabel,
		onClearFilters,
		rangeText = 'Last 12 months',
		hiddenFinancials = new Set<string>()
	}: Props = $props();

	let runningCost = $state<AnalyticsQueryResponse | null>(null);
	let allInCost = $state<AnalyticsQueryResponse | null>(null);
	let byCategory = $state<Array<AnalyticsQueryResponse | null>>([]);

	let crossVehicle = $state<CrossVehicleResponse | null>(null);
	let request = 0;
	let financing = $state<FinancingResponse | null>(null);
	let insurance = $state<InsuranceResponse | null>(null);
	let isLoading = $state(true);
	let error = $state<string | null>(null);

	let units = $derived(crossVehicle?.units ?? settingsStore.unitPreferences);
	let efficiencyLabel = $derived(getFuelEfficiencyLabel(units.distanceUnit, units.volumeUnit));
	let distShortLabel = $derived(getDistanceUnitLabel(units.distanceUnit, true));

	let lifetime: { key: string; data: ReturnType<typeof loadLifetime> } | null = null;

	function loadLifetime(overview: ReturnType<typeof overviewRequests>) {
		return Promise.all([
			analyticsApi.getFinancing({ vehicleIds }),
			analyticsApi.getInsurance({ vehicleIds }),
			...[overview.allIn, ...overview.categories].map(params =>
				analyticsApi.query(params).catch(() => null)
			)
		]);
	}

	async function loadData() {
		const current = ++request;
		try {
			isLoading = true;
			const overview = overviewRequests(dateRange, vehicleIds);
			const key = JSON.stringify(vehicleIds ?? null);
			if (lifetime?.key !== key) {
				const entry = { key, data: loadLifetime(overview) };
				const drop = () => {
					if (lifetime === entry) lifetime = null;
				};
				entry.data.then(results => results.includes(null) && drop(), drop);
				lifetime = entry;
			}
			const [cv, running, [fin, ins, allIn, ...categories]] = await Promise.all([
				analyticsApi.getCrossVehicle({ ...dateRange, vehicleIds }),
				analyticsApi.query(overview.running).catch(() => null),
				lifetime.data
			]);
			if (current !== request) return;
			crossVehicle = cv;
			financing = fin;
			insurance = ins;
			runningCost = running ?? null;
			allInCost = allIn ?? null;
			byCategory = categories;
			error = null;
		} catch (e) {
			if (current !== request) return;
			error = userFacingErrorMessage(e);
		} finally {
			if (current === request) isLoading = false;
		}
	}

	$effect(() => {
		void dateRange.startDate;
		void dateRange.endDate;
		void vehicleIds;
		void loadData();
	});

	let trendData = $derived(
		(crossVehicle?.monthlyExpenseTrends ?? []).map(d => ({
			...d,
			date: parseMonthToDate(d.month)
		}))
	);

	let running = $derived(carValues(runningCost));
	let allIn = $derived(carValues(allInCost, hiddenFinancials));
	let matrix = $derived(categoryMatrix(byCategory, hiddenFinancials));
	let hero = $derived(crossHero(running, allIn, byCategory, hiddenFinancials));

	let categoryRows = $derived(
		buildCategoryPieData(crossVehicle?.expenseByCategory ?? []).sort((a, b) => b.value - a.value)
	);
	const categorySeries = [{ key: 'value', label: 'Spent', color: 'var(--chart-1)' }];
	const categoryConfig: Chart.ChartConfig = { value: { label: 'Spent', color: 'var(--chart-1)' } };

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

	let fuelEffVehicles = $derived.by(() => {
		const byId = new SvelteMap<string, string>();
		for (const month of crossVehicle?.fuelEfficiencyComparison ?? []) {
			for (const v of month.vehicles) {
				byId.set(v.vehicleId, v.vehicleName);
			}
		}
		return [...byId];
	});
	let fuelEffVehicleIds = $derived(fuelEffVehicles.map(([id]) => id));

	let fuelEffData = $derived.by(() => {
		return (crossVehicle?.fuelEfficiencyComparison ?? []).map(d => {
			const row: Record<string, number | string | Date> = {
				month: d.month,
				date: parseMonthToDate(d.month)
			};
			for (const v of d.vehicles) {
				row[v.vehicleId] = v.efficiency;
			}
			return row;
		});
	});

	let fuelEffFallbackColors = $derived(buildVehicleColorMap(fuelEffVehicleIds));

	let fuelEffSeries = $derived(
		fuelEffVehicles.map(([id, name]) => ({
			key: id,
			label: name,
			color: vehicleColors?.[id] ?? (fuelEffFallbackColors[id] as string)
		}))
	);

	let hasExpenses = $derived((crossVehicle?.monthlyExpenseTrends.length ?? 0) > 0);

	let fuelEffConfig = $derived(buildChartConfig(fuelEffSeries));

	let hasDetail = $derived(
		trendData.length > 0 ||
			categoryRows.length > 0 ||
			(costBarData.length > 0 && hasExpenses) ||
			fuelEffData.length > 0
	);
</script>

{#if isLoading && !error}
	<div class="flex justify-center p-12">
		<LoaderCircle class="h-8 w-8 animate-spin text-muted-foreground" />
	</div>
{:else if error}
	<LoadErrorCard title="Couldn't load cross-vehicle analytics" message={error} onRetry={loadData} />
{:else if crossVehicle && financing && insurance}
	<div class="space-y-4 md:space-y-6">
		{#if !hasExpenses && filterLabel && onClearFilters}
			<EmptyState level={2}>
				{#snippet icon()}
					<div class="mb-4 rounded-full bg-muted p-4">
						<SearchX class="h-8 w-8 text-muted-foreground" aria-hidden="true" />
					</div>
				{/snippet}
				{#snippet title()}No expenses for {filterLabel}{/snippet}
				{#snippet description()}
					Try a longer date range or more cars. Loans and insurance below show what is in force
					today.
				{/snippet}
				{#snippet action()}
					<Button variant="outline" onclick={onClearFilters}>Clear filters</Button>
				{/snippet}
			</EmptyState>
		{/if}
		<CrossVehicleOverview
			{hero}
			{running}
			{allIn}
			{matrix}
			{vehicleColors}
			{rangeText}
			distanceUnit={distShortLabel}
		/>

		{#if hasDetail}
			<ChartGroup
				title="More detail"
				description="Monthly spending, spending by category, totals per car and fuel economy"
			>
				<div class="space-y-4 md:space-y-6">
					{#if trendData.length > 0}
						<ExpenseTrendChart level={3} data={trendData} title="Monthly Expense Trends">
							{#snippet icon()}
								<TrendingUp class="h-5 w-5 text-primary" />
							{/snippet}
						</ExpenseTrendChart>
					{/if}

					<div class="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
						{#if categoryRows.length > 0}
							<AppBarChart
								level={3}
								title="Expense by Category"
								description="Spending across all vehicles"
								data={categoryRows}
								x="value"
								y="label"
								orientation="horizontal"
								series={categorySeries}
								config={categoryConfig}
								height={Math.max(160, categoryRows.length * 44)}
								padding={{ top: 4, left: 112, bottom: 24, right: 16 }}
								xAxisProps={{ format: (v: number) => formatCurrency(v, undefined, 0), ticks: 4 }}
								yAxisFormat={v => String(v)}
								tooltipFormat={v => formatCurrency(Number(v))}
							/>
						{/if}

						{#if costBarData.length > 0 && hasExpenses}
							<AppBarChart
								level={3}
								title="Vehicle Cost Comparison"
								description="Total costs by vehicle"
								data={costBarData}
								x="vehicleName"
								y="totalCost"
								series={costBarSeries}
								config={costBarConfig}
								padding={costBarPadding}
								xAxisProps={{
									ticks: costBarData.map(d => d.vehicleName),
									format: costBarTickFormat
								}}
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
							level={3}
							title="Fuel Efficiency Comparison"
							description="{efficiencyLabel} trends across all vehicles"
							data={fuelEffData}
							x="date"
							y={fuelEffVehicleIds}
							series={fuelEffSeries}
							config={fuelEffConfig}
							yAxisFormat={v => `${formatNumber(v, 0)} ${efficiencyLabel}`}
							tooltipFormat={unitTooltip(efficiencyLabel)}
						/>
					{/if}
				</div>
			</ChartGroup>
		{/if}

		<FinancingAnalytics {financing} />

		<InsuranceAnalytics {insurance} />
	</div>
{/if}
