<script lang="ts">
	import '$lib/components/analytics/pie-chart-animations.css';
	import '$lib/components/analytics/line-chart-animations.css';
	import { animateOnView } from '$lib/utils/animate-on-view';
	import { onMount } from 'svelte';
	import { PieChart, LineChart } from 'layerchart';
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
	import * as Chart from '$lib/components/ui/chart';
	import * as Select from '$lib/components/ui/select';
	import { analyticsApi } from '$lib/services/analytics-api';
	import type { YearEndResponse } from '$lib/types';
	import { formatCurrency } from '$lib/utils/formatters';
	import {
		formatDecimalAxis,
		CHART_PADDING,
		TREND_LINE_PROPS,
		monthlyXAxisProps
	} from '$lib/utils/chart-formatters';

	const categoryColors: Record<string, string> = {
		fuel: 'var(--chart-1)',
		maintenance: 'var(--chart-2)',
		financial: 'var(--chart-3)',
		regulatory: 'var(--chart-4)',
		enhancement: 'var(--chart-5)',
		misc: 'var(--primary)'
	};

	const categoryLabels: Record<string, string> = {
		fuel: 'Fuel',
		maintenance: 'Maintenance',
		financial: 'Financial',
		regulatory: 'Regulatory',
		enhancement: 'Enhancement',
		misc: 'Misc'
	};

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

	function handleYearChange(value: string[] | undefined) {
		const yearStr = value?.[0];
		if (yearStr) {
			const year = Number.parseInt(yearStr, 10);
			selectedYear = year;
			loadData(year);
		}
	}

	onMount(() => {
		loadData(selectedYear);
	});

	function parseMonthToDate(month: string): Date {
		const [y, m] = month.split('-');
		return new Date(Number(y), Number(m) - 1, 1);
	}

	// --- Category Breakdown Pie ---
	let pieData = $derived(
		(yearEnd?.categoryBreakdown ?? []).map(c => ({
			...c,
			color: categoryColors[c.category] ?? 'var(--primary)',
			label: categoryLabels[c.category] ?? c.category
		}))
	);

	let pieConfig = $derived.by(() => {
		const config: Chart.ChartConfig = {};
		for (const item of pieData) {
			config[item.category] = { label: item.label, color: item.color };
		}
		return config;
	});

	// --- MPG Trend Line ---
	let mpgTrendData = $derived(
		(yearEnd?.mpgTrend ?? []).map(d => ({ ...d, date: parseMonthToDate(d.month) }))
	);

	const mpgTrendConfig: Chart.ChartConfig = {
		mpg: { label: 'MPG', color: 'var(--chart-1)' }
	};

	const mpgTrendSeries = [{ key: 'mpg', label: 'MPG', color: 'var(--chart-1)' }];
</script>

