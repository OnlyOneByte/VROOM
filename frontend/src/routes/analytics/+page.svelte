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
	import CrossVehicleTab from '$lib/components/analytics/CrossVehicleTab.svelte';
	import PerVehicleTab from '$lib/components/analytics/PerVehicleTab.svelte';
	import YearEndTab from '$lib/components/analytics/YearEndTab.svelte';
	import { analyticsApi, getDefaultDateRange } from '$lib/services/analytics-api';
	import { formatCurrency } from '$lib/utils/formatters';
	import type { QuickStatsResponse } from '$lib/types';

	let quickStats = $state<QuickStatsResponse | null>(null);
	let isLoadingQuickStats = $state(true);
	let quickStatsError = $state<string | null>(null);
	let activeTab = $state('fuel-stats');

	async function loadQuickStats() {
		try {
			isLoadingQuickStats = true;
			quickStatsError = null;
			quickStats = await analyticsApi.getQuickStats(getDefaultDateRange());
		} catch (e) {
			quickStatsError = e instanceof Error ? e.message : 'Failed to load quick stats';
		} finally {
			isLoadingQuickStats = false;
		}
	}

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
		loadQuickStats();
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
	{#if isLoadingQuickStats}
		<div class="flex justify-center p-8">
			<LoaderCircle class="h-8 w-8 animate-spin text-muted-foreground" />
		</div>
	{:else if quickStatsError}
		<div class="rounded-lg border bg-card p-6">
			<div class="mb-4 flex items-center gap-3 text-destructive">
				<CircleAlert class="h-5 w-5" />
				<p class="font-medium">Failed to load analytics</p>
			</div>
			<p class="mb-4 text-sm text-muted-foreground">{quickStatsError}</p>
			<Button onclick={loadQuickStats}>Retry</Button>
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

		<Tabs.Content value="fuel-stats">
			<FuelStatsTab />
		</Tabs.Content>

		<Tabs.Content value="cross-vehicle">
			<CrossVehicleTab />
		</Tabs.Content>

		<Tabs.Content value="per-vehicle">
			<PerVehicleTab />
		</Tabs.Content>

		<Tabs.Content value="year-end">
			<YearEndTab />
		</Tabs.Content>
	</Tabs.Root>
</div>
