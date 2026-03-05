<script lang="ts">
	import './bar-chart-animations.css';
	import { BarChart } from 'layerchart';
	import * as Chart from '$lib/components/ui/chart';
	import ChartCard from './ChartCard.svelte';
	import ChartLegend from './ChartLegend.svelte';
	import {
		formatCurrencyAxis,
		CHART_PADDING,
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
		y: string | string[];
		series: LegendItem[];
		config: Chart.ChartConfig;
		isLoading?: boolean;
		error?: string | null;
		icon?: Snippet;
		height?: number;
		orientation?: 'vertical' | 'horizontal';
		seriesLayout?: 'group' | 'stack';
		xAxisProps?: Record<string, unknown>;
		yAxisFormat?: (_v: number) => string;
		barProps?: Record<string, unknown>;
		yDomain?: [number, number];
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
		orientation = 'vertical',
		seriesLayout,
		xAxisProps,
		yAxisFormat = formatCurrencyAxis,
		barProps,
		yDomain,
		class: className
	}: Props = $props();

	let isEmpty = $derived(data.length === 0);
	let resolvedPadding = $derived(
		seriesLayout === 'stack' ? { ...CHART_PADDING, top: 16 } : CHART_PADDING
	);
	let resolvedXAxisProps = $derived(xAxisProps ?? monthlyXAxisProps(data.length));
</script>

<ChartCard
	{title}
	{description}
	{isLoading}
	{error}
	{isEmpty}
	{icon}
	height={series.length > 1 ? undefined : height}
	animationClass="chart-bar-animated"
	class={className}
>
	<div style="height: {height}px">
		<Chart.Container {config} class="h-full w-full">
			<BarChart
				{data}
				{x}
				{y}
				{series}
				{orientation}
				{seriesLayout}
				{yDomain}
				padding={resolvedPadding}
				props={{
					bars: { stroke: 'none' },
					...barProps,
					xAxis: resolvedXAxisProps,
					yAxis: { format: yAxisFormat }
				}}
			>
				{#snippet tooltip()}
					<Chart.Tooltip hideLabel />
				{/snippet}
			</BarChart>
		</Chart.Container>
	</div>
	{#if series.length > 1}
		<ChartLegend items={series} class="mt-3 justify-center" />
	{/if}
</ChartCard>
