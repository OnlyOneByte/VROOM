<script lang="ts">
	import { onMount } from 'svelte';
	import {
		LoaderCircle,
		CircleAlert,
		ChartBar,
		Car,
		DollarSign,
		Activity,
		TrendingUp
	} from 'lucide-svelte';
	import * as Tabs from '$lib/components/ui/tabs';
	import { Button } from '$lib/components/ui/button';
	import { StatCardGrid } from '$lib/components/charts';
	import FuelStatsTab from '$lib/components/analytics/FuelStatsTab.svelte';
	import { analyticsApi, getDefaultDateRange } from '$lib/services/analytics-api';
	import { formatCurrency } from '$lib/utils/formatters';
	import type { AnalyticsSummaryResponse } from '$lib/types';

	let summary = $state<AnalyticsSummaryResponse | null>(null);
	let isLoading = $state(true);
	let error = $state<string | null>(null);
	let activeTab = $state('fuel-stats');

	async function loadSummary() {
		try {
			isLoading = true;
			error = null;
			summary = await analyticsApi.getSummary(getDefaultDateRange());
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load analytics';
		} finally {
			isLoading = false;
		}
	}

	let quickStats = $derived(summary?.quickStats ?? null);
	let fuelStats = $derived(summary?.fuelStats ?? null);
	let fuelAdvanced = $derived(summary?.fuelAdvanced ?? null);

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
						label: 'Avg MPG',
						value: quickStats.avgMpg != null ? quickStats.avgMpg.toFixed(1) : 'N/A',
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

	onMount(() => {
		loadSummary();
	});
</script>

<svelte:head>
	<title>Analytics - VROOM Car Tracker</title>
	<meta name="description" content="Analyze your vehicle expenses and trends" />
</svelte:head>

<div class="min-h-screen space-y-4 md:space-y-6">
	<!-- Header -->
	<div class="space-y-2">
		<h1 class="flex items-center gap-2 text-2xl font-bold sm:gap-3 sm:text-3xl">
			<ChartBar class="h-6 w-6 sm:h-8 sm:w-8" />
			<span class="truncate">Analytics Dashboard</span>
		</h1>
		<p class="text-sm text-muted-foreground sm:text-base">
			Comprehensive insights into your vehicle spending patterns and trends
		</p>
	</div>

	<!-- Quick Stats -->
	{#if isLoading}
		<div class="flex justify-center p-8">
			<LoaderCircle class="h-8 w-8 animate-spin text-muted-foreground" />
		</div>
	{:else if error}
		<div class="rounded-lg border bg-card p-6">
			<div class="mb-4 flex items-center gap-3 text-destructive">
				<CircleAlert class="h-5 w-5" />
				<p class="font-medium">Failed to load analytics</p>
			</div>
			<p class="mb-4 text-sm text-muted-foreground">{error}</p>
			<Button onclick={loadSummary}>Retry</Button>
		</div>
	{:else if quickStats}
		<StatCardGrid items={quickStatsItems} columns={4} />
	{/if}

	<!-- Tabs -->
	<Tabs.Root bind:value={activeTab} class="space-y-4 md:space-y-6">
		<Tabs.List class="grid w-full grid-cols-2 lg:grid-cols-4">
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
				{#await import('$lib/components/analytics/CrossVehicleTab.svelte')}
					<div class="flex justify-center p-8">
						<LoaderCircle class="h-8 w-8 animate-spin text-muted-foreground" />
					</div>
				{:then { default: CrossVehicleTab }}
					<CrossVehicleTab />
				{/await}
			</Tabs.Content>
		{:else if activeTab === 'per-vehicle'}
			<Tabs.Content value="per-vehicle">
				{#await import('$lib/components/analytics/PerVehicleTab.svelte')}
					<div class="flex justify-center p-8">
						<LoaderCircle class="h-8 w-8 animate-spin text-muted-foreground" />
					</div>
				{:then { default: PerVehicleTab }}
					<PerVehicleTab />
				{/await}
			</Tabs.Content>
		{:else if activeTab === 'year-end'}
			<Tabs.Content value="year-end">
				{#await import('$lib/components/analytics/YearEndTab.svelte')}
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
