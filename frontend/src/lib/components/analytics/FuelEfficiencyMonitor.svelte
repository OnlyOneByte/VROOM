<script lang="ts">
	import { onMount } from 'svelte';
	import { AlertTriangle, TrendingDown, TrendingUp, Fuel } from 'lucide-svelte';
	import { getFuelEfficiency } from '$lib/utils/analytics-api';
	import FuelEfficiencyChart from '$lib/components/charts/FuelEfficiencyChart.svelte';

	interface Props {
		vehicleId: string;
		vehicleName: string;
	}

	let { vehicleId, vehicleName }: Props = $props();

	let fuelData: any = $state(null);
	let isLoading = $state(true);
	let error = $state<string | null>(null);

	// Efficiency alerts
	let efficiencyAlerts = $derived.by(() => {
		if (!fuelData || !fuelData.trend || fuelData.trend.length < 3) return [];

		const alerts = [];
		const trend = fuelData.trend;
		const averageMPG = fuelData.averageMPG;

		// Get recent readings (last 3)
		const recentReadings = trend.slice(-3);
		const recentAverage =
			recentReadings.reduce((sum: number, d: any) => sum + d.mpg, 0) / recentReadings.length;

		// Check for significant efficiency drop
		if (recentAverage < averageMPG * 0.85) {
			const dropPercentage = ((averageMPG - recentAverage) / averageMPG) * 100;
			alerts.push({
				type: 'efficiency_drop',
				severity: recentAverage < averageMPG * 0.7 ? 'high' : 'medium',
				message: `Fuel efficiency dropped ${dropPercentage.toFixed(1)}% below average`,
				currentMPG: recentAverage.toFixed(1),
				averageMPG: averageMPG.toFixed(1),
				recommendation:
					dropPercentage > 25
						? 'Consider scheduling a maintenance check - this could indicate engine issues'
						: 'Monitor driving habits and consider checking tire pressure'
			});
		}

		// Check for consistent improvement
		if (recentReadings.length >= 3) {
			const isImproving = recentReadings.every(
				(reading: any, index: number) => index === 0 || reading.mpg >= recentReadings[index - 1].mpg
			);

			if (isImproving && recentAverage > averageMPG * 1.1) {
				alerts.push({
					type: 'efficiency_improvement',
					severity: 'positive',
					message: `Fuel efficiency improved by ${(((recentAverage - averageMPG) / averageMPG) * 100).toFixed(1)}%`,
					currentMPG: recentAverage.toFixed(1),
					averageMPG: averageMPG.toFixed(1),
					recommendation: 'Great job! Keep up the efficient driving habits'
				});
			}
		}

		// Check for erratic efficiency (high variance)
		if (trend.length >= 5) {
			const last5 = trend.slice(-5);
			const variance = calculateVariance(last5.map((d: any) => d.mpg));
			const stdDev = Math.sqrt(variance);

			if (stdDev > averageMPG * 0.15) {
				// 15% standard deviation
				alerts.push({
					type: 'erratic_efficiency',
					severity: 'medium',
					message: 'Fuel efficiency is highly variable',
					recommendation: 'Consider consistent driving habits and regular maintenance'
				});
			}
		}

		return alerts;
	});

	// Efficiency trend analysis
	let trendAnalysis = $derived.by(() => {
		if (!fuelData || !fuelData.trend || fuelData.trend.length < 2) return null;

		const trend = fuelData.trend;
		const recent = trend.slice(-3);
		const older = trend.slice(-6, -3);

		if (recent.length === 0 || older.length === 0) return null;

		const recentAvg = recent.reduce((sum: number, d: any) => sum + d.mpg, 0) / recent.length;
		const olderAvg = older.reduce((sum: number, d: any) => sum + d.mpg, 0) / older.length;

		const change = ((recentAvg - olderAvg) / olderAvg) * 100;

		return {
			change: change.toFixed(1),
			direction: change > 0 ? 'improving' : 'declining',
			recentAvg: recentAvg.toFixed(1),
			olderAvg: olderAvg.toFixed(1)
		};
	});

	onMount(async () => {
		await loadFuelEfficiencyData();
	});

	async function loadFuelEfficiencyData() {
		try {
			isLoading = true;
			error = null;

			const data = await getFuelEfficiency(vehicleId);
			fuelData = data;
		} catch (err) {
			console.error('Error loading fuel efficiency data:', err);
			error = err instanceof Error ? err.message : 'Failed to load fuel efficiency data';
		} finally {
			isLoading = false;
		}
	}

	function calculateVariance(values: number[]): number {
		const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
		const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
		return squaredDiffs.reduce((sum, val) => sum + val, 0) / values.length;
	}

	function getAlertIcon(alert: any) {
		switch (alert.type) {
			case 'efficiency_improvement':
				return TrendingUp;
			case 'efficiency_drop':
				return TrendingDown;
			case 'erratic_efficiency':
				return AlertTriangle;
			default:
				return AlertTriangle;
		}
	}

	function getAlertColor(severity: string) {
		switch (severity) {
			case 'high':
				return 'bg-red-50 border-red-200 text-red-800';
			case 'medium':
				return 'bg-yellow-50 border-yellow-200 text-yellow-800';
			case 'positive':
				return 'bg-green-50 border-green-200 text-green-800';
			default:
				return 'bg-gray-50 border-gray-200 text-gray-800';
		}
	}
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<div>
			<h2 class="text-xl font-semibold text-gray-900">Fuel Efficiency Monitor</h2>
			<p class="text-gray-600">{vehicleName}</p>
		</div>

		<button
			onclick={loadFuelEfficiencyData}
			disabled={isLoading}
			class="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
		>
			<Fuel class="h-4 w-4 mr-2 {isLoading ? 'animate-spin' : ''}" />
			Refresh
		</button>
	</div>

	{#if isLoading}
		<div class="flex items-center justify-center h-32">
			<div class="text-center">
				<Fuel class="h-8 w-8 text-blue-500 animate-spin mx-auto mb-2" />
				<p class="text-gray-600">Loading fuel efficiency data...</p>
			</div>
		</div>
	{:else if error}
		<div class="bg-red-50 border border-red-200 rounded-lg p-4">
			<div class="flex items-center">
				<AlertTriangle class="h-5 w-5 text-red-400 mr-2" />
				<div>
					<h3 class="text-sm font-medium text-red-800">Error Loading Data</h3>
					<p class="text-sm text-red-700">{error}</p>
				</div>
			</div>
		</div>
	{:else if !fuelData || fuelData.trend.length === 0}
		<div class="text-center py-8">
			<Fuel class="h-12 w-12 text-gray-400 mx-auto mb-4" />
			<h3 class="text-lg font-medium text-gray-900 mb-2">No Fuel Data Available</h3>
			<p class="text-gray-600">
				Add fuel expenses with mileage data to start monitoring efficiency.
			</p>
		</div>
	{:else}
		<!-- Efficiency Alerts -->
		{#if efficiencyAlerts.length > 0}
			<div class="space-y-3">
				<h3 class="text-lg font-medium text-gray-900">Efficiency Alerts</h3>
				{#each efficiencyAlerts as alert}
					{@const AlertIcon = getAlertIcon(alert)}
					<div class="p-4 rounded-lg border {getAlertColor(alert.severity)}">
						<div class="flex items-start">
							<AlertIcon class="h-5 w-5 mt-0.5 mr-3 flex-shrink-0" />
							<div class="flex-1">
								<h4 class="text-sm font-medium mb-1">
									{#if alert.type === 'efficiency_improvement'}
										Efficiency Improvement Detected
									{:else if alert.type === 'efficiency_drop'}
										Efficiency Drop Alert
									{:else if alert.type === 'erratic_efficiency'}
										Erratic Efficiency Pattern
									{/if}
								</h4>
								<p class="text-sm mb-2">{alert.message}</p>
								{#if alert.currentMPG && alert.averageMPG}
									<p class="text-xs mb-2">
										Current: {alert.currentMPG} MPG | Average: {alert.averageMPG} MPG
									</p>
								{/if}
								<p class="text-xs font-medium">{alert.recommendation}</p>
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}

		<!-- Trend Analysis -->
		{#if trendAnalysis}
			<div class="bg-white p-4 rounded-lg shadow border">
				<h3 class="text-lg font-medium text-gray-900 mb-3">Trend Analysis</h3>
				<div class="flex items-center space-x-4">
					{#if trendAnalysis.direction === 'improving'}
						<div class="flex items-center text-green-600">
							<TrendingUp class="h-5 w-5 mr-2" />
							<span class="font-medium">Improving</span>
						</div>
					{:else}
						<div class="flex items-center text-red-600">
							<TrendingDown class="h-5 w-5 mr-2" />
							<span class="font-medium">Declining</span>
						</div>
					{/if}

					<div class="text-sm text-gray-600">
						{Math.abs(parseFloat(trendAnalysis.change))}% change over recent periods
					</div>
				</div>

				<div class="mt-3 grid grid-cols-2 gap-4 text-sm">
					<div>
						<span class="text-gray-600">Recent Average:</span>
						<span class="font-medium ml-1">{trendAnalysis.recentAvg} MPG</span>
					</div>
					<div>
						<span class="text-gray-600">Previous Average:</span>
						<span class="font-medium ml-1">{trendAnalysis.olderAvg} MPG</span>
					</div>
				</div>
			</div>
		{/if}

		<!-- Efficiency Summary -->
		<div class="grid grid-cols-1 md:grid-cols-4 gap-4">
			<div class="bg-white p-4 rounded-lg shadow border text-center">
				<div class="text-2xl font-bold text-blue-600">{fuelData.averageMPG.toFixed(1)}</div>
				<div class="text-sm text-gray-600">Average MPG</div>
			</div>

			<div class="bg-white p-4 rounded-lg shadow border text-center">
				<div class="text-2xl font-bold text-green-600">{fuelData.totalGallons.toFixed(1)}</div>
				<div class="text-sm text-gray-600">Total Gallons</div>
			</div>

			<div class="bg-white p-4 rounded-lg shadow border text-center">
				<div class="text-2xl font-bold text-purple-600">{fuelData.totalMiles.toLocaleString()}</div>
				<div class="text-sm text-gray-600">Total Miles</div>
			</div>

			<div class="bg-white p-4 rounded-lg shadow border text-center">
				<div class="text-2xl font-bold text-orange-600">
					{fuelData.trend.length > 0
						? fuelData.trend[fuelData.trend.length - 1].mpg.toFixed(1)
						: '0.0'}
				</div>
				<div class="text-sm text-gray-600">Latest MPG</div>
			</div>
		</div>

		<!-- Fuel Efficiency Chart -->
		<FuelEfficiencyChart
			data={fuelData.trend}
			title="Fuel Efficiency Trends"
			averageMPG={fuelData.averageMPG}
			width={1000}
			height={400}
		/>

		<!-- Comparative Analysis -->
		{#if fuelData.trend.length >= 6}
			{@const halfPoint = Math.floor(fuelData.trend.length / 2)}
			{@const firstHalf = fuelData.trend.slice(0, halfPoint)}
			{@const secondHalf = fuelData.trend.slice(halfPoint)}
			{@const firstHalfAvg =
				firstHalf.reduce((sum: number, d: any) => sum + d.mpg, 0) / firstHalf.length}
			{@const secondHalfAvg =
				secondHalf.reduce((sum: number, d: any) => sum + d.mpg, 0) / secondHalf.length}
			{@const improvement = ((secondHalfAvg - firstHalfAvg) / firstHalfAvg) * 100}
			<div class="bg-white p-4 rounded-lg shadow border">
				<h3 class="text-lg font-medium text-gray-900 mb-4">Period Comparison</h3>

				<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
					<div class="text-center">
						<div class="text-lg font-semibold text-gray-900">{firstHalfAvg.toFixed(1)} MPG</div>
						<div class="text-sm text-gray-600">Earlier Period</div>
					</div>

					<div class="text-center">
						<div
							class="text-lg font-semibold {improvement >= 0 ? 'text-green-600' : 'text-red-600'}"
						>
							{improvement >= 0 ? '+' : ''}{improvement.toFixed(1)}%
						</div>
						<div class="text-sm text-gray-600">Change</div>
					</div>

					<div class="text-center">
						<div class="text-lg font-semibold text-gray-900">{secondHalfAvg.toFixed(1)} MPG</div>
						<div class="text-sm text-gray-600">Recent Period</div>
					</div>
				</div>
			</div>
		{/if}
	{/if}
</div>
