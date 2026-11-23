<script lang="ts">
	import type * as Chart from '#lib/components/ui/chart/index.ts';
	import AppLineChart from './AppLineChart.svelte';
	import type { Snippet } from 'svelte';

	const chartConfig: Chart.ChartConfig = {
		amount: { label: 'Amount', color: 'var(--primary)' }
	};

	const series = [{ key: 'amount', label: 'Amount', color: 'var(--primary)' }];

	interface TrendData {
		date: Date;
		amount: number;
		[key: string]: unknown;
	}

	interface Props {
		data: TrendData[];
		title?: string;
		level?: 2 | 3 | 4;
		description?: string;
		isLoading?: boolean;
		error?: string | null;
		icon?: Snippet;
	}

	let {
		data,
		title = 'Expense Trends',
		level,
		description = 'Spending over time',
		isLoading = false,
		error = null,
		icon
	}: Props = $props();
</script>

<AppLineChart
	{title}
	{level}
	{description}
	{data}
	x="date"
	y="amount"
	{series}
	config={chartConfig}
	{isLoading}
	{error}
	{icon}
	emptyTitle="No expense data available"
	emptyDescription="Add expenses to see trends"
/>
