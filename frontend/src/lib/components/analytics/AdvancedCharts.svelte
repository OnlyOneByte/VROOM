<script lang="ts">
	import './line-chart-animations.css';
	import './bar-chart-animations.css';
	import { animateOnView } from '$lib/utils/animate-on-view';

	import { BarChart, LineChart } from 'layerchart';
	import { Calendar, Clock } from 'lucide-svelte';

	import { curveLinearClosed } from 'd3-shape';

	import { scaleBand } from 'd3-scale';
	import * as Card from '$lib/components/ui/card';
	import * as Chart from '$lib/components/ui/chart';
	import { formatCurrencyAxis, formatDecimalAxis } from '$lib/utils/chart-formatters';
	import type { FuelAdvancedResponse } from '$lib/types';

	const CHART_COLORS = [
		'var(--chart-1)',
		'var(--chart-2)',
		'var(--chart-3)',
		'var(--chart-4)',
		'var(--chart-5)'
	] as const;

	const CATEGORY_COLORS: Record<string, string> = {
		fuel: 'var(--chart-1)',
		maintenance: 'var(--chart-2)',
		financial: 'var(--chart-3)',
		regulatory: 'var(--chart-4)',
		enhancement: 'var(--chart-5)',
		misc: 'var(--primary)'
	};

	const CATEGORY_LABELS: Record<string, string> = {
		fuel: 'Fuel',
		maintenance: 'Maintenance',
		financial: 'Financial',
		regulatory: 'Regulatory',
		enhancement: 'Enhancement',
		misc: 'Misc'
	};

	interface Props {
		fuelAdvanced: FuelAdvancedResponse;
	}

	let { fuelAdvanced }: Props = $props();

	// --- 2. Seasonal Efficiency ---
	const seasonalConfig: Chart.ChartConfig = {
		avgMpg: { label: 'Avg MPG', color: 'var(--chart-1)' }
	};

	let seasonalSeries = $derived([{ key: 'avgMpg', label: 'Avg MPG', color: CHART_COLORS[0] }]);

	// --- 3. Vehicle Performance Comparison (Radar) ---
	const radarMetrics = [
		{ key: 'fuelEfficiency', label: 'Fuel Efficiency' },
		{ key: 'maintenanceCost', label: 'Maintenance Cost' },
		{ key: 'reliability', label: 'Reliability' },
		{ key: 'annualCost', label: 'Annual Cost' },
		{ key: 'mileage', label: 'Mileage' }
	] as const;

	let radarData = $derived.by(() => {
		return radarMetrics.map(metric => {
			const row: Record<string, string | number> = { metric: metric.label };
			for (const vehicle of fuelAdvanced.vehicleRadar) {
				row[vehicle.vehicleId] = vehicle[metric.key];
			}
			return row;
		});
	});

	let radarVehicleSeries = $derived(
		fuelAdvanced.vehicleRadar.map((v, i) => ({
			key: v.vehicleId,
			label: v.vehicleName,
			color: CHART_COLORS[i % CHART_COLORS.length]
		}))
	);

	let radarConfig = $derived.by(() => {
		const config: Chart.ChartConfig = {};
		for (const s of radarVehicleSeries) {
			config[s.key] = { label: s.label, color: s.color };
		}
		return config;
	});

	// --- 4. Fill-up Patterns by Day of Week ---
	const dayPatternConfig: Chart.ChartConfig = {
		fillupCount: { label: 'Fill-ups', color: 'var(--chart-1)' }
	};

	let dayPatternSeries = $derived([
		{ key: 'fillupCount', label: 'Fill-ups', color: CHART_COLORS[0] }
	]);

	// --- 5. Monthly Cost Heatmap (Stacked Bar) ---
	const heatmapCategories = [
		'fuel',
		'maintenance',
		'financial',
		'regulatory',
		'enhancement',
		'misc'
	] as const;

	let heatmapSeries = $derived(
		heatmapCategories.map(cat => ({
			key: cat,
			label: CATEGORY_LABELS[cat] ?? cat,
			color: CATEGORY_COLORS[cat] ?? 'var(--primary)'
		}))
	);

	let heatmapConfig = $derived.by(() => {
		const config: Chart.ChartConfig = {};
		for (const s of heatmapSeries) {
			config[s.key] = { label: s.label, color: s.color };
		}
		return config;
	});

	// --- 6. Fill-up Intervals ---
	const intervalConfig: Chart.ChartConfig = {
		count: { label: 'Count', color: 'var(--chart-3)' }
	};

	function parseMonthToDate(month: string): Date {
		const [y, m] = month.split('-');
		return new Date(Number(y), Number(m) - 1, 1);
	}

	function formatMonthLabel(value: unknown): string {
		if (!(value instanceof Date) || isNaN(value.getTime())) return '';
		return value.toLocaleDateString('en-US', { month: 'short' });
	}

	let heatmapData = $derived(
		fuelAdvanced.monthlyCostHeatmap.map(d => ({ ...d, date: parseMonthToDate(d.month) }))
	);

	let heatmapYMax = $derived(
		Math.max(
			...fuelAdvanced.monthlyCostHeatmap.map(
				d => d.fuel + d.maintenance + d.financial + d.regulatory + d.enhancement + d.misc
			),
			0
		)
	);
