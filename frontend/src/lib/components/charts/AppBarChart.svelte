<script lang="ts">
	import './bar-chart-animations.css';
	import { Bar, BarChart, Rule, Text } from 'layerchart';
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
	import type { ChartAnnotations } from './types.ts';
	import { columnWidth } from './bar-columns.ts';

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
		hiddenKeys?: readonly string[];
		onToggleSeries?: (_key: string) => void;
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
		annotations?: ChartAnnotations;
		current?: unknown;
		referenceLines?: ReferenceLine[];
		valueLabels?: boolean;
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
		annotations,
		current,
		referenceLines = [],
		valueLabels = true,
		insight,
		class: className
	}: Props = $props();

	const COLUMN_RADIUS = 6;

	let series = $derived(
		hiddenKeys?.length ? legendItems.filter(s => !hiddenKeys.includes(s.key)) : legendItems
	);

	let stacked = $derived(seriesLayout === 'stack' && series.length > 1);

	function isStackTop(row: Record<string, unknown>, index: number): boolean {
		return series.slice(index + 1).every(s => !(Number(row[s.key]) > 0));
	}

	let plottedSeries = $derived(
		stacked
			? series.map((s, i) => ({
					...s,
					props: {
						rounded: (row: Record<string, unknown>) => (isStackTop(row, i) ? 'top' : 'none')
					}
				}))
			: series
	);

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
			valueFormat: tooltipFormat,
			notes: referenceLines.map(
				line => `${line.label}: ${tooltipFormat(line.value, series[0]?.key ?? '')}.`
			)
		})
	);

	let vertical = $derived(orientation === 'vertical');
	let valueAccessor = $derived(vertical ? y : x);
	let categoryKey = $derived(vertical || typeof y !== 'string' ? x : y);
	let valueKey = $derived(
		typeof valueAccessor === 'string'
			? valueAccessor
			: series.length === 1
				? series[0]?.key
				: undefined
	);
	let singleSeries = $derived(series.length === 1 && valueKey !== undefined);
	let grouped = $derived(series.length > 1 && seriesLayout !== 'stack');
	let fixedWidth = $derived(
		vertical ? columnWidth(context?.xScale?.bandwidth?.(), grouped) : undefined
	);
	let barSize = $derived(fixedWidth ? { width: fixedWidth } : vertical ? {} : { height: 10 });

	function sameBucket(a: unknown, b: unknown): boolean {
		if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
		return a === b;
	}

	let currentRow = $derived(
		current === undefined ? undefined : data.find(row => sameBucket(row[categoryKey], current))
	);

	let peakRow = $derived.by(() => {
		if (!singleSeries || !valueKey) return undefined;
		let peak: Record<string, unknown> | undefined;
		for (const row of data) {
			const value = Number(row[valueKey]);
			if (Number.isFinite(value) && value > 0 && (!peak || value > Number(peak[valueKey]))) {
				peak = row;
			}
		}
		return peak;
	});

	let labelRows = $derived(
		valueLabels && vertical && singleSeries
			? [...new Set([peakRow, currentRow].filter(row => row !== undefined))]
			: []
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
	events={annotations}
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
		<div style="height: {height}px" bind:clientWidth={plotWidth}>
			<Chart.Container {config} class="h-full w-full">
				<BarChart
					bind:context
					onTooltipClick={onSelect ? (_event, detail) => onSelect(detail.data, null) : undefined}
					{data}
					{x}
					{y}
					series={plottedSeries}
					{orientation}
					{seriesLayout}
					{yDomain}
					padding={resolvedPadding}
					props={{
						bars: {
							stroke: 'none',
							rounded: stacked ? 'none' : 'edge',
							radius: vertical ? COLUMN_RADIUS : 5,
							...barSize
						},
						...barProps,
						xAxis: resolvedXAxisProps,
						yAxis: {
							format: yAxisFormat,
							...(orientation === 'vertical' && { ticks: yTicks })
						},
						...(orientation === 'vertical' && { grid: { yTicks } })
					}}
				>
					{#snippet aboveMarks({ context: chart })}
						{#if currentRow && singleSeries && valueKey}
							<Bar
								data={currentRow}
								{...vertical ? { y: valueKey } : { x: valueKey }}
								fill="var(--foreground)"
								stroke="none"
								rounded="edge"
								radius={vertical ? COLUMN_RADIUS : 5}
								{...barSize}
								data-current-period
							/>
						{/if}
						{#each referenceLines as line, i (`${i}-${line.label}`)}
							<Rule
								{...vertical ? { y: line.value } : { x: line.value }}
								dashArray="4 4"
								style="stroke: var(--muted-foreground); stroke-width: 1.5px"
								data-reference-line
							/>
							{#if vertical}
								<Text
									x={chart.width}
									y={chart.yScale(line.value) - 6}
									value="{line.label} {yAxisFormat(line.value)}"
									textAnchor="end"
									stroke="var(--card)"
									strokeWidth={4}
									style="paint-order: stroke"
									class="fill-muted-foreground text-xs"
									data-reference-label
								/>
							{/if}
						{/each}
						{#if valueKey}
							{#each labelRows as row, i (i)}
								<Text
									x={(chart.xScale(row[x]) ?? 0) + (chart.xScale.bandwidth?.() ?? 0) / 2}
									y={chart.yScale(Number(row[valueKey])) - 6}
									value={yAxisFormat(Number(row[valueKey]))}
									textAnchor="middle"
									class="fill-foreground text-xs font-semibold"
									data-value-label
								/>
							{/each}
						{/if}
					{/snippet}
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
		{#if !vertical && referenceLines.length > 0}
			<ul class="mt-3 flex flex-wrap justify-center gap-3" aria-label="Reference lines">
				{#each referenceLines as line, i (`${i}-${line.label}`)}
					<li class="flex items-center gap-1.5 text-xs text-muted-foreground">
						<span class="w-4 border-t-2 border-dashed border-muted-foreground" aria-hidden="true"
						></span>
						{line.label}: {yAxisFormat(line.value)}
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
		{@render footer?.()}
	{/snippet}
</ChartCard>
