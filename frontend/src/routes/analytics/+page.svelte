<script lang="ts">
	import LoadErrorCard from '#lib/components/common/LoadErrorCard.svelte';
	import { userFacingErrorMessage } from '#lib/utils/error-handling.ts';
	import { onMount, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { LoaderCircle } from '@lucide/svelte';
	import NoVehiclesEmptyState from '#lib/components/common/NoVehiclesEmptyState.svelte';
	import * as Tabs from '#lib/components/ui/tabs/index.ts';
	import PageHeader from '#lib/components/common/page-header.svelte';
	import { Skeleton } from '#lib/components/ui/skeleton/index.ts';
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
	import {
		exploreRequest,
		parseExplore,
		prefetchExplore,
		writeExplore,
		type ExploreQuery
	} from '#lib/components/analytics/explore/query-state.ts';
	import { analyticsApi } from '#lib/services/analytics-api.ts';
	import { formatDate } from '#lib/utils/formatters.ts';
	import { buildVehicleColorMap } from '#lib/utils/chart-colors.ts';
	import type { AnalyticsSummaryResponse, Vehicle } from '#lib/types/index.ts';

	let summary = $state<AnalyticsSummaryResponse | null>(null);
	let isLoading = $state(true);
	let error = $state<string | null>(null);
	const TAB_TITLES: Record<string, string> = {
		explore: 'Explore',
		'fuel-stats': 'Fuel & charging',
		'cross-vehicle': 'Cross-vehicle',
		'per-vehicle': 'Per-vehicle',
		'year-end': 'Year in review',
		drivers: 'Drivers'
	};
	let activeTab = $state('explore');
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
	let sharedCars = $derived(vehicles.filter(v => v.carShare?.enabled));
	let hiddenFinancials = $derived(
		new Set(vehicles.filter(v => v.sharedAccess && !v.sharedAccess.seesFinancials).map(v => v.id))
	);
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
	let vehicleColors = $derived(buildVehicleColorMap(vehicles.map(v => v.id)));

	function setFilters(next: AnalyticsFilters) {
		const url = writeExplore(writeAnalyticsFilters(page.url, next), {
			...explore,
			sel: undefined,
			seg: undefined
		});
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

	let explore = $derived(parseExplore(page.url.searchParams));

	function applyInsight(insightQuery: Record<string, string>) {
		const withFilters = writeAnalyticsFilters(page.url, {
			...filters,
			...(insightQuery['range'] === 'all' && { range: 'all', from: undefined, to: undefined }),
			cars: insightQuery['cars'] ? [insightQuery['cars']] : filters.cars
		});
		const url = writeExplore(withFilters, parseExplore(new URLSearchParams(insightQuery)));
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- same route, only the query changes
		void goto(`${url.pathname}${url.search}`, { reset: false });
	}

	function setExplore(next: ExploreQuery) {
		const url = writeExplore(page.url, next);
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- same route, only the query changes
		void goto(`${url.pathname}${url.search}`, { reset: false });
	}

	function onlyCar(id: string) {
		const withCar = writeAnalyticsFilters(page.url, { ...filters, cars: [id] });
		const url = writeExplore(withCar, { ...explore, sel: undefined, seg: undefined, hide: [] });
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- same route, only the query changes
		void goto(`${url.pathname}${url.search}`, { reset: false });
	}

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

	let tabFade = $state({ left: false, right: false });
	let tabMask = $derived(
		tabFade.left || tabFade.right
			? `mask-image: linear-gradient(to right, ${tabFade.left ? 'transparent, black 24px' : 'black'}, ${tabFade.right ? 'black calc(100% - 32px), transparent' : 'black'})`
			: undefined
	);

	$effect(() => {
		if (!tabList) return;
		const observer = new ResizeObserver(updateTabFade);
		observer.observe(tabList);
		for (const tab of tabList.children) observer.observe(tab);
		return () => observer.disconnect();
	});

	function updateTabFade() {
		if (!tabList) return;
		const { scrollLeft, scrollWidth, clientWidth } = tabList;
		tabFade = { left: scrollLeft > 4, right: scrollLeft + clientWidth < scrollWidth - 4 };
	}

	$effect(() => {
		void activeTab;
		void tick().then(() => {
			revealActiveTab();
			updateTabFade();
		});
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

	onMount(() => {
		prefetchExplore(exploreRequest(explore, dateRange, vehicleIds));
		import('#lib/components/analytics/explore/ExploreTab.svelte').catch(() => {});
		void loadVehicles();
	});
</script>

<svelte:head>
	<title>Analytics - VROOM Car Tracker</title>
	<meta name="description" content="Analyze your vehicle expenses and trends" />
</svelte:head>

{#snippet filterChips(inline: boolean)}
	<AnalyticsFilterBar
		{filters}
		vehicles={vehicleOptions}
		onChange={setFilters}
		{vehiclesError}
		onRetryVehicles={loadVehicles}
		{inline}
	/>
{/snippet}

{#snippet exploreFilterChips()}
	{@render filterChips(true)}
{/snippet}

{#snippet tabLoadError(name: string)}
	<LoadErrorCard
		title="Couldn't load {name}"
		message="Check your connection, then reload the page."
		onRetry={() => location.reload()}
	/>
{/snippet}

<div class="min-h-screen space-y-4 md:space-y-6">
	<div>
		{#if noVehicles}
			<PageHeader title="Analytics" variant="display" />
		{:else}
			<p class="text-sm text-muted-foreground">Analytics</p>
			<PageHeader title={TAB_TITLES[activeTab] ?? 'Explore'} variant="display" />
		{/if}
	</div>

	{#if !noVehicles && activeTab !== 'explore'}
		{@render filterChips(false)}
	{/if}

	{#if isLoading && !error && !summary}
		<Skeleton class="h-10 w-full rounded-full" />
	{:else if error}
		<LoadErrorCard title="Couldn't load analytics" message={error} onRetry={loadSummary} />
	{:else if noVehicles}
		<NoVehiclesEmptyState
			description="Analytics compare what your vehicles cost over time. Add one and log a few expenses to see them."
		/>
	{/if}

	{#if showTabs}
		<Tabs.Root bind:value={activeTab} class="space-y-4 md:space-y-6">
			<Tabs.List
				bind:ref={tabList}
				class="w-full justify-start overflow-x-auto lg:grid {sharedCars.length > 0
					? 'lg:grid-cols-6'
					: 'lg:grid-cols-5'}"
				style={tabMask}
				onscroll={updateTabFade}
			>
				<Tabs.Trigger value="explore" class="shrink-0 px-1.5 text-xs sm:px-3 sm:text-sm">
					Explore
				</Tabs.Trigger>
				<Tabs.Trigger value="fuel-stats" class="shrink-0 px-1.5 text-xs sm:px-3 sm:text-sm">
					Fuel & charging
				</Tabs.Trigger>
				<Tabs.Trigger value="cross-vehicle" class="shrink-0 px-1.5 text-xs sm:px-3 sm:text-sm">
					Cross-vehicle
				</Tabs.Trigger>
				<Tabs.Trigger value="per-vehicle" class="shrink-0 px-1.5 text-xs sm:px-3 sm:text-sm">
					Per-vehicle
				</Tabs.Trigger>
				<Tabs.Trigger value="year-end" class="shrink-0 px-1.5 text-xs sm:px-3 sm:text-sm">
					Year in review
				</Tabs.Trigger>
				{#if sharedCars.length > 0}
					<Tabs.Trigger value="drivers" class="shrink-0 px-1.5 text-xs sm:px-3 sm:text-sm">
						Drivers
					</Tabs.Trigger>
				{/if}
			</Tabs.List>

			{#if activeTab === 'explore'}
				<Tabs.Content value="explore">
					{#await import('#lib/components/analytics/explore/ExploreTab.svelte')}
						<div class="flex min-h-[480px] justify-center p-8" aria-busy="true">
							<LoaderCircle class="h-8 w-8 animate-spin text-muted-foreground" />
						</div>
					{:then { default: ExploreTab }}
						<ExploreTab
							query={explore}
							onQueryChange={setExplore}
							rangeText={rangeLabel(filters, d => formatDate(d))}
							carsText={carsLabel(filters.cars, new Map(vehicleOptions.map(v => [v.id, v.name])))}
							onOnlyCar={onlyCar}
							onAllCars={() => setFilters({ ...filters, cars: [] })}
							{dateRange}
							{vehicleIds}
							{vehicleColors}
							filterLabel={filtered ? filterLabel : undefined}
							onClearFilters={filtered ? clearFilters : undefined}
							onApplyInsight={applyInsight}
							driverSplit={sharedCars.some(v => !v.sharedAccess)}
							filters={exploreFilterChips}
							carCount={vehiclesLoaded && !vehiclesError ? vehicles.length : undefined}
						/>
					{:catch}
						{@render filterChips(false)}
						{@render tabLoadError('Explore')}
					{/await}
				</Tabs.Content>
			{:else if activeTab === 'fuel-stats'}
				<Tabs.Content value="fuel-stats">
					{#await import('#lib/components/analytics/fuel/FuelStatsTab.svelte')}
						<div class="flex justify-center p-8">
							<LoaderCircle class="h-8 w-8 animate-spin text-muted-foreground" />
						</div>
					{:then { default: FuelStatsTab }}
						<FuelStatsTab
							{fuelStats}
							{fuelAdvanced}
							{vehicleColors}
							previousPeriodLabel={previousPeriodLabel(filters)}
							rangeText={rangeLabel(filters, d => formatDate(d))}
							{dateRange}
							{vehicleIds}
							filterLabel={filtered ? filterLabel : undefined}
							onClearFilters={filtered ? clearFilters : undefined}
						/>
					{:catch}
						{@render tabLoadError('Fuel & charging')}
					{/await}
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
							{hiddenFinancials}
							rangeText={rangeLabel(filters, d => formatDate(d))}
							filterLabel={filtered ? filterLabel : undefined}
							onClearFilters={filtered ? clearFilters : undefined}
						/>
					{:catch}
						{@render tabLoadError('Cross-vehicle')}
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
					{:catch}
						{@render tabLoadError('Per-vehicle')}
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
					{:catch}
						{@render tabLoadError('Year in review')}
					{/await}
				</Tabs.Content>
			{:else if activeTab === 'drivers'}
				<Tabs.Content value="drivers">
					{#await import('#lib/components/analytics/DriversTab.svelte')}
						<div class="flex justify-center p-8">
							<LoaderCircle class="h-8 w-8 animate-spin text-muted-foreground" />
						</div>
					{:then { default: DriversTab }}
						<DriversTab
							vehicles={sharedCars}
							{dateRange}
							rangeText={rangeLabel(filters, d => formatDate(d))}
							preferredVehicleId={vehicleIds?.[0]}
						/>
					{:catch}
						{@render tabLoadError('Drivers')}
					{/await}
				</Tabs.Content>
			{/if}
		</Tabs.Root>
	{/if}
</div>
