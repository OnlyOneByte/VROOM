<script lang="ts">
	import { onMount } from 'svelte';
	import { Car, TrendingUp, TrendingDown, Minus } from 'lucide-svelte';
	import { getFuelEfficiency } from '$lib/utils/analytics-api';

	interface Props {
		vehicles: Array<{
			id: string;
			name: string;
			nickname?: string;
		}>;
	}

	let { vehicles }: Props = $props();

	let vehicleEfficiencyData = $state<{ [key: string]: any }>({});
	let isLoading = $state(true);

	onMount(async () => {
		await loadAllVehicleEfficiency();
	});

	async function loadAllVehicleEfficiency() {
		try {
			isLoading = true;
			const efficiencyData: { [key: string]: any } = {};

			for (const vehicle of vehicles) {
				try {
					const fuelData = await getFuelEfficiency(vehicle.id);
					if (fuelData && typeof fuelData === 'object') {
						efficiencyData[vehicle.id] = {
							...fuelData,
							vehicle,
							trend: calculateTrend((fuelData as any).trend),
							rating: calculateEfficiencyRating((fuelData as any).averageMPG)
						};
					}
				} catch (error) {
					console.warn(`Failed to load fuel data for vehicle ${vehicle.id}:`, error);
					efficiencyData[vehicle.id] = {
						averageMPG: 0,
						totalGallons: 0,
						totalMiles: 0,
						trend: [],
						vehicle,
						rating: 'unknown',
						trendDirection: 'stable'
					};
				}
			}

			vehicleEfficiencyData = efficiencyData;
		} catch (error) {
			console.error('Error loading vehicle efficiency data:', error);
		} finally {
			isLoading = false;
		}
	}

	function calculateTrend(trendData: any[]) {
		if (!trendData || trendData.length < 4) return 'stable';

		const recent = trendData.slice(-3);
		const older = trendData.slice(-6, -3);

		if (recent.length === 0 || older.length === 0) return 'stable';

		const recentAvg = recent.reduce((sum, d) => sum + d.mpg, 0) / recent.length;
		const olderAvg = older.reduce((sum, d) => sum + d.mpg, 0) / older.length;

		const change = (recentAvg - olderAvg) / olderAvg;

		if (change > 0.05) return 'improving'; // 5% improvement
		if (change < -0.05) return 'declining'; // 5% decline
		return 'stable';
	}

	function calculateEfficiencyRating(averageMPG: number): string {
		if (averageMPG === 0) return 'unknown';

		// Simple rating based on MPG ranges
		// In a real app, this would consider vehicle class, age, etc.
		if (averageMPG >= 35) return 'excellent';
		if (averageMPG >= 28) return 'good';
		if (averageMPG >= 22) return 'average';
		if (averageMPG >= 18) return 'below-average';
		return 'poor';
	}

	function getRatingColor(rating: string): string {
		switch (rating) {
			case 'excellent':
				return 'text-green-600 bg-green-50';
			case 'good':
				return 'text-blue-600 bg-blue-50';
			case 'average':
				return 'text-yellow-600 bg-yellow-50';
			case 'below-average':
				return 'text-orange-600 bg-orange-50';
			case 'poor':
				return 'text-red-600 bg-red-50';
			default:
				return 'text-gray-600 bg-gray-50';
		}
	}

	function getRatingLabel(rating: string): string {
		switch (rating) {
			case 'excellent':
				return 'Excellent';
			case 'good':
				return 'Good';
			case 'average':
				return 'Average';
			case 'below-average':
				return 'Below Average';
			case 'poor':
				return 'Poor';
			default:
				return 'Unknown';
		}
	}

	function getTrendIcon(trend: string) {
		switch (trend) {
			case 'improving':
				return TrendingUp;
			case 'declining':
				return TrendingDown;
			default:
				return Minus;
		}
	}

	function getTrendColor(trend: string): string {
		switch (trend) {
			case 'improving':
				return 'text-green-600';
			case 'declining':
				return 'text-red-600';
			default:
				return 'text-gray-600';
		}
	}

	// Sort vehicles by efficiency rating
	let sortedVehicles = $derived.by(() => {
		const ratingOrder = {
			excellent: 5,
			good: 4,
			average: 3,
			'below-average': 2,
			poor: 1,
			unknown: 0
		};

		return vehicles
			.map(vehicle => ({
				...vehicle,
				efficiency: vehicleEfficiencyData[vehicle.id] || {}
			}))
			.sort((a, b) => {
				const aRating = ratingOrder[a.efficiency.rating as keyof typeof ratingOrder] || 0;
				const bRating = ratingOrder[b.efficiency.rating as keyof typeof ratingOrder] || 0;
				return bRating - aRating;
			});
	});
</script>

