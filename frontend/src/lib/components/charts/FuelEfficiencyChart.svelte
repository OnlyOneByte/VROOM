<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { createLineChart, cleanupTooltips, type ChartData } from '$lib/utils/charts';

	interface Props {
		data: Array<{
			date: string;
			mpg: number;
			mileage: number;
		}>;
		title?: string;
		width?: number;
		height?: number;
		averageMPG?: number;
	}

	let { 
		data, 
		title = 'Fuel Efficiency Trends', 
		width = 800, 
		height = 400,
		averageMPG = 0
	}: Props = $props();

	let chartContainer = $state<HTMLDivElement>();

	// Convert data to chart format
	let chartData = $derived.by(() => {
		return data.map(item => ({
			period: item.date.substring(0, 7), // Convert to YYYY-MM format
			mpg: item.mpg,
			mileage: item.mileage
		}));
	});

	onMount(() => {
		if (chartContainer && chartData.length > 0) {
			renderChart();
		}
	});

	onDestroy(() => {
		cleanupTooltips();
	});

	function renderChart() {
		// Create custom chart for MPG data
		createLineChart(chartContainer, chartData.map(d => ({ 
			period: d.period, 
			amount: d.mpg 
		})), { 
			width, 
			height,
			colors: ['#10b981'] // Green color for efficiency
		});
	}

	// Reactive update when data changes
	$effect(() => {
		if (chartContainer && chartData.length > 0) {
			renderChart();
		}
	});

	// Calculate efficiency alerts
	let efficiencyAlerts = $derived.by(() => {
		if (chartData.length < 2 || averageMPG === 0) return [];
		
		const alerts = [];
		const recentReadings = chartData.slice(-3);
		const recentAverage = recentReadings.reduce((sum, d) => sum + d.mpg, 0) / recentReadings.length;
		
		if (recentAverage < averageMPG * 0.85) {
			const dropPercentage = ((averageMPG - recentAverage) / averageMPG * 100).toFixed(1);
			alerts.push({
				type: 'efficiency_drop',
				message: `Recent fuel efficiency is ${dropPercentage}% below average`,
				severity: recentAverage < averageMPG * 0.7 ? 'high' : 'medium'
			});
		}
		
		return alerts;
	});
</script>

<div class="chart-wrapper">
	<h3 class="text-lg font-semibold text-gray-900 mb-4">{title}</h3>
	
	{#if efficiencyAlerts.length > 0}
		<div class="mb-4 space-y-2">
			{#each efficiencyAlerts as alert}
				<div class="p-3 rounded-md {alert.severity === 'high' 
					? 'bg-red-50 border border-red-200' 
					: 'bg-yellow-50 border border-yellow-200'}">
					<div class="flex items-center">
						<div class="text-lg mr-2">
							{alert.severity === 'high' ? '🚨' : '⚠️'}
						</div>
						<div>
							<p class="text-sm font-medium {alert.severity === 'high' 
								? 'text-red-800' 
								: 'text-yellow-800'}">
								Efficiency Alert
							</p>
							<p class="text-sm {alert.severity === 'high' 
								? 'text-red-700' 
								: 'text-yellow-700'}">
								{alert.message}
							</p>
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}
	
	{#if chartData.length === 0}
		<div class="flex items-center justify-center h-64 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
			<div class="text-center">
				<div class="text-gray-400 text-4xl mb-2">⛽</div>
				<p class="text-gray-500">No fuel efficiency data available</p>
				<p class="text-gray-400 text-sm mt-1">Add fuel expenses with mileage to see trends</p>
			</div>
		</div>
	{:else}
		<div class="bg-white p-4 rounded-lg shadow border">
			<div bind:this={chartContainer} class="chart-container"></div>
			
			<!-- Summary stats -->
			<div class="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
				<div class="bg-green-50 p-4 rounded-lg">
					<div class="text-sm font-medium text-green-800">Average MPG</div>
					<div class="text-2xl font-bold text-green-900">{averageMPG.toFixed(1)}</div>
				</div>
				
				<div class="bg-blue-50 p-4 rounded-lg">
					<div class="text-sm font-medium text-blue-800">Latest MPG</div>
					<div class="text-2xl font-bold text-blue-900">
						{chartData[chartData.length - 1]?.mpg.toFixed(1) || '0.0'}
					</div>
				</div>
				
				<div class="bg-purple-50 p-4 rounded-lg">
					<div class="text-sm font-medium text-purple-800">Best MPG</div>
					<div class="text-2xl font-bold text-purple-900">
						{Math.max(...chartData.map(d => d.mpg)).toFixed(1)}
					</div>
				</div>
			</div>
			
			<!-- Recent readings table -->
			{#if chartData.length > 0}
				<div class="mt-6">
					<h4 class="text-md font-medium text-gray-900 mb-3">Recent Readings</h4>
					<div class="overflow-x-auto">
						<table class="min-w-full divide-y divide-gray-200">
							<thead class="bg-gray-50">
								<tr>
									<th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
										Date
									</th>
									<th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
										MPG
									</th>
									<th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
										Mileage
									</th>
								</tr>
							</thead>
							<tbody class="bg-white divide-y divide-gray-200">
								{#each chartData.slice(-5).reverse() as item}
									<tr>
										<td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
											{new Date(item.period + '-01').toLocaleDateString('en-US', { 
												year: 'numeric', 
												month: 'short' 
											})}
										</td>
										<td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
											{item.mpg.toFixed(1)}
										</td>
										<td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
											{item.mileage.toLocaleString()}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.chart-wrapper {
		@apply w-full;
	}
	
	.chart-container {
		@apply w-full overflow-x-auto;
	}
	
	:global(.chart-container svg) {
		max-width: 100%;
		height: auto;
	}
</style>