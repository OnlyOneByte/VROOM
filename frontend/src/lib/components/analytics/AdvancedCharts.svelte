<script lang="ts">
	import '$lib/components/charts/line-chart-animations.css';
	import '$lib/components/charts/bar-chart-animations.css';
	import { animateOnView } from '$lib/utils/animate-on-view';
	import { createVisibilityWatch } from '$lib/utils/visibility-watch.svelte';

	import { LineChart } from 'layerchart';

	import { curveLinearClosed } from 'd3-shape';

	import { scaleBand } from 'd3-scale';
	import * as Card from '$lib/components/ui/card';
	import * as Chart from '$lib/components/ui/chart';
	import { formatDecimalAxis, parseMonthToDate } from '$lib/utils/chart-formatters';
	import { AppBarChart } from '$lib/components/charts';
	import {
		CHART_COLORS,
		CATEGORY_COLORS,
		CATEGORY_LABELS,
		buildChartConfig
	} from '$lib/utils/chart-colors';
	import type { FuelAdvancedResponse } from '$lib/types';

	interface Props {
		fuelAdvanced: FuelAdvancedResponse;
	}

	let { fuelAdvanced }: Props = $props();

	// --- 2. Seasonal Efficiency ---
	const seasonalSeries = [{ key: 'avgMpg', label: 'Avg MPG', color: CHART_COLORS[0] as string }];
	const seasonalConfig = buildChartConfig(seasonalSeries);

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
			color: CHART_COLORS[i % CHART_COLORS.length] as string
		}))
	);

	let radarConfig = $derived(buildChartConfig(radarVehicleSeries));

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

	let heatmapConfig = $derived(buildChartConfig(heatmapSeries));

	// --- 6. Fill-up Intervals ---
	const intervalSeries = [{ key: 'count', label: 'Count', color: CHART_COLORS[2] as string }];
	const intervalConfig = buildChartConfig(intervalSeries);

	function formatMonthLabel(value: unknown): string {
		if (!(value instanceof Date) || isNaN(value.getTime())) return '';
		return value.toLocaleDateString('en-US', { month: 'short' });
	}

	// Visibility gate for the radar chart (bypasses ChartCard, uses LayerChart directly)
	// Uses synchronous MutationObserver + offsetParent check instead of async IO.
	let radarGate = createVisibilityWatch();

	let heatmapData = $derived(
		fuelAdvanced.monthlyCostHeatmap.map(d => ({ ...d, date: parseMonthToDate(d.month) }))
	);

	let heatmapYDomain = $derived.by((): [number, number] => {
		let max = 0;
		for (const row of fuelAdvanced.monthlyCostHeatmap) {
			let total = 0;
			for (const cat of heatmapCategories) {
				total += (row[cat] as number) ?? 0;
			}
			if (total > max) max = total;
		}
		return [0, max * 1.05];
	});
</script>

<div class="space-y-6">
	<div class="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
		<!-- Seasonal Efficiency → AppBarChart -->
		<AppBarChart
			title="Seasonal Efficiency"
			description="Average MPG by season"
			data={fuelAdvanced.seasonalEfficiency}
			x="season"
			y="avgMpg"
			series={seasonalSeries}
			config={seasonalConfig}
			yAxisFormat={formatDecimalAxis}
			xAxisProps={{
				ticks: fuelAdvanced.seasonalEfficiency.map(d => d.season),
				format: (v: string) => (typeof v === 'string' ? v : String(v))
			}}
		/>

		<!-- Vehicle Performance Comparison (Radar) — kept manual -->
		<Card.Root>
			<Card.Header>
				<Card.Title>Vehicle Performance Comparison</Card.Title>
				<Card.Description>Multi-metric analysis</Card.Description>
			</Card.Header>
			<Card.Content>
				{#if fuelAdvanced.vehicleRadar.length > 0}
					<div bind:this={radarGate.el} style="min-height: 300px">
						{#if radarGate.visible}
							<div class="chart-line-animate-ready" use:animateOnView={'chart-line-animated'}>
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
						{/if}
					</div>
				{:else}
					<p class="text-sm text-muted-foreground text-center py-8">
						No vehicle comparison data available
					</p>
				{/if}
			</Card.Content>
		</Card.Root>
	</div>

	<div class="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
		<!-- Monthly Cost Heatmap → AppBarChart (stacked) -->
		<AppBarChart
			title="Monthly Cost Heatmap"
			description="Spending by category over time"
			data={heatmapData}
			x="date"
			y={[...heatmapCategories]}
			series={heatmapSeries}
			config={heatmapConfig}
			seriesLayout="stack"
			yDomain={heatmapYDomain}
			xAxisProps={{ ticks: Math.min(heatmapData.length, 6), format: formatMonthLabel }}
		/>

		<!-- Time Between Fill-ups → AppBarChart (horizontal) -->
		<AppBarChart
			title="Time Between Fill-ups"
			description="Distribution of fill-up intervals"
			data={fuelAdvanced.fillupIntervals}
			x="count"
			y="intervalLabel"
			series={intervalSeries}
			config={intervalConfig}
			orientation="horizontal"
			yAxisFormat={_v => String(_v)}
			xAxisProps={{ format: (_v: number) => String(Math.round(_v)) }}
		/>
	</div>
</div>
