<script lang="ts">
	import { ChartColumn, RotateCcw, SearchX } from '@lucide/svelte';
	import LoadErrorCard from '#lib/components/common/LoadErrorCard.svelte';
	import EmptyState from '#lib/components/common/empty-state.svelte';
	import StatCardGrid from '#lib/components/charts/StatCardGrid.svelte';
	import { AppBarChart, AppLineChart } from '#lib/components/charts/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
	import { IsMobile } from '#lib/hooks/is-mobile.svelte.ts';
	import { analyticsApi } from '#lib/services/analytics-api.ts';
	import { settingsStore } from '#lib/stores/settings.svelte.ts';
	import type { AnalyticsQueryResponse } from '#lib/types/index.ts';
	import { buildChartConfig } from '#lib/utils/chart-colors.ts';
	import { userFacingErrorMessage } from '#lib/utils/error-handling.ts';
	import { getDistanceUnitLabel } from '#lib/utils/units.ts';
	import type { AnalyticsDateRange } from '../analytics-filters';
	import QueryBar from './QueryBar.svelte';
	import {
		DEFAULT_EXPLORE,
		EXPLORE_COMPARES,
		EXPLORE_INTERVALS,
		EXPLORE_PRESETS,
		activePreset,
		apiQuery,
		applyPreset,
		chartForm,
		describeQuery,
		type ExploreQuery
	} from './query-state';
	import {
		bucketDate,
		bucketLabel,
		bucketTotals,
		hasData,
		isAdditive,
		kpis,
		percentChange,
		queryCache,
		seriesFor,
		valueFormatter
	} from './explore-data';

	interface Props {
		query: ExploreQuery;
		onQueryChange: (_query: ExploreQuery) => void;
		dateRange: AnalyticsDateRange;
		vehicleIds?: string[];
		vehicleColors?: Record<string, string>;
		filterLabel?: string;
		onClearFilters?: () => void;
	}

	let {
		query,
		onQueryChange,
		dateRange,
		vehicleIds,
		vehicleColors,
		filterLabel,
		onClearFilters
	}: Props = $props();

	let response = $state<AnalyticsQueryResponse | null>(null);
	let isLoading = $state(true);
	let error = $state<string | null>(null);
	let controller: AbortController | null = null;

	let request = $derived({
		...apiQuery(query),
		start: dateRange.startDate,
		end: dateRange.endDate,
		vehicleIds
	});
	let requestKey = $derived(JSON.stringify(request));

	async function load(params: typeof request, key: string) {
		controller?.abort();
		const cached = queryCache.get(key);
		if (cached) {
			response = cached;
			isLoading = false;
			error = null;
			return;
		}
		const current = new AbortController();
		controller = current;
		isLoading = true;
		try {
			const result = await analyticsApi.query(params, { signal: current.signal });
			if (current.signal.aborted) return;
			queryCache.set(key, result);
			response = result;
			error = null;
		} catch (e) {
			if (current.signal.aborted) return;
			error = userFacingErrorMessage(e);
		} finally {
			if (!current.signal.aborted) isLoading = false;
		}
	}

	$effect(() => {
		void load(request, requestKey);
		return () => controller?.abort();
	});

	let units = $derived(settingsStore.unitPreferences);
	let format = $derived(valueFormatter(query, units));
	let form = $derived(chartForm(query));
	let preset = $derived(activePreset(query));
	let hidden = $derived(new Set(query.hide));

	let allSeries = $derived(response ? seriesFor(response, vehicleColors) : []);
	let visibleSeries = $derived(allSeries.filter(s => !hidden.has(s.sourceKey)));
	let visibleKeys = $derived(new Set(visibleSeries.map(s => s.sourceKey)));
	let hiddenSeriesKeys = $derived(allSeries.filter(s => hidden.has(s.sourceKey)).map(s => s.key));
	let summary = $derived(response ? kpis(query, response, visibleKeys) : null);
	let intervalLabel = $derived(
		EXPLORE_INTERVALS.find(i => i.value === query.per)?.label.toLowerCase() ?? 'bucket'
	);
	let compareLabel = $derived(
		query.compare === 'prevYear' ? 'the year before' : 'the period before'
	);

	let kpiItems = $derived.by(() => {
		if (!summary) return [];
		const items: Array<{ label: string; value: string; subtitle?: string }> = [
			{
				label: isAdditive(query) ? 'Total' : 'Average',
				value: summary.total != null ? format.full(summary.total) : 'N/A'
			}
		];
		if (query.per !== 'none' && summary.perBucket != null) {
			const change = percentChange(summary.perBucket, summary.previousPerBucket);
			items.push({
				label: `Per ${intervalLabel}`,
				value: format.full(summary.perBucket),
				subtitle:
					change == null
						? undefined
						: `${change > 0 ? '▲' : change < 0 ? '▼' : '='} ${Math.abs(change)}% vs ${compareLabel}`
			});
		}
		if (summary.perDistance != null) {
			items.push({
				label: `Per ${getDistanceUnitLabel(units.distanceUnit, true)}`,
				value: format.full(summary.perDistance)
			});
		}
		return items;
	});

	let labels = $derived(response ? response.buckets.map(b => bucketLabel(b, query.per)) : []);
	const isMobile = new IsMobile();
	let maxTicks = $derived(isMobile.current ? 4 : 6);
	let tickStep = $derived(Math.max(1, Math.ceil(labels.length / maxTicks)));
	let bandTicks = $derived(labels.filter((_, i) => i % tickStep === 0));

	let barRows = $derived(
		labels.map((label, i) => {
			const row: Record<string, string | number> = { label };
			for (const s of allSeries) row[s.key] = s.values[i] ?? 0;
			return row;
		})
	);

	let lineRows = $derived(
		(response?.buckets ?? []).map((bucket, i) => {
			const row: Record<string, Date | number | null> = { date: bucketDate(bucket) };
			for (const s of allSeries) row[s.key] = s.values[i] ?? null;
			return row;
		})
	);

	let compareSeries = $derived([
		{ key: 'current', label: 'This period', color: 'var(--chart-1)' },
		{
			key: 'previous',
			label: EXPLORE_COMPARES.find(c => c.value === query.compare)?.label ?? 'Before',
			color: 'var(--chart-4)'
		}
	]);
	let compareRows = $derived.by(() => {
		if (!response) return [];
		const length = response.buckets.length;
		const current = bucketTotals(visibleSeries, length);
		const previous = bucketTotals(
			(response.compare?.series ?? []).filter(s => visibleKeys.has(s.key)),
			length
		);
		return response.buckets.map((bucket, i) => ({
			date: bucketDate(bucket),
			current: current[i] ?? 0,
			previous: previous[i] ?? 0
		}));
	});

	let rankingRows = $derived(
		visibleSeries
			.map(s => ({ label: s.label, value: s.values[0] ?? 0 }))
			.sort((a, b) => b.value - a.value)
	);
	let rankingSeries = $derived([
		{ key: 'value', label: describeQuery(query), color: 'var(--chart-1)' }
	]);

	let chartTitle = $derived(describeQuery(query));
	let rankingGutter = $derived(isMobile.current ? 112 : 232);

	function fitLabel(label: string): string {
		const chars = Math.floor((rankingGutter - 12) / 6.5);
		return label.length > chars ? `${label.slice(0, chars - 1).trimEnd()}…` : label;
	}
	let lineXAxis = $derived({
		ticks: Math.min(maxTicks, lineRows.length),
		format: (v: Date) => (v instanceof Date ? bucketLabel(keyFor(v), query.per) : '')
	});

	function keyFor(date: Date): string {
		const y = date.getFullYear();
		const m = date.getMonth();
		if (query.per === 'year') return String(y);
		if (query.per === 'quarter') return `${y}-Q${Math.floor(m / 3) + 1}`;
		const pad = (n: number) => String(n).padStart(2, '0');
		if (query.per === 'week') return `${y}-${pad(m + 1)}-${pad(date.getDate())}`;
		return `${y}-${pad(m + 1)}`;
	}

	function toggleSeries(seriesKey: string) {
		const key = allSeries.find(s => s.key === seriesKey)?.sourceKey;
		if (!key) return;
		const next = hidden.has(key) ? query.hide.filter(k => k !== key) : [...query.hide, key];
		onQueryChange({ ...query, hide: next });
	}
