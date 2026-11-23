<script lang="ts">
	import LoadErrorCard from '#lib/components/common/LoadErrorCard.svelte';
	import { userFacingErrorMessage } from '#lib/utils/error-handling.ts';
	import { onMount, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { LoaderCircle, Car, DollarSign, Route, TrendingUp } from '@lucide/svelte';
	import NoVehiclesEmptyState from '#lib/components/common/NoVehiclesEmptyState.svelte';
	import * as Tabs from '#lib/components/ui/tabs/index.ts';
	import PageHeader from '#lib/components/common/page-header.svelte';
	import StatCardGrid from '#lib/components/charts/StatCardGrid.svelte';
	import FuelStatsTab from '#lib/components/analytics/fuel/FuelStatsTab.svelte';
	import AnalyticsFilterBar from '#lib/components/analytics/AnalyticsFilterBar.svelte';
	import {
		DEFAULT_RANGE,
		carsLabel,
		filterDateRange,
		isDefaultFilters,
		parseAnalyticsFilters,
		previousPeriodLabel,
		rangeLabel,
		writeAnalyticsFilters,
		type AnalyticsFilters
	} from '#lib/components/analytics/analytics-filters.ts';
	import { analyticsApi } from '#lib/services/analytics-api.ts';
	import { formatCurrency, formatDate } from '#lib/utils/formatters.ts';
	import { getDistanceUnitLabel } from '#lib/utils/units.ts';
	import { CHART_COLORS } from '#lib/utils/chart-colors.ts';
	import { settingsStore } from '#lib/stores/settings.svelte.ts';
	import type { AnalyticsSummaryResponse, Vehicle } from '#lib/types/index.ts';

	let summary = $state<AnalyticsSummaryResponse | null>(null);
	let isLoading = $state(true);
	let error = $state<string | null>(null);
	let activeTab = $state('fuel-stats');
	let tabList = $state<HTMLElement | null>(null);
	let vehicles = $state<Vehicle[]>([]);
	let vehiclesLoaded = $state(false);
	let vehiclesError = $state<string | null>(null);
	let summaryRequest = 0;

	let filters = $derived(parseAnalyticsFilters(page.url.searchParams));
	let dateRange = $derived(filterDateRange(filters));
	let vehicleIds = $derived.by(() => {
		if (filters.cars.length === 0) return undefined;
		if (vehicles.length === 0) return filters.cars;
		const known = filters.cars.filter(id => vehicles.some(v => v.id === id));
		return known.length > 0 ? known : undefined;
	});
	let filtered = $derived(!isDefaultFilters(filters));
	let nonDefaultRange = $derived(filters.range !== DEFAULT_RANGE);
	let vehicleOptions = $derived(
		vehicles.map(v => ({
			id: v.id,
			name: `${v.year} ${v.make} ${v.model}${v.nickname ? ` (${v.nickname})` : ''}`
		}))
	);
	let filterLabel = $derived(
		`${rangeLabel(filters, d => formatDate(d))}, ${carsLabel(
			filters.cars,
			new Map(vehicleOptions.map(v => [v.id, v.name]))
		).toLowerCase()}`
	);
	let vehicleColors = $derived(
		Object.fromEntries(
			vehicles
				.map(v => v.id)
				.sort()
				.map((id, i) => [id, CHART_COLORS[i % CHART_COLORS.length] as string])
		)
	);

	function setFilters(next: AnalyticsFilters) {
		const url = writeAnalyticsFilters(page.url, next);
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- same route, only the query changes
		void goto(`${url.pathname}${url.search}`, { reset: false });
	}

	$effect(() => {
		if (!vehiclesLoaded || vehicles.length === 0 || filters.cars.length === 0) return;
		if (filters.cars.some(id => vehicles.some(v => v.id === id))) return;
		const url = writeAnalyticsFilters(page.url, { ...filters, cars: [] });
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- same route, only the query changes
		void goto(`${url.pathname}${url.search}`, { replace: true, reset: false });
	});

	async function clearFilters() {
		setFilters({ range: DEFAULT_RANGE, cars: [] });
		await tick();
		document.querySelector<HTMLElement>('[aria-label="Analytics filters"] button')?.focus();
	}

	async function loadVehicles() {
		try {
			const { vehicleApi } = await import('#lib/services/vehicle-api.ts');
			vehicles = await vehicleApi.getVehicles();
			vehiclesError = null;
		} catch (e) {
			vehicles = [];
			vehiclesError = userFacingErrorMessage(e);
		} finally {
			vehiclesLoaded = true;
		}
	}

	function revealActiveTab() {
		const active = tabList?.querySelector('[data-state="active"]');
		if (!tabList || !active) return;
		const list = tabList.getBoundingClientRect();
		const tab = active.getBoundingClientRect();
		if (tab.left < list.left) tabList.scrollLeft -= list.left - tab.left;
		else if (tab.right > list.right) tabList.scrollLeft += tab.right - list.right;
	}

	$effect(() => {
		void activeTab;
		void tick().then(revealActiveTab);
	});

	async function loadSummary() {
		const request = ++summaryRequest;
		try {
			isLoading = true;
			const result = await analyticsApi.getSummary({
				...dateRange,
				ytdStart: nonDefaultRange ? dateRange.startDate : dateRange.ytdStart,
				vehicleIds
			});
			if (request !== summaryRequest) return;
			summary = result;
			error = null;
		} catch (e) {
			if (request !== summaryRequest) return;
			error = userFacingErrorMessage(e);
		} finally {
			if (request === summaryRequest) isLoading = false;
		}
	}

	$effect(() => {
		void dateRange.startDate;
		void dateRange.endDate;
		void vehicleIds;
		if (filters.cars.length > 0 && !vehiclesLoaded) return;
		void loadSummary();
	});

	let quickStats = $derived(summary?.quickStats ?? null);
	let noVehicles = $derived(!isLoading && !error && quickStats?.vehicleCount === 0 && !vehicleIds);
	let showTabs = $derived(quickStats ? quickStats.vehicleCount > 0 || !!vehicleIds : !!error);
	let fuelStats = $derived(summary?.fuelStats ?? null);
	let fuelAdvanced = $derived(summary?.fuelAdvanced ?? null);

	let units = $derived(quickStats?.units ?? settingsStore.unitPreferences);
	let costPerDistanceLabel = $derived(`Cost per ${getDistanceUnitLabel(units.distanceUnit, true)}`);

	const FLEET_HEALTH_SUBTITLE = 'Service regularity, service mileage and insurance cover';

	let quickStatsItems = $derived(
		quickStats
			? [
					{
						label: 'Total Vehicles',
						value: quickStats.vehicleCount,
						icon: Car,
						iconColor: 'primary'
					},
					{
						label: nonDefaultRange ? 'Spending' : 'YTD Spending',
						value: formatCurrency(quickStats.ytdSpending),
						subtitle: nonDefaultRange ? rangeLabel(filters, d => formatDate(d)) : undefined,
						icon: DollarSign,
						iconColor: 'chart-1'
					},
					{
						label: costPerDistanceLabel,
						value:
							quickStats.costPerDistance != null
								? formatCurrency(quickStats.costPerDistance)
								: 'N/A',
						icon: Route,
						iconColor: 'chart-2'
					},
					{
						label: 'Fleet Health',
						value: quickStats.vehicleCount > 0 ? `${quickStats.fleetHealthScore} / 100` : '—',
						subtitle:
							quickStats.vehicleCount > 0 ? FLEET_HEALTH_SUBTITLE : 'Add a vehicle to get a score',
						icon: TrendingUp,
						iconColor: 'chart-5'
					}
				]
			: []
	);

	const QUICK_STAT_SKELETONS = [
		{ label: 'vehicles', value: '', icon: Car },
		{ label: 'spending', value: '', icon: DollarSign },
		{ label: 'cost', value: '', icon: Route },
		{ label: 'health', value: '', subtitle: FLEET_HEALTH_SUBTITLE, icon: TrendingUp }
	];

	onMount(() => {
		void loadVehicles();
	});
</script>

<svelte:head>
	<title>Analytics - VROOM Car Tracker</title>
	<meta name="description" content="Analyze your vehicle expenses and trends" />
</svelte:head>

<div class="min-h-screen space-y-4 md:space-y-6">
	<PageHeader
		title="Analytics Dashboard"
		description="Comprehensive insights into your vehicle spending patterns and trends"
	/>

	{#if !noVehicles}
		<AnalyticsFilterBar
			{filters}
			vehicles={vehicleOptions}
			onChange={setFilters}
			{vehiclesError}
			onRetryVehicles={loadVehicles}
		/>
	{/if}

	{#if isLoading && !error}
		<StatCardGrid items={QUICK_STAT_SKELETONS} columns={4} isLoading />
	{:else if error}
		<LoadErrorCard title="Couldn't load analytics" message={error} onRetry={loadSummary} />
	{:else if noVehicles}
		<NoVehiclesEmptyState
			description="Analytics compare what your vehicles cost over time. Add one and log a few expenses to see them."
		/>
	{:else if quickStats}
		<StatCardGrid items={quickStatsItems} columns={4} />
	{/if}

	{#if showTabs}
		<Tabs.Root bind:value={activeTab} class="space-y-4 md:space-y-6">
			<Tabs.List
				bind:ref={tabList}
				class="w-full justify-start overflow-x-auto lg:grid lg:grid-cols-4"
			>
				<Tabs.Trigger value="fuel-stats" class="shrink-0 px-1.5 text-xs sm:px-3 sm:text-sm">
					Fuel & Stats
				</Tabs.Trigger>
				<Tabs.Trigger value="cross-vehicle" class="shrink-0 px-1.5 text-xs sm:px-3 sm:text-sm">
					Cross-Vehicle
				</Tabs.Trigger>
				<Tabs.Trigger value="per-vehicle" class="shrink-0 px-1.5 text-xs sm:px-3 sm:text-sm">
					Per-Vehicle
				</Tabs.Trigger>
				<Tabs.Trigger value="year-end" class="shrink-0 px-1.5 text-xs sm:px-3 sm:text-sm">
					Year-End
				</Tabs.Trigger>
			</Tabs.List>

			{#if activeTab === 'fuel-stats'}
				<Tabs.Content value="fuel-stats">
					<FuelStatsTab
						{fuelStats}
						{fuelAdvanced}
						{vehicleColors}
						previousPeriodLabel={previousPeriodLabel(filters)}
						{dateRange}
						{vehicleIds}
						filterLabel={filtered ? filterLabel : undefined}
						onClearFilters={filtered ? clearFilters : undefined}
					/>
				</Tabs.Content>
			{:else if activeTab === 'cross-vehicle'}
				<Tabs.Content value="cross-vehicle">
					{#await import('#lib/components/analytics/CrossVehicleTab.svelte')}
						<div class="flex justify-center p-8">
							<LoaderCircle class="h-8 w-8 animate-spin text-muted-foreground" />
						</div>
					{:then { default: CrossVehicleTab }}
						<CrossVehicleTab
							{dateRange}
							{vehicleIds}
							{vehicleColors}
							filterLabel={filtered ? filterLabel : undefined}
							onClearFilters={filtered ? clearFilters : undefined}
						/>
					{/await}
				</Tabs.Content>
			{:else if activeTab === 'per-vehicle'}
				<Tabs.Content value="per-vehicle">
					{#await import('#lib/components/analytics/PerVehicleTab.svelte')}
						<div class="flex justify-center p-8">
							<LoaderCircle class="h-8 w-8 animate-spin text-muted-foreground" />
						</div>
					{:then { default: PerVehicleTab }}
						<PerVehicleTab
							{dateRange}
							preferredVehicleId={vehicleIds?.[0]}
							filterLabel={filtered ? filterLabel : undefined}
							onClearFilters={filtered ? clearFilters : undefined}
						/>
					{/await}
				</Tabs.Content>
			{:else if activeTab === 'year-end'}
				<Tabs.Content value="year-end">
					{#await import('#lib/components/analytics/YearEndTab.svelte')}
						<div class="flex justify-center p-8">
							<LoaderCircle class="h-8 w-8 animate-spin text-muted-foreground" />
						</div>
					{:then { default: YearEndTab }}
						<YearEndTab />
					{/await}
				</Tabs.Content>
			{/if}
		</Tabs.Root>
	{/if}
</div>
