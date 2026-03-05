<script lang="ts">
	import '$lib/components/analytics/line-chart-animations.css';
	import { animateOnView } from '$lib/utils/animate-on-view';
	import { LineChart } from 'layerchart';
	import * as Card from '$lib/components/ui/card';
	import * as Chart from '$lib/components/ui/chart';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import EmptyState from '$lib/components/common/empty-state.svelte';
	import {
		formatCurrencyAxis,
		CHART_PADDING,
		TREND_LINE_PROPS,
		monthlyXAxisProps
	} from '$lib/utils/chart-formatters';
	import type { Snippet } from 'svelte';

	const CHART_HEIGHT = 300;

	const chartConfig: Chart.ChartConfig = {
		amount: { label: 'Amount', color: 'var(--primary)' }
	};

	interface TrendData {
		date: Date;
		amount: number;
		[key: string]: unknown;
	}

	interface Props {
		data: TrendData[];
		title?: string;
		description?: string;
		isLoading?: boolean;
		error?: string | null;
		icon?: Snippet;
	}

	let {
		data,
		title = 'Expense Trends',
		description = 'Spending over time',
		isLoading = false,
		error = null,
		icon
	}: Props = $props();

	const series = [{ key: 'amount', label: 'Amount', color: 'var(--primary)' }];
</script>

<Card.Root>
	<Card.Header>
		<div class="flex items-center justify-between">
			<div>
				<Card.Title>{title}</Card.Title>
				<Card.Description>{description}</Card.Description>
			</div>
			{#if icon}
				<div class="rounded-lg bg-primary/10 p-2">
					{@render icon()}
				</div>
			{/if}
		</div>
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
			<div use:animateOnView={'chart-line-animated'}>
				<Chart.Container config={chartConfig} class="h-[{CHART_HEIGHT}px] w-full">
					<LineChart
						{data}
						x="date"
						y="amount"
						{series}
						padding={CHART_PADDING}
						props={{
							...TREND_LINE_PROPS,
							xAxis: monthlyXAxisProps(data.length),
							yAxis: { format: formatCurrencyAxis }
						}}
					>
						{#snippet tooltip()}
							<Chart.Tooltip hideLabel />
						{/snippet}
					</LineChart>
				</Chart.Container>
			</div>
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
