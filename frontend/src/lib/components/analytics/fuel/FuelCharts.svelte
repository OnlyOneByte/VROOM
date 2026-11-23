<script module lang="ts">
	import { parseMonthToDate } from '#lib/utils/chart-formatters.ts';
	import type { FuelStatsResponse } from '#lib/types/index.ts';

	export function consumptionChartRows(monthly: FuelStatsResponse['monthlyConsumption']) {
		return monthly.map(d => ({
			...d,
			efficiency: d.efficiency ?? undefined,
			date: parseMonthToDate(d.month)
		}));
	}
</script>

<script lang="ts">
	import { formatNumber } from '#lib/utils/formatters.ts';
	import { AppLineChart, AppAreaChart, AppBarChart } from '#lib/components/charts/index.ts';
	import { CHART_COLORS, buildChartConfig } from '#lib/utils/chart-colors.ts';
	import {
		formatDecimalAxis,
		formatCentsAxis,
		dayXAxisProps,
		formatDayLabel,
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
	}

	let { fuelStats, dayOfWeekPatterns, showGasCharts = true, group }: Props = $props();

	let units: UnitsMetadata = $derived(fuelStats.units ?? settingsStore.unitPreferences);

	let efficiencyLabel = $derived(getFuelEfficiencyLabel(units.distanceUnit, units.volumeUnit));
	let volumeLabel = $derived(getLongFormLabel(units.volumeUnit));
	let costPerDistLabel = $derived(getCostPerDistanceLabel(units.distanceUnit));
	let pricePerVolumeDesc = $derived(
		`Price per ${getLongFormLabel(units.volumeUnit).toLowerCase()} by fuel type over time`
	);

	let consumptionData = $derived(consumptionChartRows(fuelStats.monthlyConsumption));
	let consumptionTooltip: TooltipValueFormat = $derived((value, key) =>
		unitTooltip(key === 'volume' ? getVolumeUnitLabel(units.volumeUnit, true) : efficiencyLabel)(
			value,
			key
		)
	);
	let odometerTooltip = $derived(unitTooltip(getDistanceUnitLabel(units.distanceUnit, true), 0));

	let consumptionSeries = $derived([
		{ key: 'efficiency', label: efficiencyLabel, color: CHART_COLORS[0] as string },
		{ key: 'volume', label: volumeLabel, color: CHART_COLORS[1] as string }
	]);

	let consumptionConfig = $derived(buildChartConfig(consumptionSeries));

	type PriceHistory = FuelStatsResponse['gasPriceHistory'];

	function priceRows(history: PriceHistory) {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- Map used within $derived computation, not mutated reactively
		const byDate = new Map<string, Record<string, number | string | Date>>();
		for (const item of history) {
			if (!byDate.has(item.date))
				byDate.set(item.date, { dateStr: item.date, date: parseDateString(item.date) });
			const row = byDate.get(item.date)!;
			row[item.fuelType] = item.pricePerVolume;
		}
		return Array.from(byDate.values()).sort((a, b) =>
			String(a['dateStr']).localeCompare(String(b['dateStr']))
		);
	}

	function priceSeries(history: PriceHistory) {
		return [...new Set(history.map(d => d.fuelType))].map((name, i) => ({
			key: name,
			label: name,
			color: CHART_COLORS[i % CHART_COLORS.length] as string
		}));
	}

	let gasPriceData = $derived(priceRows(fuelStats.gasPriceHistory));
	let gasPriceSeries = $derived(priceSeries(fuelStats.gasPriceHistory));
	let gasPriceFuelTypes = $derived(gasPriceSeries.map(s => s.key));
	let gasPriceConfig = $derived(buildChartConfig(gasPriceSeries));

	let chargePriceHistory = $derived(fuelStats.charging?.priceHistory ?? []);
	let chargePriceData = $derived(priceRows(chargePriceHistory));
	let chargePriceSeries = $derived(priceSeries(chargePriceHistory));
	let chargePriceTypes = $derived(chargePriceSeries.map(s => s.key));
	let chargePriceConfig = $derived(buildChartConfig(chargePriceSeries));
	let pricePerChargeDesc = $derived(
		`Price per ${getChargeUnitLabel(units.chargeUnit, true)} by charger type over time`
	);

	let costVehicleNames = $derived([
		...new Set(fuelStats.fillupCostByVehicle.map(d => d.vehicleName))
	]);

	let fillupCostData = $derived(byVehicleMonth(fuelStats.fillupCostByVehicle, d => d.avgCost));

	let fillupCostSeries = $derived(
		costVehicleNames.map((name, i) => ({
			key: name,
			label: name,
			color: CHART_COLORS[i % CHART_COLORS.length] as string
		}))
	);

	let fillupCostConfig = $derived(buildChartConfig(fillupCostSeries));

	let odometerVehicleNames = $derived([
		...new Set(fuelStats.odometerProgression.map(d => d.vehicleName))
	]);

	let odometerData = $derived(byVehicleMonth(fuelStats.odometerProgression, d => d.mileage));

	let odometerSeries = $derived(
		odometerVehicleNames.map((name, i) => ({
			key: name,
			label: name,
			color: CHART_COLORS[i % CHART_COLORS.length] as string
		}))
	);

	let odometerConfig = $derived(buildChartConfig(odometerSeries));

	let cpmVehicleNames = $derived([...new Set(fuelStats.costPerDistance.map(d => d.vehicleName))]);

	let costPerMileData = $derived(byVehicleMonth(fuelStats.costPerDistance, d => d.costPerDistance));

	let costPerMileSeries = $derived(
		cpmVehicleNames.map((name, i) => ({
			key: name,
			label: name,
			color: CHART_COLORS[i % CHART_COLORS.length] as string
		}))
	);

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

	function parseDateString(dateStr: string): Date {
		return new Date(dateStr);
	}
</script>

<div class="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
	{#if group === 'primary'}
		{#if showGasCharts}
			<AppLineChart
				title="Fuel Consumption"
				description="Monthly {efficiencyLabel} and {volumeLabel.toLowerCase()} used"
				data={consumptionData}
				x="date"
				y={['efficiency', 'volume']}
				series={consumptionSeries}
				config={consumptionConfig}
				yAxisFormat={formatDecimalAxis}
				tooltipFormat={consumptionTooltip}
				xAxisProps={monthlyXAxisProps(consumptionData.length, 6)}
			/>

			<AppLineChart
				title="Gas Price on Fill-up"
				description={pricePerVolumeDesc}
				data={gasPriceData}
				x="date"
				y={gasPriceFuelTypes}
				series={gasPriceSeries}
				config={gasPriceConfig}
				tooltipLabelFormat={formatDayLabel}
				xAxisProps={dayXAxisProps(gasPriceData.length)}
			/>
		{/if}
		{#if chargePriceData.length > 0}
			<AppLineChart
				title="Charging Price"
				description={pricePerChargeDesc}
				data={chargePriceData}
				x="date"
				y={chargePriceTypes}
				series={chargePriceSeries}
				config={chargePriceConfig}
				yAxisFormat={formatCentsAxis}
				tooltipLabelFormat={formatDayLabel}
				xAxisProps={dayXAxisProps(chargePriceData.length)}
			/>
		{/if}
		{#if showGasCharts}
			<AppLineChart
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