</script>

<div class="space-y-6">
	<div class="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
		<!-- 2. Seasonal Efficiency -->
		<Card.Root>
			<Card.Header>
				<Card.Title>Seasonal Efficiency</Card.Title>
				<Card.Description>Average MPG by season</Card.Description>
			</Card.Header>
			<Card.Content>
				{#if fuelAdvanced.seasonalEfficiency.length > 0}
					<div use:animateOnView={'chart-bar-animated'}>
						<Chart.Container config={seasonalConfig} class="h-[300px] w-full">
							<BarChart
								data={fuelAdvanced.seasonalEfficiency}
								x="season"
								y="avgMpg"
								series={seasonalSeries}
								padding={{ top: 4, left: 48, bottom: 20, right: 4 }}
								props={{
									bars: { stroke: 'none' },
									xAxis: { ticks: fuelAdvanced.seasonalEfficiency.length },
									yAxis: { format: (v: number) => formatDecimalAxis(v) }
								}}
							>
								{#snippet tooltip()}
									<Chart.Tooltip hideLabel />
								{/snippet}
							</BarChart>
						</Chart.Container>
					</div>
				{:else}
					<p class="text-sm text-muted-foreground text-center py-8">No seasonal data available</p>
				{/if}
			</Card.Content>
		</Card.Root>

		<!-- 3. Vehicle Performance Comparison (Radar) -->
		<Card.Root>
			<Card.Header>
				<Card.Title>Vehicle Performance Comparison</Card.Title>
				<Card.Description>Multi-metric analysis</Card.Description>
			</Card.Header>
			<Card.Content>
				{#if fuelAdvanced.vehicleRadar.length > 0}
					<div use:animateOnView={'chart-line-animated'}>
						<Chart.Container
							config={radarConfig}
							class="mx-auto aspect-square max-h-[300px] w-full"
						>
							<LineChart
								data={radarData}
								series={radarVehicleSeries}
								radial
								x="metric"
								xScale={scaleBand()}
								padding={16}
								props={{
									spline: {
										curve: curveLinearClosed,
										fillOpacity: 0.2,
										motion: 'tween'
									},
									xAxis: {
										tickLength: 0
									},
									yAxis: {
										format: () => ''
									},
									grid: {
										radialY: 'linear'
									},
									tooltip: {
										context: {
											mode: 'voronoi'
										}
									},
									highlight: {
										lines: false
									}
								}}
							>
								{#snippet tooltip()}
									<Chart.Tooltip />
								{/snippet}
							</LineChart>
						</Chart.Container>
					</div>
					<div
						class="mt-3 flex flex-wrap items-center justify-center gap-4 text-sm"
						role="list"
						aria-label="Vehicle legend"
					>
						{#each radarVehicleSeries as s (s.key)}
							<div class="flex items-center gap-2" role="listitem">
								<div
									class="h-3 w-3 rounded-sm"
									style="background-color: {s.color}"
									aria-hidden="true"
								></div>
								<span class="text-muted-foreground">{s.label}</span>
							</div>
						{/each}
					</div>
				{:else}
					<p class="text-sm text-muted-foreground text-center py-8">
						No vehicle comparison data available
					</p>
				{/if}
			</Card.Content>
		</Card.Root>
	</div>

	<!-- 4. Fill-up Patterns by Day of Week -->
	<Card.Root>
		<Card.Header>
			<div class="flex items-center gap-2">
				<Calendar class="h-4 w-4 text-muted-foreground sm:h-5 sm:w-5" />
				<div>
					<Card.Title>Fill-up Patterns by Day of Week</Card.Title>
					<Card.Description>When you typically fill up</Card.Description>
				</div>
			</div>
		</Card.Header>
		<Card.Content>
			{#if fuelAdvanced.dayOfWeekPatterns.length > 0}
				<div use:animateOnView={'chart-bar-animated'}>
					<Chart.Container config={dayPatternConfig} class="h-[300px] w-full">
						<BarChart
							data={fuelAdvanced.dayOfWeekPatterns}
							x="day"
							y="fillupCount"
							series={dayPatternSeries}
							padding={{ top: 4, left: 48, bottom: 28, right: 4 }}
							props={{
								bars: { stroke: 'none' },
								yAxis: { format: (v: number) => String(Math.round(v)) }
							}}
						>
							{#snippet tooltip()}
								<Chart.Tooltip hideLabel />
							{/snippet}
						</BarChart>
					</Chart.Container>
				</div>
				<div class="mt-4 space-y-2 border-t pt-4">
					{#each fuelAdvanced.dayOfWeekPatterns.filter(d => d.fillupCount > 0) as day (day.day)}
						<div class="flex items-center justify-between text-sm">
							<span class="text-muted-foreground">{day.day}</span>
							<div class="flex items-center gap-4">
								<span class="font-medium">{day.fillupCount} fill-ups</span>
								{#if day.avgCost > 0}
									<span class="text-muted-foreground">avg ${day.avgCost.toFixed(2)}</span>
								{/if}
								{#if day.avgGallons > 0}
									<span class="text-muted-foreground">{day.avgGallons.toFixed(1)} gal</span>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{:else}
				<p class="text-sm text-muted-foreground text-center py-8">
					No day-of-week pattern data available
				</p>
			{/if}
		</Card.Content>
	</Card.Root>

	<div class="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
		<!-- 5. Monthly Cost Heatmap (Stacked Bar) -->
		<Card.Root>
			<Card.Header>
				<Card.Title>Monthly Cost Heatmap</Card.Title>
				<Card.Description>Spending by category over time</Card.Description>
			</Card.Header>
			<Card.Content>
				{#if heatmapData.length > 0}
					<div class="overflow-hidden" use:animateOnView={'chart-bar-animated'}>
						<Chart.Container config={heatmapConfig} class="h-[300px] w-full">
							<BarChart
								data={heatmapData}
								x="date"
								y={[...heatmapCategories]}
								series={heatmapSeries}
								seriesLayout="stack"
								yDomain={[0, heatmapYMax]}
								padding={{ top: 20, left: 48, bottom: 20, right: 4 }}
								props={{
									bars: { stroke: 'none' },
									xAxis: {
										ticks: Math.min(heatmapData.length, 6),
										format: formatMonthLabel
									},
									yAxis: { format: formatCurrencyAxis }
								}}
							>
								{#snippet tooltip()}
									<Chart.Tooltip hideLabel />
								{/snippet}
							</BarChart>
						</Chart.Container>
					</div>
					<div
						class="mt-3 flex flex-wrap items-center justify-center gap-4 text-sm"
						role="list"
						aria-label="Cost breakdown legend"
					>
						{#each heatmapSeries as s (s.key)}
							<div class="flex items-center gap-2" role="listitem">
								<div
									class="h-3 w-3 rounded-sm"
									style="background-color: {s.color}"
									aria-hidden="true"
								></div>
								<span class="text-muted-foreground">{s.label}</span>
							</div>
						{/each}
					</div>
				{:else}
					<p class="text-sm text-muted-foreground text-center py-8">
						No monthly cost data available
					</p>
				{/if}
			</Card.Content>
		</Card.Root>

		<!-- 6. Time Between Fill-ups -->
		<Card.Root>
			<Card.Header>
				<div class="flex items-center gap-2">
					<Clock class="h-4 w-4 text-muted-foreground sm:h-5 sm:w-5" />
					<div>
						<Card.Title>Time Between Fill-ups</Card.Title>
						<Card.Description>Distribution of fill-up intervals</Card.Description>
					</div>
				</div>
			</Card.Header>
			<Card.Content>
				{#if fuelAdvanced.fillupIntervals.length > 0}
					<div use:animateOnView={'chart-bar-animated'}>
						<Chart.Container config={intervalConfig} class="h-[300px] w-full">
							<BarChart
								data={fuelAdvanced.fillupIntervals}
								x="count"
								y="intervalLabel"
								series={[{ key: 'count', label: 'Count', color: CHART_COLORS[2] }]}
								orientation="horizontal"
								padding={{ top: 4, left: 100, bottom: 20, right: 4 }}
								props={{
									bars: { stroke: 'none' },
									yAxis: { format: (v: unknown) => String(v) }
								}}
							>
								{#snippet tooltip()}
									<Chart.Tooltip hideLabel />
								{/snippet}
							</BarChart>
						</Chart.Container>
					</div>
				{:else}
					<p class="text-sm text-muted-foreground text-center py-8">
						No fill-up interval data available
					</p>
				{/if}
			</Card.Content>
		</Card.Root>
	</div>
</div>
