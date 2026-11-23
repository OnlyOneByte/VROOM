<script module lang="ts">
	import { parseMonthToDate } from '#lib/utils/chart-formatters.ts';
	import type { FuelStatsResponse } from '#lib/types/index.ts';

	type PriceHistory = FuelStatsResponse['gasPriceHistory'];

	export interface MonthlyPrice {
		count: number;
		min: number;
		max: number;
	}

	export function monthlyPriceRows(history: PriceHistory) {
		const rows: Record<string, Record<string, unknown>> = {};
		const sums: Record<string, number> = {};
		for (const item of history) {
			const month = item.date.slice(0, 7);
			const row = (rows[month] ??= { month, date: parseMonthToDate(month) });
			const key = `${month}|${item.fuelType}`;
			sums[key] = (sums[key] ?? 0) + item.pricePerVolume;
			const stats = (row[`${item.fuelType}:stats`] as MonthlyPrice | undefined) ?? {
				count: 0,
				min: item.pricePerVolume,
				max: item.pricePerVolume
			};
			stats.count += 1;
			stats.min = Math.min(stats.min, item.pricePerVolume);
			stats.max = Math.max(stats.max, item.pricePerVolume);
			row[`${item.fuelType}:stats`] = stats;
			row[item.fuelType] = (sums[key] ?? 0) / stats.count;
		}
		return Object.values(rows).sort((a, b) => String(a['month']).localeCompare(String(b['month'])));
	}

	export function monthlyPriceSeries(rows: Record<string, unknown>[], types: string[]) {
		return types.map(type => ({ key: type, data: rows.filter(row => row[type] != null) }));
	}

	export function consumptionChartRows(monthly: FuelStatsResponse['monthlyConsumption']) {
		return monthly.map(d => ({
			...d,
			efficiency: d.efficiency ?? undefined,
			date: parseMonthToDate(d.month)
		}));
	}
</script>

