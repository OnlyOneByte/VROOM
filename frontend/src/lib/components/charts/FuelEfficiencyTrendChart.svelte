<script lang="ts">
	import './line-chart-animations.css';
	import { LineChart } from 'layerchart';
	import { scaleTime } from 'd3-scale';
	import * as Chart from '#lib/components/ui/chart/index.ts';
	import ChartCard from './ChartCard.svelte';
	import {
		formatDecimalAxis,
		formatDayLabel,
		unitTooltip,
		CHART_PADDING,
		TIME_X_PADDING,
		insetTimeTicks,
		getTrendLineProps,
		monthlyXAxisProps
	} from '#lib/utils/chart-formatters.ts';
	import { getFuelEfficiencyLabel, getElectricEfficiencyLabel } from '#lib/utils/units.ts';
	import type { UnitPreferences, VehicleType } from '#lib/types/index.ts';
	import { settingsStore } from '#lib/stores/settings.svelte.ts';

	const CHART_HEIGHT = 280;
	const MIN_DATA_POINTS = 1;

	interface FuelEfficiencyData {
		date: Date;
		efficiency: number;
		mileage: number;
	}

	interface Props {
		data: FuelEfficiencyData[];
		fuelType: VehicleType;
		unitPreferences?: UnitPreferences;
		isLoading?: boolean;
		error?: string | null;
	}

	let { data, fuelType, unitPreferences, isLoading = false, error = null }: Props = $props();

	let units = $derived(unitPreferences ?? settingsStore.unitPreferences);

	let title = $derived(fuelType === 'electric' ? 'Electric Efficiency' : 'Fuel Efficiency');
	let unitLabel = $derived(
		fuelType === 'electric'
			? getElectricEfficiencyLabel(units.distanceUnit, units.chargeUnit)
			: getFuelEfficiencyLabel(units.distanceUnit, units.volumeUnit)
	);
	let description = $derived(`Measured in ${unitLabel}`);
	let tooltipFormat = $derived(unitTooltip(unitLabel));

	const chartConfig: Chart.ChartConfig = {
		efficiency: {
			label: 'Efficiency',
			color: 'var(--chart-2)'
		}
	};

	const series = $derived([
		{
			key: 'efficiency',
			label: chartConfig['efficiency']?.label || 'Efficiency',
			color: chartConfig['efficiency']?.color || 'var(--chart-2)'
		}
	]);
	let xAxisProps = $derived(monthlyXAxisProps(data.length));
</script>

<ChartCard
	{title}
	{description}
	{isLoading}
	{error}
	isEmpty={data.length < MIN_DATA_POINTS}
	emptyTitle="Insufficient fuel data"
	emptyDescription="Add at least 2 fuel entries with mileage and volume to calculate efficiency"
	height={CHART_HEIGHT}
	animationClass="chart-line-animated"
>
	<div style="height: {CHART_HEIGHT}px">
		<Chart.Container config={chartConfig} class="h-full w-full">
			<LineChart
				{data}
				x="date"
				xScale={scaleTime()}
				y="efficiency"
				{series}
				points={data.length === 1}
				padding={CHART_PADDING}
				xPadding={TIME_X_PADDING}
				props={{
					...getTrendLineProps(data.length),
					xAxis: { ...xAxisProps, ticks: insetTimeTicks(xAxisProps.ticks) },
					yAxis: {
						format: formatDecimalAxis
					}
				}}
			>
				{#snippet tooltip()}
					<Chart.Tooltip labelFormatter={formatDayLabel} valueFormatter={tooltipFormat} />
				{/snippet}
			</LineChart>
		</Chart.Container>
	</div>
</ChartCard>
