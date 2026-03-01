<script lang="ts">
	import { onMount } from 'svelte';
	import { ListFilter, Download, RefreshCw } from 'lucide-svelte';
	import {
		getDashboardAnalytics,
		getTrendData,
		type DashboardData,
		type TrendData
	} from '$lib/utils/analytics-api';
	import { appStore } from '$lib/stores/app';
	import { settingsStore } from '$lib/stores/settings';
	import { getVolumeUnitLabel } from '$lib/utils/units';
	import EfficiencyAlerts from '$lib/components/analytics/EfficiencyAlerts.svelte';
	import VehicleEfficiencySummary from '$lib/components/analytics/VehicleEfficiencySummary.svelte';
	import DatePicker from '$lib/components/ui/date-picker.svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import EmptyState from '$lib/components/ui/empty-state.svelte';

	let dashboardData: DashboardData | null = $state(null);
	let trendData: TrendData | null = $state(null);
	let isLoading = $state(true);
	let error = $state<string | null>(null);

	// Filter controls
	let startDate = $state('');
	let endDate = $state('');
	let groupBy = $state<'day' | 'week' | 'month' | 'year'>('month');
	let selectedVehicle = $state<string>('all');

	// Set default date range (last 12 months)
	onMount(async () => {
		await settingsStore.load();

		const now = new Date();
		const twelveMonthsAgo = new Date(now.getFullYear() - 1, now.getMonth(), 1);

		startDate = twelveMonthsAgo.toISOString().split('T')[0] ?? '';
		endDate = now.toISOString().split('T')[0] ?? '';

		loadAnalyticsData();
	});

	async function loadAnalyticsData() {
		try {
			isLoading = true;
			error = null;

			const [dashboard, trends] = await Promise.all([
				getDashboardAnalytics(
					startDate ? new Date(startDate).toISOString() : undefined,
					endDate ? new Date(endDate).toISOString() : undefined,
					groupBy
				),
				getTrendData(
					startDate ? new Date(startDate).toISOString() : undefined,
					endDate ? new Date(endDate).toISOString() : undefined,
					groupBy
				)
			]);

			dashboardData = dashboard;
			trendData = trends;
		} catch (err) {
			console.error('Error loading analytics data:', err);
			error = err instanceof Error ? err.message : 'Failed to load analytics data';
		} finally {
			isLoading = false;
		}
	}

	function handleFilterChange() {
		loadAnalyticsData();
	}

	// Watch for date changes and reload data
	$effect(() => {
		if (startDate || endDate) {
			handleFilterChange();
		}
	});

	function exportData() {
		if (!dashboardData) return;

		const exportPayload = {
			summary: {
				totalExpenses: dashboardData.totalExpenses,
				vehicles: dashboardData.vehicles,
				dateRange: { startDate, endDate },
				generatedAt: new Date().toISOString()
			},
			monthlyTrends: dashboardData.monthlyTrends,
			categoryBreakdown: dashboardData.categoryBreakdown,
			fuelEfficiency: dashboardData.fuelEfficiency,
			costPerMile: dashboardData.costPerMile,
			trends: trendData
		};

		const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `vroom-analytics-${new Date().toISOString().split('T')[0]}.json`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);

		appStore.addNotification({
			type: 'success',
			message: 'Analytics data exported successfully'
		});
	}
</script>

<svelte:head>
	<title>Analytics - VROOM Car Tracker</title>
	<meta name="description" content="Analyze your vehicle expenses and trends" />
</svelte:head>