<script lang="ts">
	import { formatCurrency, formatNumber } from '#lib/utils/formatters.ts';
	import { AppLineChart, AppAreaChart, AppBarChart } from '#lib/components/charts/index.ts';
	import { CHART_COLORS, buildChartConfig } from '#lib/utils/chart-colors.ts';
	import {
		formatDecimalAxis,
		formatCentsAxis,
		formatCountTooltip,
		byVehicleMonth,
		monthlyXAxisProps,
		unitTooltip,
		type TooltipValueFormat
	} from '#lib/utils/chart-formatters.ts';
	import * as Chart from '#lib/components/ui/chart/index.ts';
	import type { FuelAdvancedResponse, UnitsMetadata } from '#lib/types/index.ts';
	import { settingsStore } from '#lib/stores/settings.svelte.ts';
	import {
		getFuelEfficiencyLabel,
		getLongFormLabel,
		getVolumeUnitName,
		getCostPerDistanceLabel,
		getChargeUnitLabel,
		getDistanceUnitLabel,
		getVolumeUnitLabel
	} from '#lib/utils/units.ts';

	interface Props {
		fuelStats: FuelStatsResponse;
		dayOfWeekPatterns?: FuelAdvancedResponse['dayOfWeekPatterns'];
		showGasCharts?: boolean;
		group: 'primary' | 'patterns' | 'comparisons';
		vehicleColors?: Record<string, string>;
	}

	let {
		fuelStats,
		dayOfWeekPatterns,
		showGasCharts = true,
		group,
		vehicleColors = {}
	}: Props = $props();

	function vehicleSeries(rows: { vehicleId: string; vehicleName: string }[], names: string[]) {
		const ids = new Map(rows.map(r => [r.vehicleName, r.vehicleId]));
		return names.map((name, i) => ({
			key: name,
			label: name,
			color: vehicleColors[ids.get(name) ?? ''] ?? (CHART_COLORS[i % CHART_COLORS.length] as string)
		}));
	}

	let units: UnitsMetadata = $derived(fuelStats.units ?? settingsStore.unitPreferences);
	let chartLevel = $derived(group === 'primary' ? (2 as const) : (3 as const));

	let efficiencyLabel = $derived(getFuelEfficiencyLabel(units.distanceUnit, units.volumeUnit));
	let volumeLabel = $derived(getLongFormLabel(units.volumeUnit));
	let costPerDistLabel = $derived(getCostPerDistanceLabel(units.distanceUnit));
	let pricePerVolumeDesc = $derived(
		`Average price per ${getVolumeUnitName(units.volumeUnit)} by fuel type, per month`
	);

	let consumptionData = $derived(consumptionChartRows(fuelStats.monthlyConsumption));
	let volumeData = $derived(consumptionData.filter(d => d.volume > 0));
	let efficiencyTooltip = $derived(unitTooltip(efficiencyLabel));
	let volumeTooltip = $derived(unitTooltip(getVolumeUnitLabel(units.volumeUnit, true)));
	let odometerTooltip = $derived(unitTooltip(getDistanceUnitLabel(units.distanceUnit, true), 0));

	let efficiencySeries = $derived([
		{ key: 'efficiency', label: efficiencyLabel, color: CHART_COLORS[0] as string }
	]);
	let efficiencyConfig = $derived(buildChartConfig(efficiencySeries));

	let volumeSeries = $derived([
		{ key: 'volume', label: volumeLabel, color: CHART_COLORS[1] as string }
	]);
	let volumeConfig = $derived(buildChartConfig(volumeSeries));

	function priceSeries(history: PriceHistory, rows: Record<string, unknown>[]) {
		const types = [...new Set(history.map(d => d.fuelType))];
		const perType = monthlyPriceSeries(rows, types);
		return types.map((name, i) => ({
			key: name,
			label: name,
			color: CHART_COLORS[i % CHART_COLORS.length] as string,
			value: name,
			data: perType[i]!.data
		}));
	}

	function priceTooltip(noun: string): TooltipValueFormat {
		return (value, key, row) => {
			const stats = row?.[`${key}:stats`] as MonthlyPrice | undefined;
			const average = `${formatCurrency(value)} avg`;
			if (!stats) return average;
			const count = `${stats.count} ${noun}${stats.count === 1 ? '' : 's'}`;
			if (stats.count === 1) return `${average} · ${count}`;
			return `${average} · ${count} · ${formatCurrency(stats.min)}–${formatCurrency(stats.max)}`;
		};
	}

	let gasPriceData = $derived(monthlyPriceRows(fuelStats.gasPriceHistory));
	let gasPriceSeries = $derived(priceSeries(fuelStats.gasPriceHistory, gasPriceData));
	let gasPriceFuelTypes = $derived(gasPriceSeries.map(s => s.key));
	let gasPriceConfig = $derived(buildChartConfig(gasPriceSeries));

	let chargePriceHistory = $derived(fuelStats.charging?.priceHistory ?? []);
	let chargePriceData = $derived(monthlyPriceRows(chargePriceHistory));
	let chargePriceSeries = $derived(priceSeries(chargePriceHistory, chargePriceData));
	let chargePriceTypes = $derived(chargePriceSeries.map(s => s.key));
	let chargePriceConfig = $derived(buildChartConfig(chargePriceSeries));
	let pricePerChargeDesc = $derived(
		`Average price per ${getChargeUnitLabel(units.chargeUnit, true)} by charger type, per month`
	);

	let costVehicleNames = $derived([
		...new Set(fuelStats.fillupCostByVehicle.map(d => d.vehicleName))
	]);

	let fillupCostData = $derived(byVehicleMonth(fuelStats.fillupCostByVehicle, d => d.avgCost));

	let fillupCostSeries = $derived(vehicleSeries(fuelStats.fillupCostByVehicle, costVehicleNames));

	let fillupCostConfig = $derived(buildChartConfig(fillupCostSeries));

	let odometerVehicleNames = $derived([
		...new Set(fuelStats.odometerProgression.map(d => d.vehicleName))
	]);

	let odometerData = $derived(byVehicleMonth(fuelStats.odometerProgression, d => d.mileage));

	let odometerSeries = $derived(vehicleSeries(fuelStats.odometerProgression, odometerVehicleNames));

	let odometerConfig = $derived(buildChartConfig(odometerSeries));

	let cpmVehicleNames = $derived([...new Set(fuelStats.costPerDistance.map(d => d.vehicleName))]);

	let costPerMileData = $derived(byVehicleMonth(fuelStats.costPerDistance, d => d.costPerDistance));

	let costPerMileSeries = $derived(vehicleSeries(fuelStats.costPerDistance, cpmVehicleNames));

	let costPerMileConfig = $derived(buildChartConfig(costPerMileSeries));

	const dayPatternConfig: Chart.ChartConfig = {
		fillupCount: { label: 'Fill-ups', color: 'var(--chart-1)' }
	};

	const dayPatternSeries = [
		{ key: 'fillupCount', label: 'Fill-ups', color: CHART_COLORS[0] as string }
	];

	let dayPatternData = $derived(
		(dayOfWeekPatterns ?? []).some(d => d.fillupCount > 0) ? (dayOfWeekPatterns ?? []) : []
	);
