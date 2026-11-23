<script lang="ts">
	import './bar-chart-animations.css';
	import { BarChart } from 'layerchart';
	import * as Chart from '#lib/components/ui/chart/index.ts';
	import ChartCard from './ChartCard.svelte';
	import ChartPlot from './ChartPlot.svelte';
	import ChartLegend from './ChartLegend.svelte';
	import {
		formatCurrencyAxis,
		formatCurrencyTooltip,
		formatMonthLabel,
		type TooltipValueFormat,
		CHART_PADDING,
		distinctYTicks,
		monthlyXAxisProps
	} from '#lib/utils/chart-formatters.ts';
	import type { Snippet } from 'svelte';
	import type { ChartState } from 'layerchart';
	import { buildChartA11y, type ChartSelectHandler } from './chart-a11y.ts';

	interface LegendItem {
		key: string;
		label: string;
		color: string;
	}

	interface Props {
		title: string;
		level?: 2 | 3 | 4;
		description?: string;
		data: Record<string, unknown>[];
		x: string;
		y?: string | string[];
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
		tooltipFormat?: TooltipValueFormat;
		tooltipLabelFormat?: (_v: unknown) => string;
		barProps?: Record<string, unknown>;
		yDomain?: [number, number];
		padding?: { top: number; left: number; bottom: number; right: number };
		plotWidth?: number;
		footer?: Snippet;
		categoryLabel?: string;
		onSelect?: ChartSelectHandler;
		class?: string;
	}

	let {
		title,
		level,
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
		tooltipFormat = formatCurrencyTooltip,
		tooltipLabelFormat = formatMonthLabel,
		barProps,
		yDomain,
		padding,
		plotWidth = $bindable(0),
		footer,
		categoryLabel,
		onSelect,
		class: className
	}: Props = $props();

	let isEmpty = $derived(data.length === 0);
	let context = $state<ChartState<Record<string, unknown>>>();
	let a11y = $derived(
		buildChartA11y({
			title,
			description,
			data,
			categoryKey: orientation === 'horizontal' && typeof y === 'string' ? y : x,
			categoryLabel,
			series,
			labelFormat: tooltipLabelFormat,
			valueFormat: tooltipFormat
		})
	);

	function showRow(index: number | null) {
		const row = index === null ? undefined : data[index];
		if (row) context?.tooltip.show({ data: row });
		else context?.tooltip.hide();
	}
	let resolvedPadding = $derived(
		padding ?? (seriesLayout === 'stack' ? { ...CHART_PADDING, top: 16 } : CHART_PADDING)
	);
	let resolvedXAxisProps = $derived(xAxisProps ?? monthlyXAxisProps(data.length));
	let yTicks = $derived(
		distinctYTicks(yAxisFormat, height - resolvedPadding.top - resolvedPadding.bottom)
	);
</script>

<ChartCard
	{title}
	{level}
	{description}
	{isLoading}
	{error}
	{isEmpty}
	{icon}
	{height}
	animationClass="chart-bar-animated"
	table={a11y}
	class={className}
>
	<ChartPlot
		{a11y}
		onStep={showRow}
		onSelect={onSelect ? i => onSelect(data[i]!, null) : undefined}
	>
		<div style="height: {height}px" bind:clientWidth={plotWidth}>
			<Chart.Container {config} class="h-full w-full">
				<BarChart
					bind:context
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
						yAxis: {
							format: yAxisFormat,
							...(orientation === 'vertical' && { ticks: yTicks })
						},
						...(orientation === 'vertical' && { grid: { yTicks } })
					}}
				>
					{#snippet tooltip()}
						<Chart.Tooltip
							labelAxis={orientation === 'horizontal' ? 'y' : 'x'}
							labelFormatter={tooltipLabelFormat}
							valueFormatter={tooltipFormat}
						/>
					{/snippet}
				</BarChart>
			</Chart.Container>
		</div>
	</ChartPlot>
	{#snippet legend()}
		{#if series.length > 1}
			<ChartLegend items={series} class="mt-3 justify-center" />
		{/if}
		{@render footer?.()}
	{/snippet}
</ChartCard>
