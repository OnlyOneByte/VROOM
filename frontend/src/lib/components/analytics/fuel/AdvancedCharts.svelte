<script lang="ts">
	import '$lib/components/charts/bar-chart-animations.css';
	import { formatDecimalAxis, parseMonthToDate } from '$lib/utils/chart-formatters';
	import { AppBarChart } from '$lib/components/charts';
	import {
		CHART_COLORS,
		CATEGORY_COLORS,
		CATEGORY_LABELS,
		buildChartConfig
	} from '$lib/utils/chart-colors';
	import type { FuelAdvancedResponse } from '$lib/types';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { getFuelEfficiencyLabel } from '$lib/utils/units';

	interface Props {
		fuelAdvanced: FuelAdvancedResponse;
	}

	let { fuelAdvanced }: Props = $props();

	// --- 2. Seasonal Efficiency ---
	let units = $derived(settingsStore.unitPreferences);
	let efficiencyLabel = $derived(getFuelEfficiencyLabel(units.distanceUnit, units.volumeUnit));

	let seasonalSeries = $derived([
		{ key: 'avgEfficiency', label: `Avg ${efficiencyLabel}`, color: CHART_COLORS[0] as string }
	]);
	let seasonalConfig = $derived(buildChartConfig(seasonalSeries));

	// buildSeasonalEfficiency always returns all 4 seasons (avgEfficiency 0 when there's
	// no fuel data), so a length check is always true and the chart would render a bare
	// empty axis. Gate on REAL data; when there's none, pass [] so AppBarChart shows its
	// kit empty-state, matching the sibling charts (same fix as the day-of-week chart).
	let seasonalData = $derived(
		fuelAdvanced.seasonalEfficiency.some(d => d.fillupCount > 0)
			? fuelAdvanced.seasonalEfficiency
			: []
	);

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
			description="Average {efficiencyLabel} by season"
			data={seasonalData}
			x="season"
			y="avgEfficiency"
			series={seasonalSeries}
			config={seasonalConfig}
			yAxisFormat={formatDecimalAxis}
			xAxisProps={{
				ticks: seasonalData.map(d => d.season),
				format: (v: string) => (typeof v === 'string' ? v : String(v))
			}}
		/>

		<!-- Vehicle Performance Comparison — grouped bar (was a radial LineChart, but
		     layerchart@2.0.0-next.65's radial geometry produced infinite-radius paths
		     `M-Infinity,… aInfinity,Infinity`; see TODO.md. A grouped bar conveys the
		     same per-vehicle, per-metric comparison and renders cleanly via the kit.
		     Scores are normalized 0–100 server-side, so yDomain is fixed. -->
		<AppBarChart
			title="Vehicle Performance Comparison"
			description="Normalized 0–100 scores by metric (higher is better)"
			data={radarData}
			x="metric"
			y={radarVehicleSeries.map((s) => s.key)}
			series={radarVehicleSeries}
			config={radarConfig}
			seriesLayout="group"
			yDomain={[0, 100]}
			yAxisFormat={(v: number) => String(v)}
			xAxisProps={{ ticks: radarMetrics.map((m) => m.label) }}
		/>
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
