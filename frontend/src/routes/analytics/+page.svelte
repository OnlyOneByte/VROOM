<script lang="ts">
	import { onMount } from 'svelte';
	import { Filter, Download, RefreshCw } from 'lucide-svelte';
	import {
		getDashboardAnalytics,
		getTrendData,
		type DashboardData,
		type TrendData
	} from '$lib/utils/analytics-api';
	import { appStore } from '$lib/stores/app';
	import CostTrendChart from '$lib/components/charts/CostTrendChart.svelte';
	import CategoryBreakdownChart from '$lib/components/charts/CategoryBreakdownChart.svelte';

	import MultiTrendChart from '$lib/components/charts/MultiTrendChart.svelte';
	import EfficiencyAlerts from '$lib/components/analytics/EfficiencyAlerts.svelte';
	import VehicleEfficiencySummary from '$lib/components/analytics/VehicleEfficiencySummary.svelte';

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
	onMount(() => {
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
			appStore.addNotification({
				type: 'error',
				message: 'Failed to load analytics data. Please try again.'
			});
		} finally {
			isLoading = false;
		}
	}

	function handleFilterChange() {
		loadAnalyticsData();
	}

	function exportData() {
		if (!dashboardData) return;

		const exportData = {
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

		const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
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
			<h1 class="text-2xl font-bold text-gray-900">Analytics Dashboard</h1>
			<p class="text-gray-600">Visualize your spending patterns and trends</p>
		</div>

		<div class="flex items-center space-x-2 mt-4 sm:mt-0">
			<button
				onclick={loadAnalyticsData}
				disabled={isLoading}
				class="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
			>
				<RefreshCw class="h-4 w-4 mr-2 {isLoading ? 'animate-spin' : ''}" />
				Refresh
			</button>

			<button
				onclick={exportData}
				disabled={!dashboardData}
				class="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
			>
				<Download class="h-4 w-4 mr-2" />
				Export
			</button>
		</div>
	</div>

	<!-- Filters -->
	<div class="bg-white p-4 rounded-lg shadow border">
		<div class="flex items-center space-x-2 mb-4">
			<Filter class="h-5 w-5 text-gray-400" />
			<h3 class="text-lg font-medium text-gray-900">Filters</h3>
		</div>

		<div class="grid grid-cols-1 md:grid-cols-4 gap-4">
			<div>
				<label for="startDate" class="block text-sm font-medium text-gray-700 mb-1">
					Start Date
				</label>
				<input
					id="startDate"
					type="date"
					bind:value={startDate}
					onchange={handleFilterChange}
					class="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
				/>
			</div>

			<div>
				<label for="endDate" class="block text-sm font-medium text-gray-700 mb-1"> End Date </label>
				<input
					id="endDate"
					type="date"
					bind:value={endDate}
					onchange={handleFilterChange}
					class="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
				/>
			</div>

			<div>
				<label for="groupBy" class="block text-sm font-medium text-gray-700 mb-1"> Group By </label>
				<select
					id="groupBy"
					bind:value={groupBy}
					onchange={handleFilterChange}
					class="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
				>
					<option value="day">Daily</option>
					<option value="week">Weekly</option>
					<option value="month">Monthly</option>
					<option value="year">Yearly</option>
				</select>
			</div>

			<div>
				<label for="vehicle" class="block text-sm font-medium text-gray-700 mb-1"> Vehicle </label>
				<select
					id="vehicle"
					bind:value={selectedVehicle}
					onchange={handleFilterChange}
					class="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
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
	</div>

	{#if isLoading}
		<!-- Loading state -->
		<div class="flex items-center justify-center h-64">
			<div class="text-center">
				<RefreshCw class="h-8 w-8 text-blue-500 animate-spin mx-auto mb-4" />
				<p class="text-gray-600">Loading analytics data...</p>
			</div>
		</div>
	{:else if error}
		<!-- Error state -->
		<div class="bg-red-50 border border-red-200 rounded-lg p-6">
			<div class="flex items-center">
				<div class="text-red-400 text-2xl mr-3">⚠️</div>
				<div>
					<h3 class="text-lg font-medium text-red-800">Error Loading Analytics</h3>
					<p class="text-red-700">{error}</p>
					<button
						onclick={loadAnalyticsData}
						class="mt-2 text-sm text-red-600 hover:text-red-500 underline"
					>
						Try again
					</button>
				</div>
			</div>
		</div>
	{:else if !dashboardData}
		<!-- No data state -->
		<div class="text-center py-12">
			<div class="text-gray-400 text-6xl mb-4">📊</div>
			<h3 class="text-lg font-medium text-gray-900 mb-2">No Data Available</h3>
			<p class="text-gray-600">Start by adding some vehicles and expenses to see your analytics.</p>
		</div>
	{:else}
		<!-- Summary Cards -->
		<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
			<div class="bg-white p-6 rounded-lg shadow border">
				<div class="flex items-center">
					<div class="text-3xl mr-3">💰</div>
					<div>
						<p class="text-sm font-medium text-gray-600">Total Expenses</p>
						<p class="text-2xl font-bold text-gray-900">
							${dashboardData.totalExpenses.toFixed(2)}
						</p>
					</div>
				</div>
			</div>

			<div class="bg-white p-6 rounded-lg shadow border">
				<div class="flex items-center">
					<div class="text-3xl mr-3">⛽</div>
					<div>
						<p class="text-sm font-medium text-gray-600">Average MPG</p>
						<p class="text-2xl font-bold text-gray-900">
							{dashboardData.fuelEfficiency.averageMPG.toFixed(1)}
						</p>
					</div>
				</div>
			</div>

			<div class="bg-white p-6 rounded-lg shadow border">
				<div class="flex items-center">
					<div class="text-3xl mr-3">🛣️</div>
					<div>
						<p class="text-sm font-medium text-gray-600">Cost per Mile</p>
						<p class="text-2xl font-bold text-gray-900">
							${dashboardData.costPerMile.totalCostPerMile.toFixed(3)}
						</p>
					</div>
				</div>
			</div>

			<div class="bg-white p-6 rounded-lg shadow border">
				<div class="flex items-center">
					<div class="text-3xl mr-3">🚗</div>
					<div>
						<p class="text-sm font-medium text-gray-600">Vehicles</p>
						<p class="text-2xl font-bold text-gray-900">{dashboardData.vehicles.length}</p>
					</div>
				</div>
			</div>
		</div>

		<!-- Charts Grid -->
		<div class="grid grid-cols-1 xl:grid-cols-2 gap-6">
			<!-- Cost Trends -->
			<div class="xl:col-span-2">
				<CostTrendChart
					data={dashboardData.monthlyTrends}
					title="Monthly Cost Trends"
					width={1200}
					height={400}
				/>
			</div>

			<!-- Category Breakdown -->
			<CategoryBreakdownChart
				data={dashboardData.categoryBreakdown}
				title="Expense Categories"
				width={600}
				height={400}
			/>

			<!-- Multi-Trend Chart -->
			{#if trendData}
				<MultiTrendChart
					costData={trendData.costTrends}
					milesData={trendData.milesTrends}
					costPerMileData={trendData.costPerMileTrends}
					title="Multi-Metric Analysis"
					width={600}
					height={400}
				/>
			{/if}
		</div>

		<!-- Fuel Efficiency Monitoring Section -->
		{#if dashboardData.vehicles.length > 0}
			<div class="grid grid-cols-1 xl:grid-cols-2 gap-6">
				<!-- Efficiency Alerts -->
				<EfficiencyAlerts vehicles={dashboardData.vehicles} />

				<!-- Vehicle Efficiency Summary -->
				<VehicleEfficiencySummary vehicles={dashboardData.vehicles} />
			</div>
		{/if}

		<!-- Fuel Efficiency Section -->
		{#if dashboardData.fuelEfficiency.totalGallons > 0}
			<div class="bg-white p-6 rounded-lg shadow border">
				<h3 class="text-lg font-semibold text-gray-900 mb-4">Fleet Fuel Efficiency Summary</h3>

				<div class="grid grid-cols-1 md:grid-cols-4 gap-4">
					<div class="text-center">
						<div class="text-2xl font-bold text-green-600">
							{dashboardData.fuelEfficiency.averageMPG.toFixed(1)}
						</div>
						<div class="text-sm text-gray-600">Average MPG</div>
					</div>

					<div class="text-center">
						<div class="text-2xl font-bold text-blue-600">
							{dashboardData.fuelEfficiency.totalGallons.toFixed(1)}
						</div>
						<div class="text-sm text-gray-600">Total Gallons</div>
					</div>

					<div class="text-center">
						<div class="text-2xl font-bold text-purple-600">
							${dashboardData.fuelEfficiency.totalFuelCost.toFixed(2)}
						</div>
						<div class="text-sm text-gray-600">Total Fuel Cost</div>
					</div>

					<div class="text-center">
						<div class="text-2xl font-bold text-orange-600">
							${dashboardData.fuelEfficiency.averageCostPerGallon.toFixed(2)}
						</div>
						<div class="text-sm text-gray-600">Avg Cost/Gallon</div>
					</div>
				</div>
			</div>
		{/if}
	{/if}
</div>
