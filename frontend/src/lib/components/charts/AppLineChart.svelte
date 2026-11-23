<script lang="ts">
	import './line-chart-animations.css';
	import { LineChart, Points } from 'layerchart';
	import * as Chart from '#lib/components/ui/chart/index.ts';
	import ChartCard from './ChartCard.svelte';
	import ChartLegend from './ChartLegend.svelte';
	import {
		formatCurrencyAxis,
		formatCurrencyTooltip,
		formatMonthLabel,
		type TooltipValueFormat,
		CHART_PADDING,
		distinctYTicks,
		TIME_X_PADDING,
		insetTimeTicks,
		getTrendLineProps,
		monthlyXAxisProps,
		SINGLE_POINT_PROPS,
		isolatedValueRows
	} from '#lib/utils/chart-formatters.ts';
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
		emptyTitle?: string;
		emptyDescription?: string;
		onRetry?: () => unknown;
		icon?: Snippet;
		height?: number;
		xAxisProps?: Record<string, unknown>;
		yAxisFormat?: (_v: number) => string;
		tooltipFormat?: TooltipValueFormat;
		tooltipLabelFormat?: (_v: unknown) => string;
		lineProps?: Record<string, unknown>;
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
		emptyTitle,
		emptyDescription,
		onRetry,
		icon,
		height = 300,
		xAxisProps,
		yAxisFormat = formatCurrencyAxis,
		tooltipFormat = formatCurrencyTooltip,
		tooltipLabelFormat = formatMonthLabel,
		lineProps,
		yDomain,
		class: className
	}: Props = $props();

	let isEmpty = $derived(data.length === 0);
	let resolvedXAxisProps = $derived(xAxisProps ?? monthlyXAxisProps(data.length));
	let isolatedValues = $derived(
		isolatedValueRows(
			data,
			series.map(s => s.key)
		)
	);
</script>

<ChartCard
	{title}
	{description}
	{isLoading}
	{error}
	{onRetry}
	{isEmpty}
	{emptyTitle}
	{emptyDescription}
	{icon}
	{height}
	animationClass="chart-line-animated"
	class={className}
>
	<div style="height: {height}px">
		<Chart.Container {config} class="h-full w-full">
			<LineChart
				{data}
				{x}
				{y}
				{series}
				{yDomain}
				padding={CHART_PADDING}
				xPadding={TIME_X_PADDING}
				props={{
					...getTrendLineProps(data.length),
					...lineProps,
					xAxis: { ...resolvedXAxisProps, ticks: insetTimeTicks(resolvedXAxisProps['ticks']) },
					yAxis: {
						format: yAxisFormat,
						ticks: distinctYTicks(yAxisFormat, height - CHART_PADDING.top - CHART_PADDING.bottom)
					}
				}}
			>
				{#snippet points()}
					{#each isolatedValues as isolated (isolated.key)}
						<Points
							seriesKey={isolated.key}
							data={isolated.rows}
							stroke="var(--color-surface-100, light-dark(white, black))"
							{...SINGLE_POINT_PROPS}
						/>
					{/each}
				{/snippet}
				{#snippet tooltip()}
					<Chart.Tooltip labelFormatter={tooltipLabelFormat} valueFormatter={tooltipFormat} />
				{/snippet}
			</LineChart>
		</Chart.Container>
	</div>
	{#snippet legend()}
		{#if series.length > 1}
			<ChartLegend items={series} class="mt-3 justify-center" />
		{/if}
	{/snippet}
</ChartCard>
