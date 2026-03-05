<script lang="ts">
	import './line-chart-animations.css';
	import { AreaChart } from 'layerchart';
	import * as Chart from '$lib/components/ui/chart';
	import ChartCard from './ChartCard.svelte';
	import ChartLegend from './ChartLegend.svelte';
	import {
		formatCurrencyAxis,
		CHART_PADDING,
		SMOOTH_CURVE,
		monthlyXAxisProps
	} from '$lib/utils/chart-formatters';
	import type { Snippet } from 'svelte';

	interface LegendItem {
		key: string;
		label: string;
		color: string;
	}

	interface Props {
		title: string;
		description?: string;
		data: Record<string, unknown>[];
		x: string;
		y: string[];
		series: LegendItem[];
		config: Chart.ChartConfig;
		isLoading?: boolean;
		error?: string | null;
		icon?: Snippet;
		height?: number;
		seriesLayout?: 'stack' | 'overlap';
		xAxisProps?: Record<string, unknown>;
		yAxisFormat?: (_v: number) => string;
		class?: string;
	}

	let {
		title,
		description,
		data,
		x,
		y,
		series,
		config,
		isLoading = false,
		error = null,
		icon,
		height = 300,
		seriesLayout,
		xAxisProps,
		yAxisFormat = formatCurrencyAxis,
		class: className
	}: Props = $props();

	let isEmpty = $derived(data.length === 0);
	let resolvedXAxisProps = $derived(xAxisProps ?? monthlyXAxisProps(data.length));
</script>

<ChartCard
	{title}
	{description}
	{isLoading}
	{error}
	{isEmpty}
	{icon}
	{height}
	animationClass="chart-line-animated"
	class={className}
>
	{#snippet children()}
		<Chart.Container {config} class="h-full w-full">
			<AreaChart
				{data}
				{x}
				{y}
				{series}
				{seriesLayout}
				padding={CHART_PADDING}
				props={{
					area: { curve: SMOOTH_CURVE, opacity: 0.3 },
					xAxis: resolvedXAxisProps,
					yAxis: { format: yAxisFormat }
				}}
			>
				{#snippet tooltip()}
					<Chart.Tooltip hideLabel />
				{/snippet}
			</AreaChart>
		</Chart.Container>
		{#if series.length > 1}
			<ChartLegend items={series} class="mt-3 justify-center" />
		{/if}
	{/snippet}
</ChartCard>
