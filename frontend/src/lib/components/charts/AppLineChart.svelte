<script lang="ts">
	import './line-chart-animations.css';
	import { Area, LineChart, Points, Rule } from 'layerchart';
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
		getTrendLineProps,
		monthlyXAxisProps,
		SINGLE_POINT_PROPS,
		SMOOTH_CURVE,
		isolatedValueRows
	} from '#lib/utils/chart-formatters.ts';
	import type { Snippet } from 'svelte';
	import type { ChartState } from 'layerchart';
	import { buildChartA11y, type ChartSelectHandler } from './chart-a11y.ts';
	import type { ChartAnnotations } from './types.ts';
	import { guideTicks } from './guides.ts';
	import { curveLinear } from 'd3-shape';

	interface LegendItem {
		key: string;
		label: string;
		color: string;
		value?: string;
		data?: Record<string, unknown>[];
	}

	interface Props {
		title: string;
		level?: 2 | 3 | 4;
		description?: string;
		data: Record<string, unknown>[];
		x: string;
		y: string | string[];
		series: LegendItem[];
		hiddenKeys?: readonly string[];
		onToggleSeries?: (_key: string) => void;
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
		categoryLabel?: string;
		onSelect?: ChartSelectHandler;
		annotations?: ChartAnnotations;
		band?: { from: string; to: string };
		referenceLines?: ReferenceLine[];
		summary?: Snippet;
		footer?: Snippet;
		insight?: string;
		class?: string;
	}

	interface ReferenceLine {
		value: number;
		label: string;
	}

	let {
		title,
		level,
		description,
		data,
		x,
		y,
		series: legendItems,
		hiddenKeys,
		onToggleSeries,
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
		categoryLabel,
		onSelect,
		annotations,
		band,
		referenceLines = [],
		summary,
		footer,
		insight,
		class: className
	}: Props = $props();

	let series = $derived(
		hiddenKeys?.length ? legendItems.filter(s => !hiddenKeys.includes(s.key)) : legendItems
	);

	let bandLabel = $derived.by(() => {
		if (!band) return '';
		const name = (key: string) => legendItems.find(s => s.key === key)?.label ?? key;
		return `${name(band.from)} and ${name(band.to)}`;
	});

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
			valueFormat: tooltipFormat,
			notes: [
				...referenceLines.map(
					line => `${line.label}: ${tooltipFormat(line.value, series[0]?.key ?? '')}.`
				),
				...(bandLabel ? [`The shaded area is the gap between ${bandLabel}.`] : [])
			]
		})
	);

	function showRow(index: number | null) {
		const row = index === null ? undefined : data[index];
		if (row) context?.tooltip.show({ data: row });
		else context?.tooltip.hide();
	}
	let resolvedXAxisProps = $derived(xAxisProps ?? monthlyXAxisProps(data.length));
	let yTicks = $derived(guideTicks(yAxisFormat));
	let trendProps = $derived.by(() => {
		const base = getTrendLineProps(data.length);
		return data.length > 1 ? { ...base, spline: { curve: curveLinear, strokeWidth: 2.4 } } : base;
	});
	let isolatedValues = $derived(series.flatMap(s => isolatedValueRows(s.data ?? data, [s.key])));
</script>

{#snippet bandMarks()}
	{#if band}
		{@const { from, to } = band}
		<Area
			y0={(d: Record<string, unknown>) => d[from]}
			y1={(d: Record<string, unknown>) => d[to]}
			defined={(d: Record<string, unknown>) => d[from] != null && d[to] != null}
			curve={SMOOTH_CURVE}
			fill="var(--chart-4)"
			class="[fill-opacity:0.18]"
			data-band
		/>
	{/if}
{/snippet}

<ChartCard
	{title}
	{level}
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
	table={a11y}
	events={annotations}
	{summary}
	{footer}
	{insight}
	class={className}
>
	{#if annotations}{#await import('./AnnotationLane.svelte')}<div
				class="mb-1 h-6"
			></div>{:then { default: AnnotationLane }}<AnnotationLane
				{annotations}
				{context}
			/>{/await}{/if}<ChartPlot
		{a11y}
		onStep={showRow}
		onSelect={onSelect ? i => onSelect(data[i]!, null) : undefined}
	>
		<div style="height: {height}px">
			<Chart.Container {config} class="h-full w-full">
				<LineChart
					bind:context
					onTooltipClick={onSelect ? (_event, detail) => onSelect(detail.data, null) : undefined}
					{data}
					{x}
					{y}
					{series}
					{yDomain}
					belowMarks={band ? bandMarks : undefined}
					padding={CHART_PADDING}
					xPadding={TIME_X_PADDING}
					props={{
						...trendProps,
						...lineProps,
						xAxis: { ...resolvedXAxisProps, ticks: insetTimeTicks(resolvedXAxisProps['ticks']) },
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
					{#snippet aboveMarks()}
						{#each referenceLines as line, i (`${i}-${line.label}`)}
							<Rule
								y={line.value}
								dashArray="4 4"
								style="stroke: var(--muted-foreground); stroke-width: 1.5px"
								data-reference-line
							/>
						{/each}
					{/snippet}
					{#snippet tooltip()}
						<Chart.Tooltip labelFormatter={tooltipLabelFormat} valueFormatter={tooltipFormat} />
					{/snippet}
				</LineChart>
			</Chart.Container>
		</div>
	</ChartPlot>
	{#snippet legend()}
		{#if referenceLines.length > 0}
			<ul class="mt-3 flex flex-wrap justify-center gap-3" aria-label="Reference lines">
				{#each referenceLines as line, i (`${i}-${line.label}`)}
					<li class="flex items-center gap-1.5 text-xs text-muted-foreground">
						<span class="w-4 border-t-2 border-dashed border-muted-foreground" aria-hidden="true"
						></span>
						{line.label}: {tooltipFormat(line.value, series[0]?.key ?? '')}
					</li>
				{/each}
			</ul>
		{/if}
		{#if legendItems.length > 1}
			<ChartLegend
				items={legendItems}
				{hiddenKeys}
				onToggle={onToggleSeries}
				class="mt-3 justify-center"
			/>
		{/if}
	{/snippet}
</ChartCard>
