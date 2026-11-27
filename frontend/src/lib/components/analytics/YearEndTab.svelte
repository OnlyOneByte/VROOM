<script lang="ts">
	import LoadErrorCard from '#lib/components/common/LoadErrorCard.svelte';
	import EmptyState from '#lib/components/common/empty-state.svelte';
	import HeroFigure from '#lib/components/common/hero-figure.svelte';
	import { userFacingErrorMessage } from '#lib/utils/error-handling.ts';
	import { onMount } from 'svelte';
	import { CalendarX, Fuel, LoaderCircle, Receipt, Star } from '@lucide/svelte';
	import * as Select from '#lib/components/ui/select/index.ts';
	import type * as Chart from '#lib/components/ui/chart/index.ts';
	import { AppBarChart, AppLineChart } from '#lib/components/charts/index.ts';
	import StatCardGrid from '#lib/components/charts/StatCardGrid.svelte';
	import {
		buildCategoryPieData,
		buildChartConfig,
		getCategoryLabel
	} from '#lib/utils/chart-colors.ts';
	import { analyticsApi } from '#lib/services/analytics-api.ts';
	import { vehicleApi } from '#lib/services/vehicle-api.ts';
	import type { AnalyticsBucketItems, AnalyticsQueryResponse, Vehicle } from '#lib/types/index.ts';
	import {
		formatCurrency,
		formatDateWith,
		formatNumber,
		formatNumberUpTo
	} from '#lib/utils/formatters.ts';
	import { formatDecimalAxis, unitTooltip } from '#lib/utils/chart-formatters.ts';
	import { settingsStore } from '#lib/stores/settings.svelte.ts';
	import { getFuelEfficiencyLabel, getDistanceUnitLabel } from '#lib/utils/units.ts';
	import { IsMobile } from '#lib/hooks/is-mobile.svelte.ts';
	import ChartGroup from './fuel/ChartGroup.svelte';
	import { bucketDate } from './explore/explore-data';
	import {
		YEAR_QUERIES,
		biggestMonth,
		cheapestToRun,
		mostFills,
		percentChange,
		yearCounts,
		yearRange,
		yearRequests,
		type YearQuery
	} from './year-review/year-overview';

	const currentYear = new Date().getFullYear();
	const years = Array.from({ length: 5 }, (_, i) => currentYear - i);

	let selectedYear = $state(currentYear);
	let largest = $state<AnalyticsBucketItems | null>(null);
	let vehicles = $state<Vehicle[]>([]);
	let results = $state<Record<YearQuery, AnalyticsQueryResponse> | null>(null);
	let isLoading = $state(true);
	let error = $state<string | null>(null);
	let request = 0;

	async function loadData(year: number) {
		const current = ++request;
		const queries = yearRequests(year);
		const { start, end } = yearRange(year);
		try {
			isLoading = true;
			const [items, cars, ...responses] = await Promise.all([
				analyticsApi.queryItems({ start, end, include: 'all', metric: 'cost' }),
				vehicleApi.getVehicles({ includeShared: true }),
				...YEAR_QUERIES.map(key => analyticsApi.query(queries[key]))
			]);
			if (current !== request) return;
			largest = items;
			vehicles = cars;
			results = Object.fromEntries(
				YEAR_QUERIES.map((key, i) => [key, responses[i] as AnalyticsQueryResponse])
			) as Record<YearQuery, AnalyticsQueryResponse>;
			error = null;
		} catch (e) {
			if (current !== request) return;
			error = userFacingErrorMessage(e);
		} finally {
			if (current === request) isLoading = false;
		}
	}

	function handleYearChange(value: string | undefined) {
		if (!value) return;
		selectedYear = Number.parseInt(value, 10);
		error = null;
		loadData(selectedYear);
	}

	onMount(() => {
		loadData(selectedYear);
	});

	let units = $derived(settingsStore.unitPreferences);
	let efficiencyLabel = $derived(getFuelEfficiencyLabel(units.distanceUnit, units.volumeUnit));
	let distShort = $derived(getDistanceUnitLabel(units.distanceUnit, true));
	let distLong = $derived(getDistanceUnitLabel(units.distanceUnit).toLowerCase());
	let distWord = $derived(units.distanceUnit === 'kilometers' ? 'kilometer' : 'mile');
	let soFar = $derived(yearRange(selectedYear).soFar);
	const monthName = (bucket: string, month: 'short' | 'long' = 'short') =>
		formatDateWith(bucketDate(bucket), { month });

	let monthly = $derived(results?.monthly ?? null);
	let ownedCount = $derived(vehicles.filter(v => !v.sharedAccess).length);
	let hasShared = $derived(vehicles.some(v => v.sharedAccess));
	let total = $derived(monthly?.totals.value ?? 0);
	let categories = $derived.by(() => {
		const breakdown = (results?.categories.series ?? []).map(s => ({
			category: s.key,
			amount: s.values[0] ?? 0
		}));
		const rows = buildCategoryPieData(breakdown).sort((a, b) => b.value - a.value);
		const max = rows[0]?.value ?? 0;
		return rows.map(r => ({ ...r, share: max > 0 ? r.value / max : 0 }));
	});
	let tally = $derived(yearCounts(results?.counts ?? null));
	let peak = $derived(biggestMonth(monthly));
	let cheapest = $derived(cheapestToRun(results?.running ?? null));
	let fillLeader = $derived(mostFills(results?.fills ?? null));
	let change = $derived(percentChange(total, results?.previous.totals.value));
	let biggestExpense = $derived.by(() => {
		const item = largest?.items[0];
		if (!item) return null;
		return {
			description: item.description || getCategoryLabel(item.category),
			amount: item.amount,
			date: new Date(item.date * 1000)
		};
	});

	const isMobile = new IsMobile();
	let monthRows = $derived(
		(monthly?.buckets ?? []).map((bucket, i) => ({
			label: monthName(bucket),
			value: monthly?.series[0]?.values[i] ?? 0
		}))
	);
	let monthTicks = $derived(
		monthRows.filter((_, i) => i % (isMobile.current ? 3 : 1) === 0).map(r => r.label)
	);
	let monthAverage = $derived(monthly?.totals.perBucket ?? null);
	const monthSeries = [{ key: 'value', label: 'Spent', color: 'var(--chart-1)' }];
	const monthConfig: Chart.ChartConfig = { value: { label: 'Spent', color: 'var(--chart-1)' } };

	let effTrendData = $derived.by(() => {
		const eff = results?.efficiency;
		return (eff?.buckets ?? []).flatMap((bucket, i) => {
			const efficiency = eff?.series[0]?.values[i];
			return efficiency == null ? [] : [{ date: bucketDate(bucket), efficiency }];
		});
	});
	let effTrendSeries = $derived([
		{ key: 'efficiency', label: efficiencyLabel, color: 'var(--chart-1)' }
	]);
	let effTrendConfig = $derived(buildChartConfig(effTrendSeries));

	let carsText = $derived(`${ownedCount} ${ownedCount === 1 ? 'vehicle' : 'vehicles'}`);
	let detailTiles = $derived.by(() => {
		const avgEff = results?.efficiency.totals.value ?? null;
		const perDistance = monthly?.totals.perDistance ?? null;
		return [
			{
				label: `Average ${efficiencyLabel}`,
				value: avgEff != null ? formatNumber(avgEff, 1) : 'N/A',
				subtitle: 'Fuel, across your cars'
			},
			{
				label: `Cost per ${distWord}`,
				value: perDistance != null ? formatCurrency(perDistance) : 'N/A',
				subtitle: 'All costs'
			},
			{
				label: `Total ${distLong}`,
				value: formatNumberUpTo(monthly?.totals.distance ?? 0, 1),
				subtitle: carsText
			}
		];
	});
