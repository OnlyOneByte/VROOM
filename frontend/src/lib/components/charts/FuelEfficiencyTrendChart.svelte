<script lang="ts">
	import './line-chart-animations.css';
	import { LineChart } from 'layerchart';
	import { scaleTime } from 'd3-scale';
	import * as Chart from '$lib/components/ui/chart';
	import ChartCard from './ChartCard.svelte';
	import {
		formatDecimalAxis,
		CHART_PADDING,
		getTrendLineProps,
		monthlyXAxisProps
	} from '$lib/utils/chart-formatters';
	import { getFuelEfficiencyLabel, getElectricEfficiencyLabel } from '$lib/utils/units';
	import type { UnitPreferences } from '$lib/types';
	import { settingsStore } from '$lib/stores/settings.svelte';

	// Chart configuration constants
	const CHART_HEIGHT = 280;
	const MIN_DATA_POINTS = 1;

	interface FuelEfficiencyData {
		date: Date;
		efficiency: number;
		mileage: number;
	}

	interface Props {
		data: FuelEfficiencyData[];
		fuelType: 'gas' | 'diesel' | 'electric' | 'hybrid';
		unitPreferences?: UnitPreferences;
		isLoading?: boolean;
		error?: string | null;
	}

	let { data, fuelType, unitPreferences, isLoading = false, error = null }: Props = $props();

	let units = $derived(unitPreferences ?? settingsStore.unitPreferences);

	// Title and unit label based on fuel type
	let title = $derived(fuelType === 'electric' ? 'Electric Efficiency' : 'Fuel Efficiency');
	let unitLabel = $derived(
		fuelType === 'electric'
			? getElectricEfficiencyLabel(units.distanceUnit, units.chargeUnit)
			: getFuelEfficiencyLabel(units.distanceUnit, units.volumeUnit)
	);
	let description = $derived(`Measured in ${unitLabel}`);

	// Chart configuration for shadcn styling
	const chartConfig: Chart.ChartConfig = {
		efficiency: {
			label: 'Efficiency',
			color: 'var(--chart-2)'
		}
	};

	// Series configuration for the chart
	const series = $derived([
		{
			key: 'efficiency',
			label: chartConfig['efficiency']?.label || 'Efficiency',
			color: chartConfig['efficiency']?.color || 'var(--chart-2)'
		}
	]);
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
	<Chart.Container config={chartConfig} class="h-[{CHART_HEIGHT}px] w-full">
		<LineChart
			{data}
			x="date"
			xScale={scaleTime()}
			y="efficiency"
			{series}
			padding={CHART_PADDING}
			props={{
				...getTrendLineProps(data.length),
				xAxis: monthlyXAxisProps(data.length),
				yAxis: {
					format: formatDecimalAxis
				}
			}}
		>
			{#snippet tooltip()}
				<Chart.Tooltip hideLabel />
			{/snippet}
		</LineChart>
	</Chart.Container>
</ChartCard>
