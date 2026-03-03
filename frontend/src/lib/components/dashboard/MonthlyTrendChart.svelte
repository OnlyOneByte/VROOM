<script lang="ts">
	import { AreaChart } from 'layerchart';
	import { scaleTime } from 'd3-scale';
	import * as Card from '$lib/components/ui/card';
	import * as Chart from '$lib/components/ui/chart';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import EmptyState from '$lib/components/common/empty-state.svelte';
	import { TrendingUp } from 'lucide-svelte';
	import { formatMonthYear, formatCurrencyAxis, getXTickCount } from '$lib/utils/chart-formatters';

	const CHART_HEIGHT = 320;

	const chartConfig: Chart.ChartConfig = {
		amount: {
			label: 'Amount',
			color: 'hsl(var(--primary))'
		}
	};

	interface TrendData {
		date: Date;
		amount: number;
	}

	interface Props {
		data: TrendData[];
		isLoading?: boolean;
	}

	let { data, isLoading = false }: Props = $props();

	// Limit ticks to the number of data points to avoid duplicate month labels
	let xTickCount = $derived(getXTickCount(data.length));

	const series = $derived([
		{
			key: 'amount',
			label: chartConfig['amount']?.label || 'Amount',
			color: chartConfig['amount']?.color || 'hsl(var(--primary))'
		}
	]);
</script>

<Card.Root>
	<Card.Header>
		<div class="flex items-center justify-between">
			<div>
				<Card.Title>Monthly Expense Trends</Card.Title>
				<Card.Description>Spending over time</Card.Description>
			</div>
			<div class="p-2 rounded-lg bg-primary/10">
				<TrendingUp class="h-5 w-5 text-primary" />
			</div>
		</div>
	</Card.Header>
	<Card.Content>
		{#if isLoading}
			<Skeleton class="h-[{CHART_HEIGHT}px] w-full" />
		{:else if data.length > 0}
			<Chart.Container config={chartConfig} class="h-[{CHART_HEIGHT}px] w-full">
				<AreaChart
					{data}
					x="date"
					xScale={scaleTime()}
					y="amount"
					{series}
					padding={{ top: 4, left: 48, bottom: 20, right: 4 }}
					props={{
						area: {
							class: 'fill-primary/20 stroke-primary stroke-2'
						},
						xAxis: {
							ticks: xTickCount,
							format: formatMonthYear
						},
						yAxis: {
							format: formatCurrencyAxis
						}
					}}
				>
					{#snippet tooltip()}
						<Chart.Tooltip hideLabel />
					{/snippet}
				</AreaChart>
			</Chart.Container>
		{:else}
			<div class="h-[{CHART_HEIGHT}px]">
				<EmptyState class="h-full">
					{#snippet title()}
						No expense data available
					{/snippet}
					{#snippet description()}
						Add expenses to see monthly trends
					{/snippet}
				</EmptyState>
			</div>
		{/if}
	</Card.Content>
</Card.Root>
