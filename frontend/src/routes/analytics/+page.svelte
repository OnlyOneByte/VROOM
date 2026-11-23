<script lang="ts">
	import LoadErrorCard from '#lib/components/common/LoadErrorCard.svelte';
	import { userFacingErrorMessage } from '#lib/utils/error-handling.ts';
	import { onMount, tick } from 'svelte';
	import { LoaderCircle, Car, DollarSign, Activity, TrendingUp } from '@lucide/svelte';
	import NoVehiclesEmptyState from '#lib/components/common/NoVehiclesEmptyState.svelte';
	import * as Tabs from '#lib/components/ui/tabs/index.ts';
	import PageHeader from '#lib/components/common/page-header.svelte';
	import StatCardGrid from '#lib/components/charts/StatCardGrid.svelte';
	import FuelStatsTab from '#lib/components/analytics/fuel/FuelStatsTab.svelte';
	import { analyticsApi, getDefaultDateRange } from '#lib/services/analytics-api.ts';
	import { formatCurrency, formatNumber } from '#lib/utils/formatters.ts';
	import { getFuelEfficiencyLabel } from '#lib/utils/units.ts';
	import { settingsStore } from '#lib/stores/settings.svelte.ts';
	import type { AnalyticsSummaryResponse } from '#lib/types/index.ts';

	let summary = $state<AnalyticsSummaryResponse | null>(null);
	let isLoading = $state(true);
	let error = $state<string | null>(null);
	let activeTab = $state('fuel-stats');
	let tabList = $state<HTMLElement | null>(null);

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
		try {
			isLoading = true;
			summary = await analyticsApi.getSummary(getDefaultDateRange());
			error = null;
		} catch (e) {
			error = userFacingErrorMessage(e);
		} finally {
			isLoading = false;
		}
	}

	let quickStats = $derived(summary?.quickStats ?? null);
	let noVehicles = $derived(!isLoading && !error && quickStats?.vehicleCount === 0);
	let showTabs = $derived(quickStats ? quickStats.vehicleCount > 0 : !!error);
	let fuelStats = $derived(summary?.fuelStats ?? null);
	let fuelAdvanced = $derived(summary?.fuelAdvanced ?? null);

	let units = $derived(quickStats?.units ?? settingsStore.unitPreferences);
	let efficiencyLabel = $derived(
		`Avg ${getFuelEfficiencyLabel(units.distanceUnit, units.volumeUnit)}`
	);

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
						label: 'YTD Spending',
						value: formatCurrency(quickStats.ytdSpending),
						icon: DollarSign,
						iconColor: 'chart-1'
					},
					{
						label: efficiencyLabel,
						value:
							quickStats.avgEfficiency != null ? formatNumber(quickStats.avgEfficiency, 1) : 'N/A',
						icon: Activity,
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
		{ label: 'efficiency', value: '', icon: Activity },
		{ label: 'health', value: '', subtitle: FLEET_HEALTH_SUBTITLE, icon: TrendingUp }
	];

	onMount(() => {
		loadSummary();
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
					<FuelStatsTab {fuelStats} {fuelAdvanced} />
				</Tabs.Content>
			{:else if activeTab === 'cross-vehicle'}
				<Tabs.Content value="cross-vehicle">
					{#await import('#lib/components/analytics/CrossVehicleTab.svelte')}
						<div class="flex justify-center p-8">
							<LoaderCircle class="h-8 w-8 animate-spin text-muted-foreground" />
						</div>
					{:then { default: CrossVehicleTab }}
						<CrossVehicleTab />
					{/await}
				</Tabs.Content>
			{:else if activeTab === 'per-vehicle'}
				<Tabs.Content value="per-vehicle">
					{#await import('#lib/components/analytics/PerVehicleTab.svelte')}
						<div class="flex justify-center p-8">
							<LoaderCircle class="h-8 w-8 animate-spin text-muted-foreground" />
						</div>
					{:then { default: PerVehicleTab }}
						<PerVehicleTab />
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
