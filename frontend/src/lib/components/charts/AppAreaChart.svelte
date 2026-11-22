<script lang="ts">
	import './line-chart-animations.css';
	import { AreaChart, Points } from 'layerchart';
	import * as Chart from '#lib/components/ui/chart/index.ts';
	import ChartCard from './ChartCard.svelte';
	import ChartLegend from './ChartLegend.svelte';
	import {
		formatCurrencyAxis,
		formatCurrencyTooltip,
		formatMonthLabel,
		type TooltipValueFormat,
		CHART_PADDING,
		SMOOTH_CURVE,
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
		tooltipFormat = formatCurrencyTooltip,
		tooltipLabelFormat = formatMonthLabel,
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
	{isEmpty}
	{icon}
	{height}
	animationClass="chart-line-animated"
	class={className}
>
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
	{#if series.length > 1}
		<ChartLegend items={series} class="mt-3 justify-center" />
	{/if}
</ChartCard>