</script>

<div
	class="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 lg:[&>*:last-child:nth-child(odd)]:col-span-2"
>
	{#if group === 'primary'}
		{#if showGasCharts}
			<AppLineChart
				level={chartLevel}
				title="Fuel Efficiency"
				description="Monthly {efficiencyLabel}"
				data={consumptionData}
				x="date"
				y="efficiency"
				series={efficiencySeries}
				config={efficiencyConfig}
				yAxisFormat={formatDecimalAxis}
				tooltipFormat={efficiencyTooltip}
				xAxisProps={monthlyXAxisProps(consumptionData.length, 6)}
			/>

			<AppBarChart
				level={chartLevel}
				title="Fuel Bought"
				description="Monthly {getVolumeUnitName(units.volumeUnit, true)} bought"
				data={volumeData}
				x="date"
				y="volume"
				series={volumeSeries}
				config={volumeConfig}
				yAxisFormat={v => formatNumber(v, 0)}
				tooltipFormat={volumeTooltip}
				xAxisProps={monthlyXAxisProps(volumeData.length, 6)}
			/>

			<AppLineChart
				level={chartLevel}
				title="Gas Price on Fill-up"
				description={pricePerVolumeDesc}
				data={gasPriceData}
				x="date"
				y={gasPriceFuelTypes}
				series={gasPriceSeries}
				config={gasPriceConfig}
				yAxisFormat={formatCentsAxis}
				tooltipFormat={priceTooltip('fill-up')}
			/>
		{/if}
		{#if chargePriceData.length > 0}
			<AppLineChart
				level={chartLevel}
				title="Charging Price"
				description={pricePerChargeDesc}
				data={chargePriceData}
				x="date"
				y={chargePriceTypes}
				series={chargePriceSeries}
				config={chargePriceConfig}
				yAxisFormat={formatCentsAxis}
				tooltipFormat={priceTooltip('session')}
			/>
		{/if}
		{#if showGasCharts}
			<AppLineChart
				level={chartLevel}
				title="Fill-up Cost by Vehicle"
				description="Average fill-up cost per vehicle over time"
				data={fillupCostData}
				x="date"
				y={costVehicleNames}
				series={fillupCostSeries}
				config={fillupCostConfig}
				xAxisProps={monthlyXAxisProps(fillupCostData.length, 6)}
			/>
		{/if}
	{:else if group === 'patterns'}
		{#if showGasCharts}
			<AppBarChart
				level={chartLevel}
				title="Fill-up Patterns by Day of Week"
				description="When you typically fill up"
				data={dayPatternData}
				x="day"
				y="fillupCount"
				series={dayPatternSeries}
				config={dayPatternConfig}
				height={350}
				yAxisFormat={v => String(Math.round(v))}
				tooltipFormat={formatCountTooltip}
				xAxisProps={{
					ticks: dayPatternData.map(d => d.day),
					format: (v: string) => (typeof v === 'string' ? v.slice(0, 3) : String(v))
				}}
			/>
		{/if}
	{:else}
		<AppLineChart
			level={chartLevel}
			title={costPerDistLabel}
			description="{costPerDistLabel} trend by vehicle"
			data={costPerMileData}
			x="date"
			y={cpmVehicleNames}
			series={costPerMileSeries}
			config={costPerMileConfig}
			yAxisFormat={formatCentsAxis}
			xAxisProps={monthlyXAxisProps(costPerMileData.length, 6)}
		/>
		<AppAreaChart
			level={chartLevel}
			title="Total Odometer"
			description="Mileage progression per vehicle"
			data={odometerData}
			x="date"
			y={odometerVehicleNames}
			series={odometerSeries}
			config={odometerConfig}
			yAxisFormat={v => formatNumber(v, 0)}
			tooltipFormat={odometerTooltip}
			xAxisProps={monthlyXAxisProps(odometerData.length, 6)}
		/>
	{/if}
</div>
