<script lang="ts">
	import { onMount } from 'svelte';
	import {
		LoaderCircle,
		CircleAlert,
		TrendingUp,
		TrendingDown,
		Award,
		Calendar,
		DollarSign,
		Fuel,
		Wrench
	} from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as Select from '$lib/components/ui/select';
	import { AppLineChart, AppPieChart, StatCardGrid } from '$lib/components/charts';
	import { buildCategoryPieData, buildChartConfig } from '$lib/utils/chart-colors';
	import { analyticsApi } from '$lib/services/analytics-api';
	import type { YearEndResponse } from '$lib/types';
	import { formatCurrency } from '$lib/utils/formatters';
	import { formatDecimalAxis, parseMonthToDate } from '$lib/utils/chart-formatters';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import {
		getFuelEfficiencyLabel,
		getDistanceUnitLabel,
		getCostPerDistanceLabel
	} from '$lib/utils/units';

	const currentYear = new Date().getFullYear();
	const years = Array.from({ length: 5 }, (_, i) => currentYear - i);

	let selectedYear = $state(currentYear);
	let yearEnd = $state<YearEndResponse | null>(null);
	let isLoading = $state(true);
	let error = $state<string | null>(null);

	async function loadData(year: number) {
		try {
			isLoading = true;
			error = null;
			yearEnd = await analyticsApi.getYearEnd({ year });
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load year-end summary';
		} finally {
			isLoading = false;
		}
	}

	function handleYearChange(value: string | undefined) {
		if (value) {
			const year = Number.parseInt(value, 10);
			selectedYear = year;
			loadData(year);
		}
	}

	onMount(() => {
		loadData(selectedYear);
	});

	// Dynamic unit labels — year-end view uses global unit preferences
	let units = $derived(yearEnd?.units ?? settingsStore.unitPreferences);
	let efficiencyLabel = $derived(getFuelEfficiencyLabel(units.distanceUnit, units.volumeUnit));
	let costPerDistLabel = $derived(getCostPerDistanceLabel(units.distanceUnit));
	let distLongLabel = $derived(getDistanceUnitLabel(units.distanceUnit));

	// --- Category Breakdown Pie ---
	let pieData = $derived(buildCategoryPieData(yearEnd?.categoryBreakdown ?? []));

	// --- Efficiency Trend Line ---
	let effTrendData = $derived(
		(yearEnd?.efficiencyTrend ?? []).map(d => ({ ...d, date: parseMonthToDate(d.month) }))
	);

	let effTrendSeries = $derived([
		{ key: 'efficiency', label: efficiencyLabel, color: 'var(--chart-1)' }
	]);
	let effTrendConfig = $derived(buildChartConfig(effTrendSeries));

	// --- Key Metrics ---
</script>