</script>

<div class="space-y-4 md:space-y-6">
	<QueryBar {query} onChange={onQueryChange} />

	<div class="flex flex-wrap gap-2" role="group" aria-label="Presets">
		{#each EXPLORE_PRESETS as p (p.id)}
			<Button
				size="sm"
				variant={preset === p.id ? 'default' : 'outline'}
				aria-pressed={preset === p.id}
				class="rounded-full"
				onclick={() => onQueryChange(applyPreset(p.query))}
			>
				{p.label}
			</Button>
		{/each}
	</div>

	{#if error && !response}
		<LoadErrorCard
			title="Couldn't load this chart"
			message={error}
			onRetry={() => load(request, requestKey)}
		/>
	{:else if !response}
		<div class="space-y-4" aria-busy="true" aria-label="Loading the chart">
			<Skeleton class="h-24 w-full" />
			<Skeleton class="h-[300px] w-full" />
		</div>
	{:else if !hasData(response)}
		<EmptyState level={3}>
			{#snippet icon()}
				<div class="mb-4 rounded-full bg-muted p-4">
					<SearchX class="h-8 w-8 text-muted-foreground" aria-hidden="true" />
				</div>
			{/snippet}
			{#snippet title()}Nothing to chart yet{/snippet}
			{#snippet description()}
				No data for {chartTitle.toLowerCase()}{filterLabel ? `, ${filterLabel}` : ''}. Try another
				measure, a longer date range or more cars.
			{/snippet}
			{#snippet action()}
				<div class="flex flex-col gap-3 sm:flex-row">
					{#if onClearFilters}
						<Button variant="outline" onclick={onClearFilters}>Clear filters</Button>
					{/if}
					<Button variant="outline" onclick={() => onQueryChange(DEFAULT_EXPLORE)}>
						<RotateCcw class="mr-1 h-4 w-4" aria-hidden="true" />
						Reset chart
					</Button>
				</div>
			{/snippet}
		</EmptyState>
	{:else}
		<div
			class="space-y-4 transition-opacity md:space-y-6"
			class:opacity-60={isLoading}
			aria-busy={isLoading}
		>
			{#if error}
				<p class="text-sm text-destructive" role="alert">
					Couldn't update the chart: {error}
				</p>
			{/if}
			<StatCardGrid items={kpiItems} columns={3} />

			{#if form === 'ranking'}
				<AppBarChart
					level={2}
					title={chartTitle}
					data={rankingRows}
					x="value"
					y="label"
					orientation="horizontal"
					series={rankingSeries}
					config={buildChartConfig(rankingSeries)}
					height={Math.max(160, rankingRows.length * 44)}
					padding={{ top: 4, left: rankingGutter, bottom: 24, right: 16 }}
					xAxisProps={{ format: format.axis, ticks: 4 }}
					yAxisFormat={v => fitLabel(String(v))}
					tooltipFormat={format.full}
					tooltipLabelFormat={v => String(v)}
				>
					{#snippet icon()}<ChartColumn class="h-5 w-5 text-primary" />{/snippet}
				</AppBarChart>
			{:else if form === 'compare'}
				<AppLineChart
					level={2}
					title={chartTitle}
					data={compareRows}
					x="date"
					y={['current', 'previous']}
					series={compareSeries}
					config={buildChartConfig(compareSeries)}
					xAxisProps={lineXAxis}
					yAxisFormat={format.axis}
					tooltipFormat={format.full}
					tooltipLabelFormat={v => (v instanceof Date ? bucketLabel(keyFor(v), query.per) : '')}
				/>
			{:else if form === 'line'}
				<AppLineChart
					level={2}
					title={chartTitle}
					data={lineRows}
					x="date"
					y={visibleSeries.map(s => s.key)}
					series={allSeries}
					hiddenKeys={hiddenSeriesKeys}
					onToggleSeries={toggleSeries}
					config={buildChartConfig(allSeries)}
					xAxisProps={lineXAxis}
					yAxisFormat={format.axis}
					tooltipFormat={format.full}
					tooltipLabelFormat={v => (v instanceof Date ? bucketLabel(keyFor(v), query.per) : '')}
				/>
			{:else}
				<AppBarChart
					level={2}
					title={chartTitle}
					data={barRows}
					x="label"
					series={allSeries}
					hiddenKeys={hiddenSeriesKeys}
					onToggleSeries={toggleSeries}
					config={buildChartConfig(allSeries)}
					seriesLayout={form === 'stacked' ? 'stack' : undefined}
					xAxisProps={{ ticks: bandTicks }}
					yAxisFormat={format.axis}
					tooltipFormat={format.full}
					tooltipLabelFormat={v => String(v)}
				>
					{#snippet icon()}<ChartColumn class="h-5 w-5 text-primary" />{/snippet}
				</AppBarChart>
			{/if}
		</div>
	{/if}
</div>