<div class="space-y-6">
	<!-- Year Selector -->
	<Card.Root>
		<Card.Header>
			<Card.Title>Select Year</Card.Title>
			<Card.Description>View annual summary for a specific year</Card.Description>
		</Card.Header>
		<Card.Content>
			<Select.Root type="multiple" value={[String(selectedYear)]} onValueChange={handleYearChange}>
				<Select.Trigger class="w-full md:w-64">{selectedYear}</Select.Trigger>
				<Select.Content>
					{#each years as year (year)}
						<Select.Item value={String(year)} label={String(year)}>{year}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
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
		<!-- Gradient Header Card -->
		<Card.Root class="bg-gradient-to-br from-primary/5 to-chart-3/5">
			<Card.Content class="p-4 sm:p-6">
				<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
					<div class="flex items-center gap-2 sm:gap-3">
						<Award class="h-6 w-6 sm:h-8 sm:w-8 text-primary" />
						<div>
							<h2 class="text-xl sm:text-2xl font-bold">{yearEnd.year} Annual Report Card</h2>
							<p class="text-sm sm:text-base text-muted-foreground">Your complete year in review</p>
						</div>
					</div>
					<span
						class="inline-flex items-center gap-2 rounded-md border bg-secondary px-3 sm:px-4 py-1.5 sm:py-2 text-base sm:text-lg font-medium w-fit"
					>
						<Calendar class="h-3 w-3 sm:h-4 sm:w-4" />
						{yearEnd.year}
					</span>
				</div>
			</Card.Content>
		</Card.Root>

		<!-- Key Metrics 4-col Grid -->
		<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
			<!-- Total Spent -->
			<Card.Root>
				<Card.Content class="p-4 sm:p-6 space-y-2">
					<div class="flex items-center gap-2 text-muted-foreground">
						<DollarSign class="h-4 w-4" />
						<span class="text-sm">Total Spent</span>
					</div>
					<p class="text-3xl font-bold">{formatCurrency(yearEnd.totalSpent)}</p>
					{#if yearEnd.previousYearComparison}
						<div class="flex items-center gap-1 text-sm">
							{#if yearEnd.previousYearComparison.percentageChange > 0}
								<TrendingUp class="h-4 w-4 text-destructive" />
								<span class="text-destructive"
									>{yearEnd.previousYearComparison.percentageChange.toFixed(1)}%</span
								>
							{:else if yearEnd.previousYearComparison.percentageChange < 0}
								<TrendingDown class="h-4 w-4 text-chart-2" />
								<span class="text-chart-2"
									>{Math.abs(yearEnd.previousYearComparison.percentageChange).toFixed(1)}%</span
								>
							{/if}
							<span class="text-muted-foreground">vs {yearEnd.year - 1}</span>
						</div>
					{/if}
				</Card.Content>
			</Card.Root>
			<!-- Avg MPG -->
			<Card.Root>
				<Card.Content class="p-4 sm:p-6 space-y-2">
					<div class="flex items-center gap-2 text-muted-foreground">
						<Fuel class="h-4 w-4" />
						<span class="text-sm">Avg MPG</span>
					</div>
					<p class="text-3xl font-bold">
						{yearEnd.avgMpg != null ? yearEnd.avgMpg.toFixed(1) : 'N/A'}
					</p>
					<p class="text-sm text-muted-foreground">Across all vehicles</p>
				</Card.Content>
			</Card.Root>
			<!-- Cost per Mile -->
			<Card.Root>
				<Card.Content class="p-4 sm:p-6 space-y-2">
					<div class="flex items-center gap-2 text-muted-foreground">
						<Wrench class="h-4 w-4" />
						<span class="text-sm">Cost per Mile</span>
					</div>
					<p class="text-3xl font-bold">
						{yearEnd.costPerMile != null ? formatCurrency(yearEnd.costPerMile) : 'N/A'}
					</p>
					<p class="text-sm text-muted-foreground">Total operating cost</p>
				</Card.Content>
			</Card.Root>
			<!-- Vehicles -->
			<Card.Root>
				<Card.Content class="p-4 sm:p-6 space-y-2">
					<div class="flex items-center gap-2 text-muted-foreground">
						<CircleAlert class="h-4 w-4" />
						<span class="text-sm">Vehicles</span>
					</div>
					<p class="text-3xl font-bold">{yearEnd.vehicleCount}</p>
					<p class="text-sm text-muted-foreground">
						{yearEnd.totalMiles.toLocaleString()} total miles
					</p>
				</Card.Content>
			</Card.Root>
		</div>

		<!-- Category Breakdown + MPG Trend in 2-col grid -->
		<div class="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
			<!-- Category Breakdown (Pie Chart + Legend) -->
			<Card.Root>
				<Card.Header>
					<Card.Title>Expense Breakdown</Card.Title>
					<Card.Description>Spending by category</Card.Description>
				</Card.Header>
				<Card.Content>
					{#if pieData.length > 0}
						<div class="flex flex-col gap-6 md:flex-row">
							<div class="flex flex-1 items-center justify-center">
								<div
									use:animateOnView={'chart-pie-animated'}
									class="mx-auto aspect-square max-h-[250px] w-full max-w-[250px]"
								>
									<Chart.Container config={pieConfig} class="h-full w-full">
										<PieChart
											data={pieData}
											key="category"
											value="amount"
											label="name"
											cRange={pieData.map(d => d.color)}
											innerRadius={60}
											outerRadius={120}
											padAngle={0.02}
											cornerRadius={4}
										>
											{#snippet tooltip()}
												<Chart.Tooltip hideLabel />
											{/snippet}
										</PieChart>
									</Chart.Container>
								</div>
							</div>
							<div
								class="min-w-0 flex-1 space-y-1.5"
								role="list"
								aria-label="Expense category breakdown"
							>
								{#each pieData as item (item.category)}
									<div class="flex items-center justify-between rounded-lg p-2" role="listitem">
										<div class="flex items-center gap-2">
											<div
												class="h-3 w-3 rounded-full"
												style:background-color={item.color}
												aria-hidden="true"
											></div>
											<span class="text-sm font-medium">{item.label}</span>
										</div>
										<div class="text-right">
											<div class="text-sm font-bold">{formatCurrency(item.amount)}</div>
											<div class="text-xs text-muted-foreground">
												{item.percentage.toFixed(1)}%
											</div>
										</div>
									</div>
								{/each}
							</div>
						</div>
					{:else}
						<p class="py-8 text-center text-sm text-muted-foreground">No expense data available</p>
					{/if}
				</Card.Content>
			</Card.Root>

			<!-- MPG Trend (Line Chart) -->
			{#if mpgTrendData.length > 0}
				<Card.Root>
					<Card.Header>
						<Card.Title>MPG Trend</Card.Title>
						<Card.Description>Fuel efficiency over the year</Card.Description>
					</Card.Header>
					<Card.Content>
						<div use:animateOnView={'chart-line-animated'}>
							<Chart.Container config={mpgTrendConfig} class="h-[300px] w-full">
								<LineChart
									data={mpgTrendData}
									x="date"
									y="mpg"
									series={mpgTrendSeries}
									padding={CHART_PADDING}
									props={{
										...TREND_LINE_PROPS,
										xAxis: monthlyXAxisProps(mpgTrendData.length),
										yAxis: { format: formatDecimalAxis }
									}}
								>
									{#snippet tooltip()}
										<Chart.Tooltip hideLabel />
									{/snippet}
								</LineChart>
							</Chart.Container>
						</div>
					</Card.Content>
				</Card.Root>
			{/if}
		</div>

		<!-- Biggest Expense -->
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

		<!-- Year-over-Year Comparison -->
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
	{/if}
</div>
