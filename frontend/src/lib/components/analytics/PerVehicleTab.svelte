<script lang="ts">
	import LoadErrorCard from '#lib/components/common/LoadErrorCard.svelte';
	import { userFacingErrorMessage } from '#lib/utils/error-handling.ts';
	import { onMount, untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import { routes } from '#lib/routes.ts';
	import { LoaderCircle, SearchX } from '@lucide/svelte';
	import EmptyState from '#lib/components/common/empty-state.svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Card from '#lib/components/ui/card/index.ts';
	import type * as Chart from '#lib/components/ui/chart/index.ts';
	import { Progress } from '#lib/components/ui/progress/index.ts';
	import { analyticsApi, getDefaultDateRange } from '#lib/services/analytics-api.ts';
	import { vehicleApi } from '#lib/services/vehicle-api.ts';
	import { AppBarChart } from '#lib/components/charts/index.ts';
	import StatCardGrid from '#lib/components/charts/StatCardGrid.svelte';
	import { buildCategoryPieData } from '#lib/utils/chart-colors.ts';
	import type {
		AnalyticsQueryResponse,
		Vehicle,
		VehicleHealthResponse,
		VehicleTCOResponse,
		VehicleExpensesResponse
	} from '#lib/types/index.ts';
	import { formatCurrency, formatNumberUpTo } from '#lib/utils/formatters.ts';
	import { settingsStore } from '#lib/stores/settings.svelte.ts';
	import { getDistanceUnitLabel } from '#lib/utils/units.ts';
	import { IsMobile } from '#lib/hooks/is-mobile.svelte.ts';
	import HeroFigure from '#lib/components/common/hero-figure.svelte';
	import type { AnalyticsDateRange } from './analytics-filters';
	import ChartGroup from './fuel/ChartGroup.svelte';
	import { bucketLabel } from './explore/explore-data';
	import {
		categoryRows,
		perHero,
		perVehicleRequests,
		singleValue
	} from './per-vehicle/per-overview';

	interface Props {
		dateRange?: AnalyticsDateRange;
		preferredVehicleId?: string;
		filterLabel?: string;
		onClearFilters?: () => void;
		vehicleColors?: Record<string, string>;
		hiddenFinancials?: ReadonlySet<string>;
		rangeText?: string;
	}

	let {
		dateRange = getDefaultDateRange(),
		preferredVehicleId,
		filterLabel,
		onClearFilters,
		vehicleColors,
		hiddenFinancials = new Set<string>(),
		rangeText = 'Last 12 months'
	}: Props = $props();

	let vehicles = $state<Vehicle[]>([]);
	let selectedVehicleId = $state<string>('');
	let health = $state<VehicleHealthResponse | null>(null);
	let tco = $state<VehicleTCOResponse | null>(null);
	let expenses = $state<VehicleExpensesResponse | null>(null);
	let byCategory = $state<AnalyticsQueryResponse | null>(null);
	let allInRate = $state<AnalyticsQueryResponse | null>(null);
	let runningRate = $state<AnalyticsQueryResponse | null>(null);
	let monthly = $state<AnalyticsQueryResponse | null>(null);
	let isLoadingVehicles = $state(true);
	let isLoadingData = $state(false);
	let error = $state<string | null>(null);
	let request = 0;
	let vehiclesLoadError = $state<string | null>(null);

	async function loadVehicles() {
		try {
			isLoadingVehicles = true;
			vehicles = await vehicleApi.getVehicles({ includeShared: true });
			vehiclesLoadError = null;
		} catch (e) {
			vehiclesLoadError = userFacingErrorMessage(e);
		} finally {
			isLoadingVehicles = false;
		}
	}

	function inOtherCurrency(vehicle: Vehicle | undefined): boolean {
		const own = settingsStore.settings?.currencyUnit ?? 'USD';
		return !!vehicle?.sharedAccess && !!vehicle.ownerCurrency && vehicle.ownerCurrency !== own;
	}

	function loadLifetime(vehicleId: string, queryable: boolean) {
		const queries = queryable ? perVehicleRequests(vehicleId, dateRange).lifetime : [];
		return Promise.all([
			analyticsApi.getVehicleHealth(vehicleId),
			analyticsApi.getVehicleTCO(vehicleId),
			...queries.map(params => analyticsApi.query(params))
		]);
	}

	let lifetime: { key: string; data: ReturnType<typeof loadLifetime> } | null = null;

	async function loadVehicleData(vehicleId: string) {
		const current = ++request;
		const queryable = !inOtherCurrency(vehicles.find(v => v.id === vehicleId));
		try {
			isLoadingData = true;
			if (lifetime?.key !== vehicleId) {
				const entry = { key: vehicleId, data: loadLifetime(vehicleId, queryable) };
				entry.data.catch(() => {
					if (lifetime === entry) lifetime = null;
				});
				lifetime = entry;
			}
			const monthlyQuery = perVehicleRequests(vehicleId, dateRange).monthly;
			const [[healthData, tcoData, categories, allIn, running], expensesData, months] =
				await Promise.all([
					lifetime.data,
					analyticsApi.getVehicleExpenses(vehicleId, dateRange),
					queryable ? analyticsApi.query(monthlyQuery) : null
				]);
			if (current !== request) return;
			health = healthData;
			tco = tcoData;
			byCategory = categories ?? null;
			allInRate = allIn ?? null;
			runningRate = running ?? null;
			expenses = expensesData;
			monthly = months;
			error = null;
		} catch (e) {
			if (current !== request) return;
			error = userFacingErrorMessage(e);
		} finally {
			if (current === request) isLoadingData = false;
		}
	}

	function selectVehicle(id: string) {
		selectedVehicleId = id;
		error = null;
	}

	onMount(() => {
		loadVehicles();
	});

	$effect(() => {
		if (isLoadingVehicles || vehicles.length === 0) return;
		const preferred = vehicles.find(v => v.id === preferredVehicleId)?.id;
		selectedVehicleId = untrack(
			() =>
				preferred ??
				(vehicles.some(v => v.id === selectedVehicleId) ? selectedVehicleId : vehicles[0]!.id)
		);
	});

	$effect(() => {
		void dateRange.startDate;
		void dateRange.endDate;
		if (selectedVehicleId) untrack(() => void loadVehicleData(selectedVehicleId));
	});

	let selectedVehicle = $derived(vehicles.find(v => v.id === selectedVehicleId));
	const carName = (v: Vehicle) => v.nickname || `${v.year} ${v.make} ${v.model}`;

	let units = $derived(selectedVehicle?.unitPreferences ?? settingsStore.unitPreferences);
	let distLongLabel = $derived(getDistanceUnitLabel(units.distanceUnit));
	let distShort = $derived(getDistanceUnitLabel(units.distanceUnit, true));
	let distWord = $derived(units.distanceUnit === 'kilometers' ? 'kilometer' : 'mile');
	let rangePhrase = $derived(
		/^(Last |Year to date|All time)/.test(rangeText) ? rangeText.toLowerCase() : rangeText
	);

	let hideFinancial = $derived(hiddenFinancials.has(selectedVehicleId));
	let rows = $derived(categoryRows(byCategory, hideFinancial));
	let hero = $derived(perHero(rows));
	let rates = $derived([
		...(hideFinancial ? [] : [{ label: 'All in, lifetime', value: singleValue(allInRate) }]),
		{ label: 'Running, lifetime', value: singleValue(runningRate) },
		{ label: `Running, ${rangePhrase}`, value: monthly?.totals.perDistance ?? null }
	]);

	let monthRows = $derived(
		(monthly?.buckets ?? []).map((bucket, i) => ({
			label: bucketLabel(bucket, 'month'),
			value: monthly?.series[0]?.values[i] ?? 0
		}))
	);
	const isMobile = new IsMobile();
	let monthTicks = $derived.by(() => {
		const step = Math.max(1, Math.ceil(monthRows.length / (isMobile.current ? 4 : 12)));
		return monthRows.filter((_, i) => i % step === 0).map(r => r.label);
	});
	let monthAverage = $derived(monthly?.totals.perBucket ?? null);
	const monthSeries = [{ key: 'value', label: 'Running costs', color: 'var(--chart-1)' }];
	const monthConfig: Chart.ChartConfig = {
		value: { label: 'Running costs', color: 'var(--chart-1)' }
	};

	let breakdownRows = $derived(
		buildCategoryPieData(expenses?.expenseBreakdown ?? [])
			.filter(r => !(hideFinancial && r.key === 'financial'))
			.sort((a, b) => b.value - a.value)
	);
	const breakdownSeries = [{ key: 'value', label: 'Spent', color: 'var(--chart-1)' }];
	const breakdownConfig: Chart.ChartConfig = { value: { label: 'Spent', color: 'var(--chart-1)' } };
	let rangeEmpty = $derived(breakdownRows.length === 0 && !monthRows.some(r => r.value > 0));

	// Tier colours fail WCAG contrast as text on their tint; the ring and a label carry the tier.
	function getScoreBgColor(score: number): string {
		if (score >= 70) return 'bg-chart-2/10';
		if (score >= 40) return 'bg-warning/10';
		return 'bg-destructive/10';
	}

	function getScoreLabel(score: number): string {
		if (score >= 70) return 'Good';
		if (score >= 40) return 'Fair';
		return 'Needs attention';
	}

	let healthParts = $derived(
		health
			? [
					{ label: 'Maintenance Regularity', score: health.maintenanceRegularity },
					{ label: 'Mileage Adherence', score: health.mileageIntervalAdherence },
					{ label: 'Insurance Coverage', score: health.insuranceCoverage }
				]
			: []
	);

	let tcoSummaryItems = $derived.by(() => {
		if (!tco) return [];
		const ownership = [
			{ label: 'Total cost of ownership', value: formatCurrency(tco.totalCost) },
			{
				label: `Ownership cost per ${distWord}`,
				value: tco.costPerDistance != null ? formatCurrency(tco.costPerDistance) : 'N/A'
			}
		];
		return [
			...(hideFinancial ? [] : ownership),
			{ label: 'Cost per month', value: formatCurrency(tco.costPerMonth) },
			{
				label: `Total ${distLongLabel.toLowerCase()}`,
				value: formatNumberUpTo(tco.totalDistance, 1)
			}
		];
	});
</script>

{#if isLoadingVehicles && !vehiclesLoadError}
	<div class="flex justify-center p-12">
		<LoaderCircle class="h-8 w-8 animate-spin text-muted-foreground" />
	</div>
{:else if vehiclesLoadError}
	<LoadErrorCard
		title="Couldn't load your vehicles"
		message={vehiclesLoadError}
		onRetry={loadVehicles}
	/>
{:else if vehicles.length === 0}
	<div class="rounded-lg border bg-card p-6 text-center">
		<p class="text-muted-foreground mb-4">No vehicles found. Add a vehicle to see analytics.</p>
		<Button href={resolve(routes.vehicleNew)}>Add Vehicle</Button>
	</div>
{:else}
	<div class="space-y-6 md:space-y-8">
		<div role="group" aria-label="Car" class="flex flex-wrap gap-2">
			{#each vehicles as vehicle (vehicle.id)}
				{@const selected = vehicle.id === selectedVehicleId}
				<button
					type="button"
					aria-pressed={selected}
					onclick={() => selectVehicle(vehicle.id)}
					class="inline-flex min-h-10 items-center gap-2 rounded-full border px-4 text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 {selected
						? 'border-foreground bg-foreground text-background'
						: 'bg-card hover:bg-muted'}"
				>
					<span
						class="h-2.5 w-2.5 shrink-0 rounded-full"
						aria-hidden="true"
						style:background-color={vehicleColors?.[vehicle.id] ?? 'var(--chart-1)'}
					></span>
					{carName(vehicle)}
				</button>
			{/each}
		</div>

		{#if isLoadingData && !error}
			<div class="flex justify-center p-12">
				<LoaderCircle class="h-8 w-8 animate-spin text-muted-foreground" />
			</div>
		{:else if error}
			<LoadErrorCard
				title="Couldn't load vehicle analytics"
				message={error}
				onRetry={() => selectedVehicleId && loadVehicleData(selectedVehicleId)}
			/>
		{:else if health && tco && expenses && selectedVehicle && inOtherCurrency(selectedVehicle)}
			<p class="max-w-xl text-muted-foreground">
				{carName(selectedVehicle)} is shared with you and kept in {selectedVehicle.ownerCurrency},
				so it isn't summed into the overview. Here are its health score and the totals you can see.
			</p>
			{#if filterLabel && onClearFilters && breakdownRows.length === 0}
				{@render noExpenses(filterLabel, onClearFilters)}
			{/if}
			{@render detail(health, 2)}
		{:else if health && tco && expenses && selectedVehicle}
			<section aria-label="{carName(selectedVehicle)} overview" class="space-y-8">
				<div class="grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-10">
					<div class="space-y-2">
						<HeroFigure
							label="{carName(selectedVehicle)}, all time"
							value={formatCurrency(hero?.total ?? 0, undefined, 0)}
						/>
						{#if hero?.top || hero?.running != null}
							<p class="max-w-md text-muted-foreground">
								{#if hero.top}{hero.top.percent}% of it went on {hero.top.reason}.{/if}
								{#if hero.running != null}
									Running costs were
									<strong class="text-foreground">
										{formatCurrency(hero.running, undefined, 0)}
									</strong>.
								{/if}
							</p>
						{/if}
					</div>
					{#if rows.length > 0}
						<div class="space-y-3">
							<h2 class="text-base font-semibold" id="per-category-title">
								Where the money went, all time
							</h2>
							<ul class="space-y-2" aria-labelledby="per-category-title">
								{#each rows as row (row.category)}
									<li
										class="grid grid-cols-[minmax(0,8rem)_minmax(4rem,1fr)_auto] items-center gap-3 text-sm"
									>
										<span class="break-words">{row.label}</span>
										<span class="h-2.5 rounded-full bg-muted-foreground/15" aria-hidden="true">
											<span
												class="block h-full rounded-full bg-chart-1"
												style:width="{Math.max(2, row.share * 100)}%"
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

				{#if filterLabel}
					<p class="text-sm text-muted-foreground">
						The totals and lifetime rates cover this car's whole history. Spend by month follows the
						date range.
					</p>
				{/if}

				<div class="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:gap-10">
					{#if filterLabel && onClearFilters && rangeEmpty}
						{@render noExpenses(filterLabel, onClearFilters)}
					{:else if monthRows.length > 0}
						<AppBarChart
							level={2}
							title="Spend by month, running only"
							description="Fuel, maintenance and other running costs, {rangePhrase}"
							data={monthRows}
							x="label"
							series={monthSeries}
							config={monthConfig}
							height={220}
							referenceLines={monthAverage != null
								? [{ value: monthAverage, label: 'Monthly average' }]
								: []}
							fitTicks
							xAxisProps={{ ticks: monthTicks, format: (v: unknown) => String(v) }}
							yAxisFormat={v => formatCurrency(v, undefined, 0)}
							tooltipFormat={v => formatCurrency(Number(v))}
							tooltipLabelFormat={v => String(v)}
						/>
					{/if}
					<div class="space-y-3">
						<h2 class="text-base font-semibold" id="per-rate-title">Cost per {distWord}</h2>
						<dl class="divide-y text-sm" aria-labelledby="per-rate-title">
							{#each rates as rate (rate.label)}
								<div class="flex items-center justify-between gap-3 py-2">
									<dt class="text-muted-foreground">{rate.label}</dt>
									<dd class="font-semibold tabular-nums">
										{rate.value != null
											? `${formatCurrency(rate.value, undefined, 2)}/${distShort}`
											: 'Not enough data'}
									</dd>
								</div>
							{/each}
						</dl>
					</div>
				</div>
			</section>

			<ChartGroup
				title="More detail"
				description="Health score, ownership totals and spending by category for the range"
			>
				{@render detail(health, 3)}
			</ChartGroup>
		{/if}
	</div>
{/if}

{#snippet noExpenses(label: string, clear: () => void)}
	<EmptyState level={2}>
		{#snippet icon()}
			<div class="mb-4 rounded-full bg-muted p-4">
				<SearchX class="h-8 w-8 text-muted-foreground" aria-hidden="true" />
			</div>
		{/snippet}
		{#snippet title()}No expenses for {label}{/snippet}
		{#snippet description()}
			This car has no expenses in the chosen dates. Try a longer date range.
		{/snippet}
		{#snippet action()}
			<Button variant="outline" onclick={clear}>Clear filters</Button>
		{/snippet}
	</EmptyState>
{/snippet}

{#snippet detail(health: VehicleHealthResponse, level: 2 | 3)}
	<div class="space-y-4 md:space-y-6">
		<Card.Root>
			<Card.Header>
				<Card.Title {level}>Vehicle Health Score</Card.Title>
				<Card.Description>{health.vehicleName}</Card.Description>
			</Card.Header>
			<Card.Content>
				<div class="space-y-6">
					<div class="flex items-center gap-4">
						<div
							class="flex h-20 w-20 items-center justify-center rounded-full {getScoreBgColor(
								health.overallScore
							)}"
						>
							<span class="text-3xl font-bold text-foreground">
								{health.overallScore}
							</span>
						</div>
						<div>
							<p class="text-sm text-muted-foreground">Overall Score</p>
							<p class="text-lg font-medium">
								{getScoreLabel(health.overallScore)} · out of 100
							</p>
						</div>
					</div>

					<div class="grid gap-5 md:grid-cols-3">
						{#each healthParts as part (part.label)}
							<div class="space-y-2">
								<div class="flex items-center justify-between">
									<span class="text-sm font-medium">{part.label}</span>
									<span class="text-sm font-bold">{part.score}/100</span>
								</div>
								<Progress value={part.score} max={100} class="h-2" />
							</div>
						{/each}
					</div>
				</div>
			</Card.Content>
		</Card.Root>

		<StatCardGrid items={tcoSummaryItems} columns={4} />

		{#if breakdownRows.length > 0}
			<AppBarChart
				{level}
				title="Spending by category"
				description="All costs, {rangePhrase}"
				data={breakdownRows}
				x="value"
				y="label"
				orientation="horizontal"
				series={breakdownSeries}
				config={breakdownConfig}
				height={Math.max(160, breakdownRows.length * 44)}
				padding={{ top: 4, left: 112, bottom: 24, right: 16 }}
				xAxisProps={{ format: (v: number) => formatCurrency(v, undefined, 0), ticks: 4 }}
				yAxisFormat={v => String(v)}
				tooltipFormat={v => formatCurrency(Number(v))}
			/>
		{/if}
	</div>
{/snippet}
