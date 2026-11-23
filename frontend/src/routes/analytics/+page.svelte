<script lang="ts">
	import LoadErrorCard from '#lib/components/common/LoadErrorCard.svelte';
	import { userFacingErrorMessage } from '#lib/utils/error-handling.ts';
	import { onMount } from 'svelte';
	import { LoaderCircle, Car, DollarSign, Activity, TrendingUp } from '@lucide/svelte';
	import * as Tabs from '#lib/components/ui/tabs/index.ts';
	import PageHeader from '#lib/components/common/page-header.svelte';
	import StatCardGrid from '#lib/components/charts/StatCardGrid.svelte';
	import FuelStatsTab from '#lib/components/analytics/fuel/FuelStatsTab.svelte';
	import { analyticsApi, getDefaultDateRange } from '#lib/services/analytics-api.ts';
	import { formatCurrency } from '#lib/utils/formatters.ts';
	import { getFuelEfficiencyLabel } from '#lib/utils/units.ts';
	import { settingsStore } from '#lib/stores/settings.svelte.ts';
	import type { AnalyticsSummaryResponse } from '#lib/types/index.ts';

	let summary = $state<AnalyticsSummaryResponse | null>(null);
	let isLoading = $state(true);
	let error = $state<string | null>(null);
	let activeTab = $state('fuel-stats');

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
	let fuelStats = $derived(summary?.fuelStats ?? null);
	let fuelAdvanced = $derived(summary?.fuelAdvanced ?? null);

	let units = $derived(quickStats?.units ?? settingsStore.unitPreferences);
	let efficiencyLabel = $derived(
		`Avg ${getFuelEfficiencyLabel(units.distanceUnit, units.volumeUnit)}`
	);

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
						value: quickStats.avgEfficiency != null ? quickStats.avgEfficiency.toFixed(1) : 'N/A',
						icon: Activity,
						iconColor: 'chart-2'
					},
					{
						label: 'Fleet Health',
						value: quickStats.fleetHealthScore,
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
		{ label: 'health', value: '', icon: TrendingUp }
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
	{:else if quickStats}
		<StatCardGrid items={quickStatsItems} columns={4} />
	{/if}

	<Tabs.Root bind:value={activeTab} class="space-y-4 md:space-y-6">
		<Tabs.List class="grid w-full grid-cols-2 sm:h-auto lg:grid-cols-4">
			<Tabs.Trigger value="fuel-stats">Fuel & Stats</Tabs.Trigger>
			<Tabs.Trigger value="cross-vehicle">Cross-Vehicle</Tabs.Trigger>
			<Tabs.Trigger value="per-vehicle">Per-Vehicle</Tabs.Trigger>
			<Tabs.Trigger value="year-end">Year-End</Tabs.Trigger>
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
</div>
