<script lang="ts">
	import { tick, untrack, type Snippet } from 'svelte';
	import { ChartColumn, RotateCcw, SearchX } from '@lucide/svelte';
	import LoadErrorCard from '#lib/components/common/LoadErrorCard.svelte';
	import EmptyState from '#lib/components/common/empty-state.svelte';
	import { AppBarChart, AppLineChart } from '#lib/components/charts/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
	import { IsMobile } from '#lib/hooks/is-mobile.svelte.ts';
	import { analyticsApi } from '#lib/services/analytics-api.ts';
	import { settingsStore } from '#lib/stores/settings.svelte.ts';
	import type { AnalyticsQueryResponse } from '#lib/types/index.ts';
	import { buildChartConfig } from '#lib/utils/chart-colors.ts';
	import { userFacingErrorMessage } from '#lib/utils/error-handling.ts';
	import { formatCurrency } from '#lib/utils/formatters.ts';
	import { getDistanceUnitLabel } from '#lib/utils/units.ts';
	import type { AnalyticsDateRange } from '../analytics-filters';
	import InsightCards from './InsightCards.svelte';
	import NumbersTable from './NumbersTable.svelte';
	import QueryBar from './QueryBar.svelte';
	import DrillPanel from './DrillPanel.svelte';
	import {
		DEFAULT_EXPLORE,
		EXPLORE_COMPARES,
		EXPLORE_INTERVALS,
		chartForm,
		exploreRequest,
		queryCache,
		takePrefetched,
		describeQuery,
		metricInfo,
		metricLabel,
		type ExploreQuery
	} from './query-state';
	import {
		bucketDate,
		bucketLabel,
		bucketTotals,
		emptyBuckets,
		carPanels,
		exploreAnnotations,
		hasData,
		heroSentence,
		isAdditive,
		numbersTable,
		plainDay,
		kpis,
		bucketBounds,
		expensesNote,
		percentChange,
		seriesFor,
		valueFormatter,
		weeksNeedYear
	} from './explore-data';

	interface Props {
		query: ExploreQuery;
		onQueryChange: (_query: ExploreQuery) => void;
		dateRange: AnalyticsDateRange;
		vehicleIds?: string[];
		vehicleColors?: Record<string, string>;
		filterLabel?: string;
		onClearFilters?: () => void;
		rangeText?: string;
		carsText?: string;
		onOnlyCar?: (_id: string) => void;
		onAllCars?: () => void;
		onApplyInsight?: (_query: Record<string, string>) => void;
		driverSplit?: boolean;
		filters?: Snippet;
		carCount?: number;
	}

	let {
		query,
		onQueryChange,
		dateRange,
		vehicleIds,
		vehicleColors,
		filterLabel,
		onClearFilters,
		rangeText = 'Last 12 months',
		carsText = 'All cars',
		onOnlyCar,
		onAllCars,
		onApplyInsight,
		driverSplit = false,
		filters,
		carCount
	}: Props = $props();

	let root = $state<HTMLElement | null>(null);

	function applyInsight(insightQuery: Record<string, string>) {
		onApplyInsight?.(insightQuery);
		root?.scrollIntoView({ block: 'start' });
	}

	let response = $state<AnalyticsQueryResponse | null>(null);
	let shown = $state<ExploreQuery>(untrack(() => query));
	let shownScope = $state(untrack(() => ({ range: rangeText, cars: carsText })));
	let isLoading = $state(true);
	let error = $state<string | null>(null);
	let controller: AbortController | null = null;

	let request = $derived(exploreRequest(query, dateRange, vehicleIds));
	let requestKey = $derived(JSON.stringify(request));

	async function load(params: typeof request, key: string, asked: ExploreQuery) {
		const scope = untrack(() => ({ range: rangeText, cars: carsText }));
		controller?.abort();
		const cached = queryCache.get(key);
		if (cached) {
			response = cached;
			shown = asked;
			shownScope = scope;
			isLoading = false;
			error = null;
			return;
		}
		const current = new AbortController();
		controller = current;
		isLoading = true;
		try {
			const result = await (takePrefetched(key) ??
				analyticsApi.query(params, { signal: current.signal }));
			if (current.signal.aborted) return;
			queryCache.set(key, result);
			response = result;
			shown = asked;
			shownScope = scope;
			error = null;
		} catch (e) {
			if (current.signal.aborted) return;
			error = userFacingErrorMessage(e);
		} finally {
			if (!current.signal.aborted) isLoading = false;
		}
	}

	let chartReady = $state(false);
	$effect(() => {
		if (!response || chartReady) return;
		const frame = requestAnimationFrame(() => setTimeout(() => (chartReady = true)));
		return () => cancelAnimationFrame(frame);
	});

	$effect(() => {
		const asked = untrack(() => query);
		void load(request, requestKey, asked);
		return () => controller?.abort();
	});

	let units = $derived(settingsStore.unitPreferences);
	let distanceWord = $derived(units.distanceUnit === 'kilometers' ? 'km' : 'mile');
	let format = $derived(valueFormatter(shown, units));
	let form = $derived(chartForm(shown));
	let hidden = $derived(new Set(query.hide));

	let allSeries = $derived(response ? seriesFor(response, vehicleColors) : []);
	let visibleSeries = $derived(allSeries.filter(s => !hidden.has(s.sourceKey)));
	let visibleKeys = $derived(new Set(visibleSeries.map(s => s.sourceKey)));
	let hiddenSeriesKeys = $derived(allSeries.filter(s => hidden.has(s.sourceKey)).map(s => s.key));
	let summary = $derived(
		response ? kpis({ ...shown, hide: query.hide }, response, visibleKeys) : null
	);
	let intervalLabel = $derived(
		EXPLORE_INTERVALS.find(i => i.value === shown.per)?.label.toLowerCase() ?? 'bucket'
	);
	let compareLabel = $derived(
		shown.compare === 'prevYear' ? 'the year before' : 'the period before'
	);

	let heroValue = $derived(
		summary?.total == null
			? 'N/A'
			: shown.metric === 'cost'
				? format.axis(summary.total)
				: format.full(summary.total)
	);
	let heroText = $derived(
		summary
			? heroSentence({
					query: shown,
					summary,
					series: visibleSeries,
					format: v => (shown.metric === 'cost' && v >= 100 ? format.axis(v) : format.full(v)),
					rangeText: shownScope.range,
					carsText: shownScope.cars,
					interval: intervalLabel,
					compareLabel,
					distanceWord,
					carCount
				})
			: ''
	);

	let withYear = $derived(weeksNeedYear(shown.per, response?.buckets.length ?? 0));
	function labelOf(key: string): string {
		return bucketLabel(key, shown.per, withYear);
	}
	let labels = $derived(response ? response.buckets.map(labelOf) : []);
	const isMobile = new IsMobile();
	let maxTicks = $derived(isMobile.current ? 4 : 6);
	let tickStep = $derived(Math.max(1, Math.ceil(labels.length / maxTicks)));
	let bandTicks = $derived(labels.filter((_, i) => i % tickStep === 0));

	let empty = $derived(emptyBuckets(allSeries, labels.length, isAdditive(shown)));

	let barRows = $derived(
		labels.map((label, i) => {
			const row: Record<string, string | number | null> = { label };
			for (const s of allSeries) row[s.key] = empty[i] ? null : (s.values[i] ?? 0);
			return row;
		})
	);

	let carTotals = $state<Record<string, number | null> | null>(null);
	let carTotalsError = $state<string | null>(null);
	let carTotalsAttempt = $state(0);
	let carTotalsRequest: Promise<unknown> = Promise.resolve();
	let carTotalsKey = '';

	$effect(() => {
		void carTotalsAttempt;
		if (chartForm(query) !== 'panels' || isAdditive(query)) {
			carTotals = null;
			carTotalsError = null;
			carTotalsKey = '';
			return;
		}
		const params = { ...request, interval: 'none' as const, compare: 'none' as const };
		const key = JSON.stringify(params);
		if (key !== carTotalsKey) {
			carTotalsKey = key;
			carTotalsError = null;
		}
		const totalsOf = (r: AnalyticsQueryResponse) =>
			Object.fromEntries(r.series.map(s => [s.key, s.values[0] ?? null]));
		const cached = queryCache.get(key);
		if (cached) {
			carTotals = totalsOf(cached);
			carTotalsError = null;
			return;
		}
		const totalsController = new AbortController();
		carTotals = null;
		carTotalsRequest = analyticsApi
			.query(params, { signal: totalsController.signal })
			.then(result => {
				queryCache.set(key, result);
				carTotals = totalsOf(result);
				carTotalsError = null;
			})
			.catch(e => {
				if (!totalsController.signal.aborted) carTotalsError = userFacingErrorMessage(e);
			});
		return () => totalsController.abort();
	});

	async function retryCarTotals() {
		carTotalsAttempt += 1;
		await tick();
		await carTotalsRequest;
	}

	let panels = $derived(
		carPanels(
			allSeries,
			isAdditive(shown)
				? undefined
				: { fleet: response?.totals.value ?? null, cars: carTotals ?? {} },
			empty
		)
	);
	let panelPer = $derived(isAdditive(shown) ? ` per ${intervalLabel}` : '');

	let lineRows = $derived(
		(response?.buckets ?? []).map((bucket, i) => {
			const row: Record<string, Date | number | null> = { date: bucketDate(bucket) };
			for (const s of allSeries) row[s.key] = empty[i] ? null : (s.values[i] ?? null);
			return row;
		})
	);

	let compareSeriesAll = $derived([
		{ key: 'current', label: 'This period', color: 'var(--chart-1)' },
		{
			key: 'previous',
			label: EXPLORE_COMPARES.find(c => c.value === shown.compare)?.label ?? 'Before',
			color: 'var(--chart-4)'
		}
	]);
	let hasPrevious = $derived(
		!!response?.compare?.series.some(s => s.values.some(v => v != null && v !== 0))
	);
	let compareSeries = $derived(hasPrevious ? compareSeriesAll : compareSeriesAll.slice(0, 1));
	let compareRows = $derived.by(() => {
		if (!response) return [];
		const length = response.buckets.length;
		const previousSeries = (response.compare?.series ?? []).filter(s => visibleKeys.has(s.key));
		const current = bucketTotals(visibleSeries, length);
		const previous = bucketTotals(previousSeries, length);
		const currentEmpty = emptyBuckets(visibleSeries, length, isAdditive(shown));
		const previousEmpty = emptyBuckets(previousSeries, length, isAdditive(shown));
		return response.buckets.map((bucket, i) => ({
			date: bucketDate(bucket),
			current: currentEmpty[i] ? null : (current[i] ?? 0),
			previous: !hasPrevious || previousEmpty[i] ? null : (previous[i] ?? 0)
		}));
	});

	function compareTooltip(value: number, key: string, row?: Record<string, unknown>): string {
		const text = format.full(value);
		const previous = row?.['previous'];
		if (key !== 'current' || typeof previous !== 'number') return text;
		const change = percentChange(value, previous);
		return change == null
			? text
			: `${text} (${change > 0 ? '▲' : change < 0 ? '▼' : '='}\u00a0${Math.abs(change)}%)`;
	}

	let rankingRows = $derived(
		allSeries
			.map(s => ({ label: s.label, value: s.values[0] ?? 0 }))
			.sort((a, b) => b.value - a.value)
	);
	let rankingSeries = $derived([
		{ key: 'value', label: describeQuery(shown, distanceWord), color: 'var(--chart-1)' }
	]);

	let chartTitle = $derived(describeQuery(shown, distanceWord));
	let numbers = $derived.by(() => {
		if (!response || !['bars', 'stacked', 'grouped', 'line', 'panels'].includes(form)) return null;
		const gaps = emptyBuckets(visibleSeries, labels.length, isAdditive(shown));
		return numbersTable(
			response.buckets.map((key, i) => ({ key, label: labels[i] ?? key })),
			visibleSeries.map(s => ({
				label: s.label,
				values: s.values.map((v, i) => (gaps[i] ? null : v))
			})),
			isAdditive(shown) && shown.split !== 'tag'
		);
	});
	let numbersFile = $derived.by(() => {
		const metric = metricLabel(shown.metric, distanceWord).toLowerCase().replaceAll(' ', '-');
		const range = response
			? `${response.buckets[0] ?? ''}-to-${response.buckets.at(-1) ?? ''}`
			: `to-${plainDay(dateRange.endDate - 1)}`;
		return `vroom-${metric}-by-${shown.per}-${range}.csv`;
	});
	let rankingGutter = $derived(isMobile.current ? 112 : 232);

	function fitLabel(label: string): string {
		const chars = Math.floor((rankingGutter - 12) / 6.5);
		return label.length > chars ? `${label.slice(0, chars - 1).trimEnd()}…` : label;
	}
	let lineXAxis = $derived({
		ticks: Math.min(maxTicks, lineRows.length),
		format: (v: Date) => (v instanceof Date ? labelOf(keyFor(v)) : '')
	});

	let annotationOptions = $derived({
		money: formatCurrency,
		distanceUnit: getDistanceUnitLabel(units.distanceUnit, true)
	});
	let lineAnnotations = $derived(
		response
			? exploreAnnotations(response, shown.per, {
					...annotationOptions,
					atFor: i => lineRows[i]?.['date']
				})
			: undefined
	);
	let barAnnotations = $derived(
		response
			? exploreAnnotations(response, shown.per, { ...annotationOptions, atFor: i => labels[i] })
			: undefined
	);

	function keyFor(date: Date): string {
		const y = date.getFullYear();
		const m = date.getMonth();
		if (shown.per === 'year') return String(y);
		if (shown.per === 'quarter') return `${y}-Q${Math.floor(m / 3) + 1}`;
		const pad = (n: number) => String(n).padStart(2, '0');
		if (shown.per === 'week') return `${y}-${pad(m + 1)}-${pad(date.getDate())}`;
		return `${y}-${pad(m + 1)}`;
	}

	let selectedSeries = $derived(
		query.seg === undefined ? undefined : allSeries.find(s => s.sourceKey === query.seg)
	);
	let selectedIndex = $derived(response && query.sel ? response.buckets.indexOf(query.sel) : -1);
	let selectionValue = $derived.by(() => {
		if (!response || selectedIndex < 0) return null;
		if (selectedSeries) return selectedSeries.values[selectedIndex] ?? null;
		return isAdditive(shown) && shown.split !== 'tag'
			? (bucketTotals(visibleSeries, response.buckets.length)[selectedIndex] ?? null)
			: null;
	});
	let selectionTitle = $derived(
		response && selectedIndex >= 0
			? `${labelOf(response.buckets[selectedIndex] ?? '')}${selectedSeries ? ` · ${selectedSeries.label}` : ''}`
			: ''
	);
	let selectionComparison = $derived.by(() => {
		const average = response?.totals.perBucket;
		if (selectionValue == null || average == null || average === 0 || shown.per === 'none') {
			return undefined;
		}
		const change = percentChange(selectionValue, average);
		if (change == null || selectedSeries) return undefined;
		if (change === 0) return `Same as your average per ${intervalLabel}`;
		return `${Math.abs(change)}% ${change > 0 ? 'above' : 'below'} your average per ${intervalLabel}`;
	});
	let selectionBounds = $derived(
		response && selectedIndex >= 0 && query.sel
			? bucketBounds(query.sel, shown.per, response.range)
			: null
	);
	let shownEnergy = $derived.by(() => {
		const info = metricInfo(shown.metric);
		return 'energy' in info ? info.energy : undefined;
	});
	let measuresEnergy = $derived(['volume', 'efficiency'].includes(metricInfo(shown.metric).metric));
	let selectionKeys = $derived.by(() => {
		if (selectedSeries) return [selectedSeries.sourceKey];
		if (shown.split === 'none' || visibleSeries.length === allSeries.length) return undefined;
		return visibleSeries.map(s => s.sourceKey);
	});
	let segVehicle = $derived(
		shown.split === 'vehicle' && selectionKeys?.length === 1 ? selectionKeys[0] : undefined
	);
	let selectionParams = $derived.by(() => {
		if (!selectionBounds) return null;
		return {
			...selectionBounds,
			vehicleIds,
			include: shown.inc,
			metric: metricInfo(shown.metric).metric,
			energy: shownEnergy,
			groupBy: shown.split,
			keys: selectionKeys
		};
	});
	let selectionExpenses = $derived(
		selectionBounds
			? {
					...selectionBounds,
					vehicleId: segVehicle ?? (vehicleIds?.length === 1 ? vehicleIds[0] : undefined),
					tag:
						shown.split === 'tag' && selectionKeys?.length === 1 && selectionKeys[0]
							? selectionKeys[0]
							: undefined
				}
			: null
	);
	let selectionExpensesNote = $derived(
		expensesNote({
			split: shown.split,
			keys: selectionKeys,
			cars: segVehicle
				? 1
				: shown.split === 'vehicle' && selectionKeys
					? selectionKeys.length
					: (vehicleIds?.length ?? 0),
			energy: measuresEnergy
		})
	);
	let selectionCostLabel = $derived.by(() => {
		if (measuresEnergy) {
			return shownEnergy === 'electric' ? 'What these charges cost' : 'What these fill-ups cost';
		}
		const metric = metricInfo(shown.metric).metric;
		return metric === 'distance' || metric === 'costPerDistance'
			? 'Expenses in this period'
			: undefined;
	});
	let selectionValueFromItems = $derived(
		shown.split === 'tag' && !selectedSeries
			? metricInfo(shown.metric).metric === 'count'
				? ('count' as const)
				: ('total' as const)
			: undefined
	);
	let selectionCar = $derived(
		segVehicle && selectedSeries && !(vehicleIds?.length === 1 && vehicleIds[0] === segVehicle)
			? { id: segVehicle, name: selectedSeries.label }
			: null
	);

	let selectionParts = $derived.by(() => {
		if (selectedIndex < 0 || selectedSeries || shown.split === 'none') return [];
		return visibleSeries
			.map(series => ({ series, raw: series.values[selectedIndex] ?? 0 }))
			.filter(p => p.raw !== 0)
			.sort((a, b) => b.raw - a.raw)
			.map(({ series, raw }) => ({
				key: series.key,
				label: series.label,
				value: format.full(raw),
				color: series.color,
				action: shown.split === 'vehicle' && onOnlyCar ? 'Show only' : 'Details',
				run: () =>
					shown.split === 'vehicle' && onOnlyCar
						? onOnlyCar(series.sourceKey)
						: onQueryChange({ ...query, seg: series.sourceKey })
			}));
	});

	function select(bucket: string | undefined, seriesKey: string | null) {
		if (!bucket) return;
		const seg =
			seriesKey && shown.split !== 'none'
				? allSeries.find(s => s.key === seriesKey)?.sourceKey
				: undefined;
		onQueryChange({ ...query, sel: bucket, seg });
	}

	function selectBar(row: Record<string, unknown>, seriesKey: string | null) {
		select(response?.buckets[labels.indexOf(String(row['label']))], seriesKey);
	}

	function selectLine(row: Record<string, unknown>, seriesKey: string | null) {
		const date = row['date'];
		if (date instanceof Date) select(keyFor(date), seriesKey);
	}

	function selectPanel(row: Record<string, unknown>, car: string) {
		const date = row['date'];
		if (date instanceof Date) onQueryChange({ ...query, sel: keyFor(date), seg: car });
	}

	function selectBarPanel(row: Record<string, unknown>, car: string) {
		const bucket = response?.buckets[labels.indexOf(String(row['label']))];
		if (bucket) onQueryChange({ ...query, sel: bucket, seg: car });
	}

	function panelTotalText(series: { values: Array<number | null> }): string {
		const total = series.values.reduce<number>((sum, v) => sum + (v ?? 0), 0);
		return `${format.axis(total)} in all`;
	}

	function selectRanking(row: Record<string, unknown>) {
		const series = allSeries.find(s => s.label === row['label']);
		if (series) onQueryChange({ ...query, sel: 'total', seg: series.sourceKey });
	}

	function closeSelection() {
		onQueryChange({ ...query, sel: undefined, seg: undefined });
	}

	function toggleSeries(seriesKey: string) {
		const key = allSeries.find(s => s.key === seriesKey)?.sourceKey;
		if (!key) return;
		const next = hidden.has(key) ? query.hide.filter(k => k !== key) : [...query.hide, key];
		onQueryChange({ ...query, hide: next, sel: undefined, seg: undefined });
	}