<div class="space-y-6">
	<!-- Header -->
	<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between">
		<div>
			<h1 class="text-2xl font-bold tracking-tight">Analytics Dashboard</h1>
			<p class="text-muted-foreground">Visualize your spending patterns and trends</p>
		</div>

		<div class="flex items-center space-x-2 mt-4 sm:mt-0">
			<Button variant="outline" onclick={loadAnalyticsData} disabled={isLoading}>
				<RefreshCw class="h-4 w-4 mr-2 {isLoading ? 'animate-spin' : ''}" />
				Refresh
			</Button>

			<Button onclick={exportData} disabled={!dashboardData}>
				<Download class="h-4 w-4 mr-2" />
				Export
			</Button>
		</div>
	</div>

	<!-- Filters -->
	<Card.Root>
		<Card.Header>
			<Card.Title class="flex items-center gap-2">
				<ListFilter class="h-5 w-5 text-muted-foreground" />
				Filters
			</Card.Title>
		</Card.Header>
		<Card.Content>
			<div class="grid grid-cols-1 md:grid-cols-4 gap-4">
				<div>
					<label for="startDate" class="block text-sm font-medium text-muted-foreground mb-1">
						Start Date
					</label>
					<DatePicker id="startDate" bind:value={startDate} placeholder="Select start date" />
				</div>

				<div>
					<label for="endDate" class="block text-sm font-medium text-muted-foreground mb-1">
						End Date
					</label>
					<DatePicker id="endDate" bind:value={endDate} placeholder="Select end date" />
				</div>

				<div>
					<label for="groupBy" class="block text-sm font-medium text-muted-foreground mb-1">
						Group By
					</label>
					<select
						id="groupBy"
						bind:value={groupBy}
						onchange={handleFilterChange}
						class="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:border-ring focus:ring-1 focus:ring-ring"
					>
						<option value="day">Daily</option>
						<option value="week">Weekly</option>
						<option value="month">Monthly</option>
						<option value="year">Yearly</option>
					</select>
				</div>

				<div>
					<label for="vehicle" class="block text-sm font-medium text-muted-foreground mb-1">
						Vehicle
					</label>
					<select
						id="vehicle"
						bind:value={selectedVehicle}
						onchange={handleFilterChange}
						class="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:border-ring focus:ring-1 focus:ring-ring"
					>
						<option value="all">All Vehicles</option>
						{#if dashboardData?.vehicles}
							{#each dashboardData.vehicles as vehicle}
								<option value={vehicle.id}>
									{vehicle.nickname || vehicle.name}
								</option>
							{/each}
						{/if}
					</select>
				</div>
			</div>
		</Card.Content>
	</Card.Root>

	{#if isLoading}
		<div class="flex items-center justify-center h-64">
			<div class="text-center">
				<RefreshCw class="h-8 w-8 text-primary animate-spin mx-auto mb-4" />
				<p class="text-muted-foreground">Loading analytics data...</p>
			</div>
		</div>
	{:else if error}
		<EmptyState>
			{#snippet title()}
				Error Loading Analytics
			{/snippet}
			{#snippet description()}
				{error}
			{/snippet}
			{#snippet action()}
				<Button variant="outline" onclick={loadAnalyticsData}>Try again</Button>
			{/snippet}
		</EmptyState>
	{:else if !dashboardData}
		<EmptyState>
			{#snippet title()}
				No Data Available
			{/snippet}
			{#snippet description()}
				Start by adding some vehicles and expenses to see your analytics.
			{/snippet}
		</EmptyState>
	{:else}
		<!-- Summary Cards -->
		<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
			<Card.Root>
				<Card.Content class="p-6">
					<div class="flex items-center">
						<div class="text-3xl mr-3">💰</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Total Expenses</p>
							<p class="text-2xl font-bold">${dashboardData.totalExpenses.toFixed(2)}</p>
						</div>
					</div>
				</Card.Content>
			</Card.Root>

			<Card.Root>
				<Card.Content class="p-6">
					<div class="flex items-center">
						<div class="text-3xl mr-3">⛽</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Average MPG</p>
							<p class="text-2xl font-bold">
								{dashboardData.fuelEfficiency.averageMPG.toFixed(1)}
							</p>
						</div>
					</div>
				</Card.Content>
			</Card.Root>

			<Card.Root>
				<Card.Content class="p-6">
					<div class="flex items-center">
						<div class="text-3xl mr-3">🛣️</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Cost per Mile</p>
							<p class="text-2xl font-bold">
								${dashboardData.costPerMile.totalCostPerMile.toFixed(3)}
							</p>
						</div>
					</div>
				</Card.Content>
			</Card.Root>

			<Card.Root>
				<Card.Content class="p-6">
					<div class="flex items-center">
						<div class="text-3xl mr-3">🚗</div>
						<div>
							<p class="text-sm font-medium text-muted-foreground">Vehicles</p>
							<p class="text-2xl font-bold">{dashboardData.vehicles.length}</p>
						</div>
					</div>
				</Card.Content>
			</Card.Root>
		</div>

		<!-- Fuel Efficiency Monitoring Section -->
		{#if dashboardData.vehicles.length > 0}
			<div class="grid grid-cols-1 xl:grid-cols-2 gap-6">
				<EfficiencyAlerts vehicles={dashboardData.vehicles} />
				<VehicleEfficiencySummary vehicles={dashboardData.vehicles} />
			</div>
		{/if}

		<!-- Fuel Efficiency Section -->
		{#if dashboardData.fuelEfficiency.totalVolume > 0}
			<Card.Root>
				<Card.Header>
					<Card.Title>Fleet Fuel Efficiency Summary</Card.Title>
				</Card.Header>
				<Card.Content>
					<div class="grid grid-cols-1 md:grid-cols-4 gap-4">
						<div class="text-center">
							<div class="text-2xl font-bold text-green-600">
								{dashboardData.fuelEfficiency.averageMPG.toFixed(1)}
							</div>
							<div class="text-sm text-muted-foreground">Average Efficiency</div>
						</div>

						<div class="text-center">
							<div class="text-2xl font-bold text-blue-600">
								{dashboardData.fuelEfficiency.totalVolume.toFixed(1)}
							</div>
							<div class="text-sm text-muted-foreground">
								Total {getVolumeUnitLabel($settingsStore.settings?.volumeUnit || 'gallons_us')}
							</div>
						</div>

						<div class="text-center">
							<div class="text-2xl font-bold text-purple-600">
								${dashboardData.fuelEfficiency.totalFuelCost.toFixed(2)}
							</div>
							<div class="text-sm text-muted-foreground">Total Fuel Cost</div>
						</div>

						<div class="text-center">
							<div class="text-2xl font-bold text-orange-600">
								${dashboardData.fuelEfficiency.averageCostPerGallon.toFixed(2)}
							</div>
							<div class="text-sm text-muted-foreground">
								Avg Cost/{getVolumeUnitLabel(
									$settingsStore.settings?.volumeUnit || 'gallons_us',
									true
								)}
							</div>
						</div>
					</div>
				</Card.Content>
			</Card.Root>
		{/if}
	{/if}
</div>