<div class="space-y-6">
	<!-- Gradient Header Card with Year Selector -->
	<Card.Root class="bg-gradient-to-br from-primary/5 to-chart-3/5">
		<Card.Content class="p-4 sm:p-6">
			<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
				<div class="flex items-center gap-2 sm:gap-3">
					<Award class="h-6 w-6 sm:h-8 sm:w-8 text-primary" />
					<div>
						<h2 class="text-xl sm:text-2xl font-bold">{selectedYear} Annual Report Card</h2>
						<p class="text-sm sm:text-base text-muted-foreground">Your complete year in review</p>
					</div>
				</div>
				<Select.Root type="single" value={String(selectedYear)} onValueChange={handleYearChange}>
					<Select.Trigger class="w-fit gap-2 border bg-secondary text-base sm:text-lg font-medium">
						<Calendar class="h-3.5 w-3.5 sm:h-4 sm:w-4" />
						{selectedYear}
					</Select.Trigger>
					<Select.Content>
						{#each years as year (year)}
							<Select.Item value={String(year)} label={String(year)}>{year}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
		</Card.Content>
	</Card.Root>

	{#if isLoading}
		<div class="flex justify-center p-12">
			<LoaderCircle class="h-8 w-8 animate-spin text-muted-foreground" />
		</div>
	{:else if error}
		<div class="rounded-lg border bg-card p-6">
			<div class="mb-4 flex items-center gap-3 text-destructive">
				<CircleAlert class="h-5 w-5" />
				<p class="font-medium">Failed to load year-end summary</p>
			</div>
			<p class="mb-4 text-sm text-muted-foreground">{error}</p>
			<Button onclick={() => loadData(selectedYear)}>Retry</Button>
		</div>
	{:else if yearEnd}
		<!-- Key Metrics — StatCardGrid -->
		<StatCardGrid
			items={[
				{
					label: 'Total Spent',
					value: formatCurrency(yearEnd.totalSpent),
					icon: DollarSign,
					iconColor: 'chart-1',
					subtitle: yearEnd.previousYearComparison
						? `${yearEnd.previousYearComparison.percentageChange > 0 ? '+' : ''}${yearEnd.previousYearComparison.percentageChange.toFixed(1)}% vs ${yearEnd.year - 1}`
						: undefined
				},
				{
					label: `Avg ${efficiencyLabel}`,
					value: yearEnd.avgEfficiency != null ? yearEnd.avgEfficiency.toFixed(1) : 'N/A',
					icon: Fuel,
					iconColor: 'chart-2',
					subtitle: 'Across all vehicles'
				},
				{
					label: costPerDistLabel,
					value: yearEnd.costPerDistance != null ? formatCurrency(yearEnd.costPerDistance) : 'N/A',
					icon: Wrench,
					iconColor: 'chart-3',
					subtitle: 'Total operating cost'
				},
				{
					label: 'Vehicles',
					value: yearEnd.vehicleCount,
					icon: CircleAlert,
					iconColor: 'chart-4',
					subtitle: `${yearEnd.totalDistance.toLocaleString()} total ${distLongLabel.toLowerCase()}`
				}
			]}
			columns={4}
		/>

		<!-- Category Breakdown + MPG Trend in 2-col grid -->
		<div class="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
			<!-- Category Breakdown (Pie Chart) -->
			<AppPieChart title="Expense Breakdown" description="Spending by category" data={pieData} />

			<!-- Efficiency Trend (Line Chart) -->
			<AppLineChart
				title="{efficiencyLabel} Trend"
				description="Fuel efficiency over the year"
				data={effTrendData}
				x="date"
				y="efficiency"
				series={effTrendSeries}
				config={effTrendConfig}
				yAxisFormat={formatDecimalAxis}
			/>
		</div>

		<!-- Biggest Expense + Year-over-Year Comparison (side by side on desktop) -->
		<div class="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
			{#if yearEnd.biggestExpense}
				<Card.Root class="border-destructive">
					<Card.Content class="p-4 sm:p-6">
						<div class="space-y-2">
							<div class="flex items-center gap-2">
								<CircleAlert class="h-4 w-4 sm:h-5 sm:w-5 text-destructive" />
								<h3 class="font-semibold text-sm sm:text-base">
									Biggest Expense of {yearEnd.year}
								</h3>
							</div>
							<p class="text-xl sm:text-2xl font-bold text-destructive">
								{formatCurrency(yearEnd.biggestExpense.amount)}
							</p>
							<p class="text-muted-foreground">{yearEnd.biggestExpense.description}</p>
							<p class="text-sm text-muted-foreground">
								{new Date(yearEnd.biggestExpense.date).toLocaleDateString('en-US', {
									month: 'long',
									day: 'numeric',
									year: 'numeric'
								})}
							</p>
						</div>
					</Card.Content>
				</Card.Root>
			{/if}

			{#if yearEnd.previousYearComparison}
				<Card.Root>
					<Card.Header>
						<Card.Title>Year-over-Year Comparison</Card.Title>
						<Card.Description>Change from {yearEnd.year - 1}</Card.Description>
					</Card.Header>
					<Card.Content>
						<div class="flex items-center gap-4">
							<div>
								<p class="text-sm text-muted-foreground">Previous Year</p>
								<p class="mt-1 text-xl font-bold">
									{formatCurrency(yearEnd.previousYearComparison.totalSpent)}
								</p>
							</div>
							<div class="flex items-center gap-2">
								{#if yearEnd.previousYearComparison.percentageChange > 0}
									<TrendingUp class="h-5 w-5 text-destructive" />
									<span class="text-lg font-medium text-destructive">
										+{yearEnd.previousYearComparison.percentageChange.toFixed(1)}%
									</span>
								{:else if yearEnd.previousYearComparison.percentageChange < 0}
									<TrendingDown class="h-5 w-5 text-chart-2" />
									<span class="text-lg font-medium text-chart-2">
										{yearEnd.previousYearComparison.percentageChange.toFixed(1)}%
									</span>
								{:else}
									<span class="text-lg font-medium text-muted-foreground">No change</span>
								{/if}
							</div>
						</div>
					</Card.Content>
				</Card.Root>
			{/if}
		</div>
	{/if}
</div>
