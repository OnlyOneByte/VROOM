<script lang="ts">
	import './line-chart-animations.css';
	import { LineChart } from 'layerchart';
	import { scaleTime } from 'd3-scale';
	import * as Chart from '$lib/components/ui/chart';
	import ChartCard from './ChartCard.svelte';
	import {
		formatDecimalAxis,
		CHART_PADDING,
		TREND_LINE_PROPS,
		monthlyXAxisProps
	} from '$lib/utils/chart-formatters';

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
		isLoading?: boolean;
		error?: string | null;
	}

	let { data, fuelType, isLoading = false, error = null }: Props = $props();

	// Title and unit label based on fuel type
	let title = $derived(fuelType === 'electric' ? 'Electric Efficiency' : 'Fuel Efficiency');
	let unitLabel = $derived(fuelType === 'electric' ? 'mi/kWh' : 'MPG');
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
				...TREND_LINE_PROPS,
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