</script>

<div class="space-y-6 md:space-y-8">
	<div class="flex justify-end">
		<Select.Root type="single" value={String(selectedYear)} onValueChange={handleYearChange}>
			<Select.Trigger aria-label="Report year" class="w-fit gap-2 font-medium">
				{selectedYear}
			</Select.Trigger>
			<Select.Content>
				{#each years as year (year)}
					<Select.Item value={String(year)} label={String(year)}>{year}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	</div>

	{#if isLoading && !error}
		<div class="flex justify-center p-12">
			<LoaderCircle class="h-8 w-8 animate-spin text-muted-foreground" />
		</div>
	{:else if error}
		<LoadErrorCard
			title="Couldn't load year-end summary"
			message={error}
			onRetry={() => loadData(selectedYear)}
		/>
	{:else if results && total <= 0}
		{@render sharedNote()}
		<EmptyState level={2}>
			{#snippet icon()}
				<div class="mb-4 rounded-full bg-muted p-4">
					<CalendarX class="h-8 w-8 text-muted-foreground" aria-hidden="true" />
				</div>
			{/snippet}
			{#snippet title()}No expenses in {selectedYear}{/snippet}
			{#snippet description()}Pick another year, or log an expense to start this one.{/snippet}
		</EmptyState>
	{:else if results}
		<section aria-label="{selectedYear} in review" class="space-y-8">
			{@render sharedNote()}
			<div class="grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-10">
				<div class="space-y-2">
					<HeroFigure
						label="{selectedYear}{soFar ? ' so far' : ''} · {carsText}"
						value={formatCurrency(total, undefined, 0)}
					/>
					<p class="max-w-md text-muted-foreground">
						Across <strong class="text-foreground">{formatNumber(tally.expenses, 0)}</strong>
						expenses and <strong class="text-foreground">{formatNumber(tally.fills, 0)}</strong>
						fill-ups and charges.
						{#if peak}
							The biggest month was <strong class="text-foreground">
								{monthName(peak.bucket, 'long')}
							</strong>
							({formatCurrency(peak.value, undefined, 0)}).
						{/if}
						{#if change != null && change !== 0}
							That's {formatNumber(Math.abs(change), 0)}% {change > 0 ? 'more' : 'less'} than
							{soFar ? `the same point in ${selectedYear - 1}` : selectedYear - 1}.
						{/if}
					</p>
				</div>
				{#if categories.length > 0}
					<div class="space-y-3">
						<h2 class="text-lg font-semibold" id="year-category-title">
							Where it went, {selectedYear}
						</h2>
						<ul class="space-y-2" aria-labelledby="year-category-title">
							{#each categories as row (row.key)}
								<li
									class="grid grid-cols-[minmax(0,8rem)_minmax(4rem,1fr)_auto] items-center gap-3 text-sm"
								>
									<span class="break-words">{row.label}</span>
									<span class="h-2.5 rounded-full bg-muted-foreground/15" aria-hidden="true">
										<span
											class="block h-full rounded-full"
											style:width="{Math.max(2, row.share * 100)}%"
											style:background-color={row.color}
										></span>
									</span>
									<span class="font-semibold tabular-nums">
										{formatCurrency(row.value, undefined, 0)}
									</span>
								</li>
							{/each}
						</ul>
					</div>
				{/if}
			</div>

			<div class="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-10">
				{#if monthRows.length > 0}
					<AppBarChart
						level={2}
						title="All-in spend by month, {selectedYear}"
						description="Every expense, including loan and insurance payments"
						data={monthRows}
						x="label"
						series={monthSeries}
						config={monthConfig}
						height={220}
						referenceLines={monthAverage != null
							? [{ value: monthAverage, label: 'Monthly average' }]
							: []}
						xAxisProps={{ ticks: monthTicks, format: (v: unknown) => String(v) }}
						yAxisFormat={v => formatCurrency(v, undefined, 0)}
						tooltipFormat={v => formatCurrency(Number(v))}
						tooltipLabelFormat={v => String(v)}
					/>
				{/if}
				<div class="space-y-3">
					<h2 class="text-lg font-semibold" id="year-highlights-title">Highlights</h2>
					<ul class="divide-y" aria-labelledby="year-highlights-title">
						{#if cheapest}
							<li class="flex items-center justify-between gap-3 py-3">
								<div>
									<p class="font-medium">Cheapest car to run</p>
									<p class="text-sm text-muted-foreground">
										{cheapest.label} · {formatCurrency(cheapest.value, undefined, 2)}/{distShort}
										running costs
									</p>
								</div>
								<Star class="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
							</li>
						{/if}
						{#if fillLeader}
							<li class="flex items-center justify-between gap-3 py-3">
								<div>
									<p class="font-medium">Most fill-ups and charges</p>
									<p class="text-sm text-muted-foreground">
										{fillLeader.label} · {formatNumber(fillLeader.value, 0)}
									</p>
								</div>
								<Fuel class="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
							</li>
						{/if}
						{#if biggestExpense}
							<li class="flex items-center justify-between gap-3 py-3">
								<div>
									<p class="font-medium">Biggest single expense</p>
									<p class="text-sm text-muted-foreground">
										{biggestExpense.description} · {formatCurrency(biggestExpense.amount)} · {formatDateWith(
											biggestExpense.date,
											{
												month: 'short',
												day: 'numeric'
											}
										)}
									</p>
								</div>
								<Receipt class="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
							</li>
						{/if}
					</ul>
				</div>
			</div>
		</section>

		<ChartGroup title="More detail" description="Fuel economy, cost per {distWord} and distance">
			<div class="space-y-4 md:space-y-6">
				<StatCardGrid items={detailTiles} columns={3} />
				{#if effTrendData.length > 0}
					<AppLineChart
						level={3}
						title="{efficiencyLabel} by month"
						description="Fuel economy across the cars you own, {selectedYear}"
						data={effTrendData}
						x="date"
						y="efficiency"
						series={effTrendSeries}
						config={effTrendConfig}
						yAxisFormat={formatDecimalAxis}
						tooltipFormat={unitTooltip(efficiencyLabel)}
					/>
				{/if}
			</div>
		</ChartGroup>
	{/if}
</div>

{#snippet sharedNote()}
	{#if hasShared}
		<p class="text-sm text-muted-foreground">
			These figures cover the {carsText} you own. Cars shared with you aren't included yet.
		</p>
	{/if}
{/snippet}
