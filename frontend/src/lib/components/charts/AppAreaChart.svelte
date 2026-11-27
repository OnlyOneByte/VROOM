<script lang="ts">
	import './line-chart-animations.css';
	import { AreaChart, Points } from 'layerchart';
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
		TIME_X_PADDING,
		insetTimeTicks,
		SMOOTH_CURVE,
		monthlyXAxisProps,
		SINGLE_POINT_PROPS,
		isolatedValueRows
	} from '#lib/utils/chart-formatters.ts';
	import type { Snippet } from 'svelte';
	import type { ChartState, TextProps } from 'layerchart';
	import EdgeTickLabel from './EdgeTickLabel.svelte';
	import { buildChartA11y, type ChartSelectHandler } from './chart-a11y.ts';
	import { guideTicks } from './guides.ts';

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
		tooltipFormat?: TooltipValueFormat;
		tooltipLabelFormat?: (_v: unknown) => string;
		categoryLabel?: string;
		onSelect?: ChartSelectHandler;
		insight?: string;
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
		seriesLayout,
		xAxisProps,
		yAxisFormat = formatCurrencyAxis,
		tooltipFormat = formatCurrencyTooltip,
		tooltipLabelFormat = formatMonthLabel,
		categoryLabel,
		onSelect,
		insight,
		class: className
	}: Props = $props();

	let isEmpty = $derived(data.length === 0);
	let context = $state<ChartState<Record<string, unknown>>>();
	let a11y = $derived(
		buildChartA11y({
			title,
			description,
			data,
			categoryKey: x,
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
	let resolvedXAxisProps = $derived(xAxisProps ?? monthlyXAxisProps(data.length));
	let yTicks = $derived(guideTicks(yAxisFormat));
	let isolatedValues = $derived(
		isolatedValueRows(
			data,
			series.map(s => s.key)
		)
	);
</script>

{#snippet edgeTickLabel({ props }: { props: TextProps })}
	<EdgeTickLabel {props} />
{/snippet}

<ChartCard
	{title}
	{level}
	{description}
	{isLoading}
	{error}
	{isEmpty}
	{icon}
	{height}
	animationClass="chart-line-animated"
	table={a11y}
	{insight}
	class={className}
>
	<ChartPlot
		{a11y}
		onStep={showRow}
		onSelect={onSelect ? i => onSelect(data[i]!, null) : undefined}
	>
		<div style="height: {height}px">
			<Chart.Container {config} class="h-full w-full">
				<AreaChart
					bind:context
					{data}
					{x}
					{y}
					{series}
					{seriesLayout}
					padding={CHART_PADDING}
					xPadding={TIME_X_PADDING}
					props={{
						area: { curve: SMOOTH_CURVE, opacity: 0.3 },
						xAxis: {
							...resolvedXAxisProps,
							ticks: insetTimeTicks(resolvedXAxisProps['ticks']),
							tickLabel: edgeTickLabel
						},
						yAxis: { format: yAxisFormat, ticks: yTicks },
						grid: { yTicks }
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
				</AreaChart>
			</Chart.Container>
		</div>
	</ChartPlot>
	{#snippet legend()}
		{#if series.length > 1}
			<ChartLegend items={series} class="mt-3 justify-center" />
		{/if}
	{/snippet}
</ChartCard>
