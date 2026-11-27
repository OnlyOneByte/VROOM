<script module lang="ts">
	const RADAR_WIDE_TICKS_MIN_WIDTH = 500;

	const radarMetrics = [
		{ key: 'fuelEfficiency', label: 'Fuel Efficiency', tick: 'Efficiency' },
		{ key: 'maintenanceCost', label: 'Maintenance Cost', tick: 'Maintenance' },
		{ key: 'reliability', label: 'Reliability', tick: 'Reliability' },
		{ key: 'annualCost', label: 'Annual Cost', tick: 'Annual Cost' },
		{ key: 'mileage', label: 'Mileage', tick: 'Mileage' }
	] as const;

	export function radarTickLabel(label: string, cardWidth: number): string {
		const index = radarMetrics.findIndex(m => m.label === label);
		const metric = radarMetrics[index];
		if (!metric) return label;
		const staggered = cardWidth < RADAR_WIDE_TICKS_MIN_WIDTH && index % 2 === 1;
		return staggered ? `\u00a0\n${metric.tick}` : metric.tick;
	}
</script>

<script lang="ts">
	import '#lib/components/charts/bar-chart-animations.css';
	import {
		formatCountTooltip,
		formatDecimalAxis,
		monthlyXAxisProps,
		parseMonthToDate,
		unitTooltip
	} from '#lib/utils/chart-formatters.ts';
	import { AppBarChart } from '#lib/components/charts/index.ts';
	import {
		CHART_COLORS,
		VEHICLE_COLORS,
		CATEGORY_COLORS,
		CATEGORY_LABELS,
		buildChartConfig
	} from '#lib/utils/chart-colors.ts';
	import type { FuelAdvancedResponse } from '#lib/types/index.ts';
	import { settingsStore } from '#lib/stores/settings.svelte.ts';
	import { EXPENSE_CATEGORIES } from '#lib/constants/expense-categories.ts';
	import { getFuelEfficiencyLabel } from '#lib/utils/units.ts';

	interface Props {
		fuelAdvanced: FuelAdvancedResponse;
		group: 'patterns' | 'comparisons';
		vehicleColors?: Record<string, string>;
	}

	let { fuelAdvanced, group, vehicleColors = {} }: Props = $props();

	let units = $derived(settingsStore.unitPreferences);
	let efficiencyLabel = $derived(getFuelEfficiencyLabel(units.distanceUnit, units.volumeUnit));

	let seasonalSeries = $derived([
		{ key: 'avgEfficiency', label: `Avg ${efficiencyLabel}`, color: CHART_COLORS[0] as string }
	]);
	let seasonalConfig = $derived(buildChartConfig(seasonalSeries));

	let seasonalData = $derived(
		fuelAdvanced.seasonalEfficiency.some(d => d.fillupCount > 0)
			? fuelAdvanced.seasonalEfficiency
			: []
	);

	let radarCardWidth = $state(0);
	let radarTickFormat = $derived((label: string) => radarTickLabel(label, radarCardWidth));

	let radarData = $derived.by(() => {
		return radarMetrics.map(metric => {
			const row: Record<string, string | number> = { metric: metric.label };
			for (const vehicle of fuelAdvanced.vehicleRadar) {
				const score = vehicle[metric.key];
				if (score !== null) row[vehicle.vehicleId] = score;
			}
			return row;
		});
	});

	let radarVehicleSeries = $derived(
		fuelAdvanced.vehicleRadar.map((v, i) => ({
			key: v.vehicleId,
			label: v.vehicleName,
			color: vehicleColors[v.vehicleId] ?? (VEHICLE_COLORS[i % VEHICLE_COLORS.length] as string)
		}))
	);

	let radarConfig = $derived(buildChartConfig(radarVehicleSeries));

	let radarDescription = $derived.by(() => {
		const base = 'Scores from 10 (worst in your fleet) to 100 (best), by metric.';
		const missing = fuelAdvanced.vehicleRadar.filter(v => v.fuelEfficiency === null);
		if (missing.length === 0) return base;
		if (missing.length === fuelAdvanced.vehicleRadar.length) {
			return `${base} Fuel Efficiency: No data.`;
		}
		return `${base} Fuel Efficiency: No data for ${missing.map(v => v.vehicleName).join(', ')}.`;
	});

	let heatmapSeries = $derived(
		EXPENSE_CATEGORIES.map(cat => ({
			key: cat,
			label: CATEGORY_LABELS[cat] ?? cat,
			color: CATEGORY_COLORS[cat] ?? 'var(--primary)'
		}))
	);

	let heatmapConfig = $derived(buildChartConfig(heatmapSeries));

	const intervalSeries = [{ key: 'count', label: 'Count', color: CHART_COLORS[2] as string }];
	const intervalConfig = buildChartConfig(intervalSeries);

	let heatmapData = $derived(
		fuelAdvanced.monthlyCostHeatmap.map(d => ({ ...d, date: parseMonthToDate(d.month) }))
	);

	let heatmapYDomain = $derived.by((): [number, number] => {
		let max = 0;
		for (const row of fuelAdvanced.monthlyCostHeatmap) {
			let total = 0;
			for (const cat of EXPENSE_CATEGORIES) {
				total += (row[cat] as number) ?? 0;
			}
			if (total > max) max = total;
		}
		return [0, max * 1.05];
	});
</script>

<div class="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
	{#if group === 'patterns'}
		<AppBarChart
			level={4}
			title="Seasonal Efficiency"
			description="Average {efficiencyLabel} by season"
			data={seasonalData}
			x="season"
			y="avgEfficiency"
			series={seasonalSeries}
			config={seasonalConfig}
			yAxisFormat={formatDecimalAxis}
			tooltipFormat={unitTooltip(efficiencyLabel)}
			xAxisProps={{
				ticks: seasonalData.map(d => d.season),
				format: (v: string) => (typeof v === 'string' ? v : String(v))
			}}
		/>
		<AppBarChart
			level={4}
			title="Time Between Fill-ups"
			description="Distribution of fill-up intervals"
			data={fuelAdvanced.fillupIntervals}
			x="count"
			y="intervalLabel"
			series={intervalSeries}
			config={intervalConfig}
			orientation="horizontal"
			yAxisFormat={_v => String(_v)}
			tooltipFormat={formatCountTooltip}
			xAxisProps={{ format: (_v: number) => String(Math.round(_v)) }}
		/>
	{:else}
		<div class="min-w-0" bind:clientWidth={radarCardWidth}>
			<AppBarChart
				level={4}
				class="h-full"
				title="Vehicle Performance Comparison"
				description={radarDescription}
				data={radarData}
				x="metric"
				y={radarVehicleSeries.map(s => s.key)}
				series={radarVehicleSeries}
				config={radarConfig}
				seriesLayout="group"
				yDomain={[0, 100]}
				yAxisFormat={(v: number) => String(v)}
				tooltipFormat={formatCountTooltip}
				xAxisProps={{ ticks: radarMetrics.map(m => m.label), format: radarTickFormat }}
			/>
		</div>
		<AppBarChart
			level={4}
			title="Monthly Spending by Category"
			description="Spending by category over time"
			data={heatmapData}
			x="date"
			series={heatmapSeries}
			config={heatmapConfig}
			seriesLayout="stack"
			yDomain={heatmapYDomain}
			xAxisProps={monthlyXAxisProps(heatmapData.length, 6)}
		/>
	{/if}
</div>
