<script lang="ts">
	import { AppLineChart, AppAreaChart, AppBarChart } from '$lib/components/charts';
	import { CHART_COLORS, buildChartConfig } from '$lib/utils/chart-colors';
	import {
		formatDecimalAxis,
		formatCentsAxis,
		formatDateTick,
		getXTickCount,
		parseMonthToDate
	} from '$lib/utils/chart-formatters';
	import * as Chart from '$lib/components/ui/chart';
	import type { FuelStatsResponse, FuelAdvancedResponse } from '$lib/types';

	interface Props {
		fuelStats: FuelStatsResponse;
		dayOfWeekPatterns?: FuelAdvancedResponse['dayOfWeekPatterns'];
	}

	let { fuelStats, dayOfWeekPatterns }: Props = $props();

	// --- 1. Fuel Consumption (MPG + Gallons) ---
	let consumptionData = $derived(
		fuelStats.monthlyConsumption.map(d => ({ ...d, date: parseMonthToDate(d.month) }))
	);

	let consumptionSeries = $derived([
		{ key: 'mpg', label: 'MPG', color: CHART_COLORS[0] as string },
		{ key: 'gallons', label: 'Gallons', color: CHART_COLORS[1] as string }
	]);

	let consumptionConfig = $derived(buildChartConfig(consumptionSeries));

	// --- 2. Gas Price History ---
	let gasPriceFuelTypes = $derived([...new Set(fuelStats.gasPriceHistory.map(d => d.fuelType))]);

	let gasPriceData = $derived.by(() => {
		const byDate = new Map<string, Record<string, number | string | Date>>();
		for (const item of fuelStats.gasPriceHistory) {
			if (!byDate.has(item.date))
				byDate.set(item.date, { dateStr: item.date, date: parseDateString(item.date) });
			const row = byDate.get(item.date)!;
			row[item.fuelType] = item.pricePerGallon;
		}
		return Array.from(byDate.values()).sort((a, b) =>
			String(a['dateStr']).localeCompare(String(b['dateStr']))
		);
	});

	let gasPriceSeries = $derived(
		gasPriceFuelTypes.map((name, i) => ({
			key: name,
			label: name,
			color: CHART_COLORS[i % CHART_COLORS.length] as string
		}))
	);

	let gasPriceConfig = $derived(buildChartConfig(gasPriceSeries));

	// --- 3. Fill-up Cost by Vehicle ---
	let costVehicleNames = $derived([
		...new Set(fuelStats.fillupCostByVehicle.map(d => d.vehicleName))
	]);

	let fillupCostData = $derived.by(() => {
		const byMonth = new Map<string, Record<string, number | string | Date>>();
		for (const item of fuelStats.fillupCostByVehicle) {
			if (!byMonth.has(item.month))
				byMonth.set(item.month, { month: item.month, date: parseMonthToDate(item.month) });
			const row = byMonth.get(item.month)!;
			row[item.vehicleName] = item.avgCost;
		}
		return Array.from(byMonth.values()).sort((a, b) =>
			String(a['month']).localeCompare(String(b['month']))
		);
	});

	let fillupCostSeries = $derived(
		costVehicleNames.map((name, i) => ({
			key: name,
			label: name,
			color: CHART_COLORS[i % CHART_COLORS.length] as string
		}))
	);

	let fillupCostConfig = $derived(buildChartConfig(fillupCostSeries));

	// --- 4. Odometer Progression ---
	let odometerVehicleNames = $derived([
		...new Set(fuelStats.odometerProgression.map(d => d.vehicleName))
	]);

	let odometerData = $derived.by(() => {
		const byMonth = new Map<string, Record<string, number | string | Date>>();
		for (const item of fuelStats.odometerProgression) {
			if (!byMonth.has(item.month))
				byMonth.set(item.month, { month: item.month, date: parseMonthToDate(item.month) });
			const row = byMonth.get(item.month)!;
			row[item.vehicleName] = item.mileage;
		}
		return Array.from(byMonth.values()).sort((a, b) =>
			String(a['month']).localeCompare(String(b['month']))
		);
	});

	let odometerSeries = $derived(
		odometerVehicleNames.map((name, i) => ({
			key: name,
			label: name,
			color: CHART_COLORS[i % CHART_COLORS.length] as string
		}))
	);

	let odometerConfig = $derived(buildChartConfig(odometerSeries));

	// --- 5. Cost per Mile ---
	let cpmVehicleNames = $derived([...new Set(fuelStats.costPerMile.map(d => d.vehicleName))]);

	let costPerMileData = $derived.by(() => {
		const byMonth = new Map<string, Record<string, number | string | Date>>();
		for (const item of fuelStats.costPerMile) {
			if (!byMonth.has(item.month))
				byMonth.set(item.month, { month: item.month, date: parseMonthToDate(item.month) });
			const row = byMonth.get(item.month)!;
			row[item.vehicleName] = item.costPerMile;
		}
		return Array.from(byMonth.values()).sort((a, b) =>
			String(a['month']).localeCompare(String(b['month']))
		);
	});

	let costPerMileSeries = $derived(
		cpmVehicleNames.map((name, i) => ({
			key: name,
			label: name,
			color: CHART_COLORS[i % CHART_COLORS.length] as string
		}))
	);

	let costPerMileConfig = $derived(buildChartConfig(costPerMileSeries));

	// --- 6. Fill-up Patterns by Day of Week ---
	const dayPatternConfig: Chart.ChartConfig = {
		fillupCount: { label: 'Fill-ups', color: 'var(--chart-1)' }
	};

	const dayPatternSeries = [
		{ key: 'fillupCount', label: 'Fill-ups', color: CHART_COLORS[0] as string }
	];

	function parseDateString(dateStr: string): Date {
		return new Date(dateStr);
	}