</script>

<div class="space-y-4 md:space-y-6" bind:this={root}>
	{#if response && hasData(response)}
		<div
			class="flex min-h-48 flex-col gap-2 transition-opacity md:min-h-28 md:flex-row md:items-center md:gap-5"
			class:opacity-60={isLoading || !!error}
			aria-live="polite"
		>
			<p
				class="shrink-0 font-(family-name:--font-fig) text-6xl leading-none font-bold tabular-nums lg:text-7xl"
			>
				{heroValue}
			</p>
			<p class="max-w-md text-base text-muted-foreground md:text-lg">{heroText}</p>
		</div>
	{:else if !response && !error}
		<Skeleton class="h-48 w-full max-w-xl md:h-28" />
	{/if}

	<QueryBar {query} onChange={onQueryChange} {driverSplit} {filters} />

	{#if error && !response}
		<LoadErrorCard
			title="Couldn't load this chart"
			message={error}
			onRetry={() => load(request, requestKey, query)}
		/>
	{:else if !response || (!chartReady && hasData(response))}
		<div aria-busy="true" aria-label="Loading the chart">
			<Skeleton class="h-[300px] w-full" />
		</div>
	{:else if !hasData(response)}
		<EmptyState level={3}>
			{#snippet icon()}
				<div class="mb-4 rounded-full bg-muted p-4">
					<SearchX class="h-8 w-8 text-muted-foreground" aria-hidden="true" />
				</div>
			{/snippet}
			{#snippet title()}Not enough data yet{/snippet}
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
		{#if error}
			<LoadErrorCard
				title="Couldn't update the chart"
				message={`It still shows ${chartTitle.toLowerCase()}. ${error}`}
				onRetry={() => load(request, requestKey, query)}
			/>
		{/if}
		<div
			class="space-y-4 transition-opacity md:space-y-6"
			class:opacity-60={isLoading || !!error}
			aria-busy={isLoading}
		>
			<nav aria-label="Drill path" class="flex flex-wrap items-center gap-x-1 text-sm">
				{#if onAllCars && carsText !== 'All cars'}
					<button
						type="button"
						class="inline-flex min-h-10 items-center px-1 underline underline-offset-2"
						onclick={onAllCars}
					>
						All cars
					</button>
					<span aria-hidden="true" class="text-muted-foreground">›</span>
				{/if}
				<span class="px-1">{carsText}</span>
				<span aria-hidden="true" class="text-muted-foreground">›</span>
				{#if selectedIndex >= 0}
					<button
						type="button"
						class="inline-flex min-h-10 items-center px-1 underline underline-offset-2"
						onclick={closeSelection}
					>
						{rangeText}
					</button>
					<span aria-hidden="true" class="text-muted-foreground">›</span>
					<span aria-current="page" class="px-1 font-medium">{selectionTitle}</span>
				{:else}
					<span aria-current="page" class="inline-flex min-h-10 items-center px-1 font-medium">
						{rangeText}
					</span>
					<span class="basis-full px-1 text-muted-foreground sm:basis-auto">
						Select a bar or point to see its expenses
					</span>
				{/if}
			</nav>

			{#if form === 'ranking'}
				<AppBarChart
					level={2}
					title={chartTitle}
					data={rankingRows}
					x="value"
					y="label"
					orientation="horizontal"
					onSelect={selectRanking}
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
				{#if !hasPrevious}
					<p class="text-sm text-muted-foreground">
						There is no data for {compareLabel} in this range, so only this period is drawn.
					</p>
				{/if}
				<AppLineChart
					level={2}
					title={chartTitle}
					data={compareRows}
					x="date"
					y={compareSeries.map(c => c.key)}
					series={compareSeries}
					config={buildChartConfig(compareSeries)}
					band={hasPrevious ? { from: 'previous', to: 'current' } : undefined}
					xAxisProps={lineXAxis}
					yAxisFormat={format.axis}
					tooltipFormat={compareTooltip}
					tooltipLabelFormat={v => (v instanceof Date ? labelOf(keyFor(v)) : '')}
				/>
			{:else if form === 'panels'}
				<section aria-labelledby="explore-panels-title" class="space-y-3">
					<h2 id="explore-panels-title" tabindex="-1" class="text-lg font-semibold outline-none">
						{chartTitle}
					</h2>
					<p class="text-sm text-muted-foreground">
						One {format.axis(panels.yDomain[0])} – {format.axis(panels.yDomain[1])} scale for every car.
						The dashed line is the fleet average{panels.fleetMean != null
							? ` (${format.full(panels.fleetMean)}${panelPer})`
							: ''}.
					</p>
					{#if carTotalsError}
						<LoadErrorCard
							compact
							title="Couldn't work out each car's average"
							message={carTotalsError}
							onRetry={retryCarTotals}
							onRecovered={() => document.getElementById('explore-panels-title')?.focus()}
						/>
					{/if}
					<div
						class="grid grid-cols-1 gap-4 {isAdditive(shown)
							? 'lg:grid-cols-2 xl:grid-cols-3'
							: 'lg:grid-cols-2'}"
					>
						{#each panels.panels as panel (panel.series.key)}
							{#if isAdditive(shown)}
								<AppBarChart
									class="min-w-0"
									level={3}
									title={panel.series.label}
									description={panelTotalText(panel.series)}
									onSelect={row => selectBarPanel(row, panel.series.sourceKey)}
									data={barRows}
									x="label"
									series={[panel.series]}
									config={buildChartConfig([panel.series])}
									height={200}
									yDomain={panels.yDomain}
									referenceLines={panels.fleetMean != null
										? [{ value: panels.fleetMean, label: 'Fleet average' }]
										: []}
									fitTicks
									xAxisProps={{ ticks: bandTicks }}
									yAxisFormat={format.axis}
									tooltipFormat={format.full}
									tooltipLabelFormat={v => String(v)}
								/>
							{:else}
								<AppLineChart
									class="min-w-0"
									level={3}
									title={panel.series.label}
									description={panel.mean != null
										? `Average ${format.full(panel.mean)}${panelPer}`
										: carTotalsError
											? 'Average not available'
											: !isAdditive(shown) && carTotals === null
												? 'Working out the average'
												: 'No data in this range'}
									onSelect={row => selectPanel(row, panel.series.sourceKey)}
									data={lineRows}
									x="date"
									y={[panel.series.key]}
									series={[panel.series]}
									config={buildChartConfig([panel.series])}
									height={200}
									yDomain={panels.yDomain}
									referenceLines={panels.fleetMean != null
										? [{ value: panels.fleetMean, label: 'Fleet average' }]
										: []}
									xAxisProps={lineXAxis}
									yAxisFormat={format.axis}
									tooltipFormat={format.full}
									tooltipLabelFormat={v => (v instanceof Date ? labelOf(keyFor(v)) : '')}
								/>
							{/if}
						{/each}
					</div>
				</section>
			{:else if form === 'line'}
				<AppLineChart
					level={2}
					title={chartTitle}
					data={lineRows}
					annotations={lineAnnotations}
					x="date"
					y={visibleSeries.map(s => s.key)}
					onSelect={selectLine}
					series={allSeries}
					hiddenKeys={hiddenSeriesKeys}
					onToggleSeries={toggleSeries}
					config={buildChartConfig(allSeries)}
					xAxisProps={lineXAxis}
					yAxisFormat={format.axis}
					tooltipFormat={format.full}
					tooltipLabelFormat={v => (v instanceof Date ? labelOf(keyFor(v)) : '')}
				/>
			{:else}
				<AppBarChart
					level={2}
					title={chartTitle}
					data={barRows}
					x="label"
					onSelect={selectBar}
					annotations={barAnnotations}
					series={allSeries}
					hiddenKeys={hiddenSeriesKeys}
					onToggleSeries={toggleSeries}
					config={buildChartConfig(allSeries)}
					seriesLayout={form === 'stacked' ? 'stack' : form === 'grouped' ? 'group' : undefined}
					fitTicks
					xAxisProps={{ ticks: bandTicks }}
					yAxisFormat={format.axis}
					tooltipFormat={format.full}
					tooltipLabelFormat={v => String(v)}
				>
					{#snippet icon()}<ChartColumn class="h-5 w-5 text-primary" />{/snippet}
				</AppBarChart>
			{/if}
			{#if numbers}
				<NumbersTable
					table={numbers}
					firstColumn={intervalLabel.replace(/^./, c => c.toUpperCase())}
					format={shown.metric === 'cost' ? format.axis : format.full}
					filename={numbersFile}
				/>
			{/if}
		</div>
	{/if}
	<DrillPanel
		open={!!query.sel && selectedIndex >= 0}
		title={selectionTitle}
		value={selectionValue != null ? format.full(selectionValue) : undefined}
		comparison={selectionComparison}
		params={selectionParams}
		expenses={selectionExpenses}
		costLabel={selectionCostLabel}
		valueFromItems={selectionValueFromItems}
		expensesNote={selectionExpensesNote}
		car={selectionCar}
		parts={selectionParts}
		{onOnlyCar}
		allCars={selectedSeries && form === 'panels' && query.sel && query.sel !== 'total'
			? {
					label: `${vehicleIds?.length ? 'All selected cars' : 'All cars'} in ${labelOf(query.sel)}`,
					run: () => onQueryChange({ ...query, seg: undefined })
				}
			: null}
		onClose={closeSelection}
	/>

	<InsightCards {dateRange} {vehicleIds} onApply={applyInsight} />
</div>
