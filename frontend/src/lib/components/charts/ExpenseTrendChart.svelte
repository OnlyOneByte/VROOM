<script lang="ts">
	import { AreaChart } from 'layerchart';
	import { scaleTime } from 'd3-scale';
	import * as Card from '$lib/components/ui/card';
	import * as Chart from '$lib/components/ui/chart';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import EmptyState from '$lib/components/ui/empty-state.svelte';

	// Chart configuration constants
	const CHART_HEIGHT = 280;

	// Chart configuration for shadcn styling
	const chartConfig: Chart.ChartConfig = {
		amount: {
			label: 'Amount',
			color: 'hsl(var(--primary))'
		}
	};

	interface ExpenseTrendData {
		date: Date;
		amount: number;
		count: number;
	}

	interface Props {
		data: ExpenseTrendData[];
		period: string;
		isLoading?: boolean;
		error?: string | null;
	}

	let { data, period, isLoading = false, error = null }: Props = $props();

	// Format period label for display
	let periodLabel = $derived.by(() => {
		switch (period) {
			case '7d':
				return 'Last 7 Days';
			case '30d':
				return 'Last 30 Days';
			case '90d':
				return 'Last 90 Days';
			case '1y':
				return 'Last Year';
			case 'all':
				return 'All Time';
			default:
				return period;
		}
	});

	// Series configuration for the chart
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
		<Card.Title>Expense Trends</Card.Title>
		<Card.Description>{periodLabel}</Card.Description>
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
		{:else if data.length > 0}
			<Chart.Container config={chartConfig} class="h-[{CHART_HEIGHT}px] w-full">
				<AreaChart
					{data}
					x="date"
					xScale={scaleTime()}
					y="amount"
					{series}
					props={{
						area: {
							class: 'fill-primary/20 stroke-primary stroke-2'
						},
						xAxis: {
							format: (v: Date) => {
								return v.toLocaleDateString('en-US', {
									month: 'short',
									day: 'numeric'
								});
							}
						},
						yAxis: {
							format: (v: number) => {
								return new Intl.NumberFormat('en-US', {
									style: 'currency',
									currency: 'USD',
									minimumFractionDigits: 0,
									maximumFractionDigits: 0
								}).format(v);
							}
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
						Add expenses to see trends
					{/snippet}
				</EmptyState>
			</div>
		{/if}
	</Card.Content>
</Card.Root>
