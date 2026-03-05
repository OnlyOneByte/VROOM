<script lang="ts">
	import './line-chart-animations.css';
	import { LineChart } from 'layerchart';
	import * as Chart from '$lib/components/ui/chart';
	import ChartCard from './ChartCard.svelte';
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

<ChartCard
	{title}
	{description}
	{isLoading}
	{error}
	isEmpty={data.length === 0}
	emptyTitle="No expense data available"
	emptyDescription="Add expenses to see trends"
	height={CHART_HEIGHT}
	{icon}
	animationClass="chart-line-animated"
>
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
</ChartCard>