</script>

<div class="space-y-6">
	<!-- Row 1: Fuel Consumption + Gas Price on Fill-up -->
	<div class="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
		<AppLineChart
			title="Fuel Consumption"
			description="Monthly MPG and gallons used"
			data={consumptionData}
			x="date"
			y={['mpg', 'gallons']}
			series={consumptionSeries}
			config={consumptionConfig}
			yAxisFormat={formatDecimalAxis}
		/>

		<AppLineChart
			title="Gas Price on Fill-up"
			description="Price per gallon by fuel type over time"
			data={gasPriceData}
			x="date"
			y={gasPriceFuelTypes}
			series={gasPriceSeries}
			config={gasPriceConfig}
			xAxisProps={{ ticks: getXTickCount(gasPriceData.length, 6), format: formatDateTick }}
		/>
	</div>

	<!-- Row 2: Fill-up Cost by Vehicle + Cost per Mile -->
	<div class="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
		<AppLineChart
			title="Fill-up Cost by Vehicle"
			description="Average fill-up cost per vehicle over time"
			data={fillupCostData}
			x="date"
			y={costVehicleNames}
			series={fillupCostSeries}
			config={fillupCostConfig}
		/>

		<AppLineChart
			title="Cost per Mile"
			description="Cost per mile trend by vehicle"
			data={costPerMileData}
			x="date"
			y={cpmVehicleNames}
			series={costPerMileSeries}
			config={costPerMileConfig}
			yAxisFormat={formatCentsAxis}
		/>
	</div>

	<!-- Row 3: Total Odometer + Fill-up Patterns by Day of Week -->
	<div class="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
		<AppAreaChart
			title="Total Odometer"
			description="Mileage progression per vehicle"
			data={odometerData}
			x="date"
			y={odometerVehicleNames}
			series={odometerSeries}
			config={odometerConfig}
			yAxisFormat={v => v.toLocaleString()}
		/>

		{#if dayOfWeekPatterns && dayOfWeekPatterns.length > 0}
			<AppBarChart
				title="Fill-up Patterns by Day of Week"
				description="When you typically fill up"
				data={dayOfWeekPatterns}
				x="day"
				y="fillupCount"
				series={dayPatternSeries}
				config={dayPatternConfig}
				height={350}
				yAxisFormat={v => String(Math.round(v))}
				xAxisProps={{
					ticks: dayOfWeekPatterns.map(d => d.day),
					format: (v: string) => (typeof v === 'string' ? v.slice(0, 3) : String(v))
				}}
			/>
		{/if}
	</div>
</div>
