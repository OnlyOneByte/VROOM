<script lang="ts">
	import { LineChart } from 'layerchart';
	import { scaleTime } from 'd3-scale';
	import * as Card from '$lib/components/ui/card';
	import * as Chart from '$lib/components/ui/chart';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import EmptyState from '$lib/components/ui/empty-state.svelte';

	// Chart configuration constants
	const CHART_HEIGHT = 280;
	const MIN_DATA_POINTS = 2;

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

	// Description based on fuel type
	let description = $derived(
		fuelType === 'electric' ? 'Electric efficiency over time' : 'Fuel efficiency over time'
	);

	// Chart configuration for shadcn styling
	const chartConfig: Chart.ChartConfig = {
		efficiency: {
			label: 'Efficiency',
			color: 'hsl(142.1 76.2% 36.3%)' // green-600
		}
	};

	// Series configuration for the chart
	const series = $derived([
		{
			key: 'efficiency',
			label: chartConfig['efficiency']?.label || 'Efficiency',
			color: chartConfig['efficiency']?.color || 'hsl(142.1 76.2% 36.3%)'
		}
	]);
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>Fuel Efficiency Trends</Card.Title>
		<Card.Description>{description}</Card.Description>
	</Card.Header>
	<Card.Content>
		{#if isLoading}
			<Skeleton class="h-[{CHART_HEIGHT}px] w-full" />
		{:else if error}
			<div class="h-[{CHART_HEIGHT}px]">
				<EmptyState class="h-full">
					{#snippet title()}
						Failed to load chart
					{/snippet}
					{#snippet description()}
						{error}
					{/snippet}
				</EmptyState>
			</div>
		{:else if data.length >= MIN_DATA_POINTS}
			<Chart.Container config={chartConfig} class="h-[{CHART_HEIGHT}px] w-full">
				<LineChart
					{data}
					x="date"
					xScale={scaleTime()}
					y="efficiency"
					axis="x"
					{series}
					props={{
						spline: { strokeWidth: 2 },
						xAxis: {
							format: (v: Date) => {
								return v.toLocaleDateString('en-US', {
									month: 'short',
									day: 'numeric'
								});
							}
						}
					}}
				>
					{#snippet tooltip()}
						<Chart.Tooltip hideLabel />
					{/snippet}
				</LineChart>
			</Chart.Container>
		{:else}
			<div class="h-[{CHART_HEIGHT}px]">
				<EmptyState class="h-full">
					{#snippet title()}
						Insufficient fuel data
					{/snippet}
					{#snippet description()}
						Add at least {MIN_DATA_POINTS} fuel entries with mileage
					{/snippet}
				</EmptyState>
			</div>
		{/if}
	</Card.Content>
</Card.Root>