<div class="space-y-4">
	<div class="flex items-center justify-between">
		<h2 class="text-lg font-semibold text-gray-900">Vehicle Efficiency Summary</h2>
		<button
			onclick={loadAllVehicleEfficiency}
			disabled={isLoading}
			class="text-sm text-blue-600 hover:text-blue-500 disabled:opacity-50"
		>
			{isLoading ? 'Loading...' : 'Refresh'}
		</button>
	</div>

	{#if isLoading}
		<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
			{#each vehicles as _}
				<div class="bg-white p-4 rounded-lg shadow border animate-pulse">
					<div class="flex items-center mb-3">
						<div class="w-8 h-8 bg-gray-200 rounded mr-3"></div>
						<div class="flex-1">
							<div class="h-4 bg-gray-200 rounded w-3/4 mb-1"></div>
							<div class="h-3 bg-gray-200 rounded w-1/2"></div>
						</div>
					</div>
					<div class="space-y-2">
						<div class="h-6 bg-gray-200 rounded"></div>
						<div class="h-4 bg-gray-200 rounded w-2/3"></div>
					</div>
				</div>
			{/each}
		</div>
	{:else if vehicles.length === 0}
		<div class="text-center py-8">
			<Car class="h-12 w-12 text-gray-400 mx-auto mb-4" />
			<h3 class="text-lg font-medium text-gray-900 mb-2">No Vehicles</h3>
			<p class="text-gray-600">Add vehicles to see efficiency summaries.</p>
		</div>
	{:else}
		<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
			{#each sortedVehicles as vehicleData}
				{@const efficiency = vehicleData.efficiency}
				{@const TrendIcon = getTrendIcon(efficiency.trend)}

				<div class="bg-white p-4 rounded-lg shadow border hover:shadow-md transition-shadow">
					<div class="flex items-center mb-3">
						<Car class="h-8 w-8 text-gray-400 mr-3" />
						<div class="flex-1">
							<h3 class="font-medium text-gray-900 truncate">
								{vehicleData.nickname || vehicleData.name}
							</h3>
							<p class="text-sm text-gray-600 truncate">{vehicleData.name}</p>
						</div>
					</div>

					<div class="space-y-3">
						<!-- MPG Display -->
						<div class="text-center">
							<div class="text-2xl font-bold text-gray-900">
								{efficiency.averageMPG ? efficiency.averageMPG.toFixed(1) : '0.0'}
							</div>
							<div class="text-sm text-gray-600">Average MPG</div>
						</div>

						<!-- Rating Badge -->
						<div class="flex justify-center">
							<span
								class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium {getRatingColor(
									efficiency.rating
								)}"
							>
								{getRatingLabel(efficiency.rating)}
							</span>
						</div>

						<!-- Trend Indicator -->
						<div class="flex items-center justify-center space-x-2">
							<TrendIcon class="h-4 w-4 {getTrendColor(efficiency.trend)}" />
							<span class="text-sm {getTrendColor(efficiency.trend)} capitalize">
								{efficiency.trend}
							</span>
						</div>

						<!-- Stats -->
						{#if efficiency.totalGallons > 0}
							<div class="grid grid-cols-2 gap-2 text-xs text-gray-600">
								<div class="text-center">
									<div class="font-medium text-gray-900">{efficiency.totalGallons.toFixed(0)}</div>
									<div>Gallons</div>
								</div>
								<div class="text-center">
									<div class="font-medium text-gray-900">
										{efficiency.totalMiles.toLocaleString()}
									</div>
									<div>Miles</div>
								</div>
							</div>
						{:else}
							<div class="text-center text-xs text-gray-500">No fuel data available</div>
						{/if}

						<!-- Quick Actions -->
						<div class="flex space-x-2">
							<a
								href="/vehicles/{vehicleData.id}/expenses"
								class="flex-1 text-center px-3 py-1 text-xs bg-blue-50 text-blue-700 rounded hover:bg-blue-100 transition-colors"
							>
								View Expenses
							</a>
							<a
								href="/analytics?vehicle={vehicleData.id}"
								class="flex-1 text-center px-3 py-1 text-xs bg-gray-50 text-gray-700 rounded hover:bg-gray-100 transition-colors"
							>
								Details
							</a>
						</div>
					</div>
				</div>
			{/each}
		</div>

		<!-- Overall Fleet Summary -->
		{#if Object.keys(vehicleEfficiencyData).length > 0}
			{@const fleetData = Object.values(vehicleEfficiencyData).filter(d => d.averageMPG > 0)}
			{@const fleetAvgMPG =
				fleetData.length > 0
					? fleetData.reduce((sum, d) => sum + d.averageMPG, 0) / fleetData.length
					: 0}
			{@const totalGallons = fleetData.reduce((sum, d) => sum + d.totalGallons, 0)}
			{@const totalMiles = fleetData.reduce((sum, d) => sum + d.totalMiles, 0)}

			<div class="bg-gradient-to-r from-blue-50 to-indigo-50 p-4 rounded-lg border border-blue-200">
				<h3 class="text-lg font-medium text-gray-900 mb-3">Fleet Summary</h3>

				<div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
					<div>
						<div class="text-xl font-bold text-blue-600">{fleetAvgMPG.toFixed(1)}</div>
						<div class="text-sm text-gray-600">Fleet Avg MPG</div>
					</div>

					<div>
						<div class="text-xl font-bold text-green-600">{totalGallons.toFixed(0)}</div>
						<div class="text-sm text-gray-600">Total Gallons</div>
					</div>

					<div>
						<div class="text-xl font-bold text-purple-600">{totalMiles.toLocaleString()}</div>
						<div class="text-sm text-gray-600">Total Miles</div>
					</div>

					<div>
						<div class="text-xl font-bold text-orange-600">
							{totalMiles > 0
								? totalGallons > 0
									? (totalMiles / totalGallons).toFixed(1)
									: '0.0'
								: '0.0'}
						</div>
						<div class="text-sm text-gray-600">Overall MPG</div>
					</div>
				</div>
			</div>
		{/if}
	{/if}
</div>
