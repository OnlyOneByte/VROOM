<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { createMultiLineChart, cleanupTooltips, type ChartData } from '$lib/utils/charts';

	interface Props {
		costData: ChartData[];
		milesData: ChartData[];
		costPerMileData: ChartData[];
		title?: string;
		width?: number;
		height?: number;
	}

	let { 
		costData, 
		milesData, 
		costPerMileData,
		title = 'Multi-Metric Trends', 
		width = 800, 
		height = 400 
	}: Props = $props();

	let chartContainer = $state<HTMLDivElement>();
	let selectedMetrics = $state(['cost', 'miles', 'costPerMile']);

	// Prepare data for multi-line chart
	let chartData = $derived.by(() => {
		const data: { [key: string]: ChartData[] } = {};
		
		if (selectedMetrics.includes('cost')) {
			data['Monthly Cost'] = costData;
		}
		
		if (selectedMetrics.includes('miles')) {
			data['Miles Driven'] = milesData;
		}
		
		if (selectedMetrics.includes('costPerMile')) {
			data['Cost per Mile'] = costPerMileData;
		}
		
		return data;
	});

	onMount(() => {
		if (chartContainer && Object.keys(chartData).length > 0) {
			renderChart();
		}
	});

	onDestroy(() => {
		cleanupTooltips();
	});

	function renderChart() {
		createMultiLineChart(chartContainer, chartData, { 
			width, 
			height,
			colors: ['#3b82f6', '#ef4444', '#10b981', '#f59e0b']
		});
	}

	function toggleMetric(metric: string) {
		if (selectedMetrics.includes(metric)) {
			selectedMetrics = selectedMetrics.filter(m => m !== metric);
		} else {
			selectedMetrics = [...selectedMetrics, metric];
		}
	}

	// Reactive update when data or selected metrics change
	$effect(() => {
		if (chartContainer && Object.keys(chartData).length > 0) {
			renderChart();
		}
	});
</script>

<div class="chart-wrapper">
	<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4">
		<h3 class="text-lg font-semibold text-gray-900 mb-2 sm:mb-0">{title}</h3>
		
		<div class="flex flex-wrap gap-2">
			<button
				class="px-3 py-1 text-sm rounded-md transition-colors {selectedMetrics.includes('cost') 
					? 'bg-blue-100 text-blue-700 border border-blue-300' 
					: 'bg-gray-100 text-gray-600 hover:bg-gray-200 border border-gray-300'}"
				onclick={() => toggleMetric('cost')}
			>
				Monthly Cost
			</button>
			<button
				class="px-3 py-1 text-sm rounded-md transition-colors {selectedMetrics.includes('miles') 
					? 'bg-red-100 text-red-700 border border-red-300' 
					: 'bg-gray-100 text-gray-600 hover:bg-gray-200 border border-gray-300'}"
				onclick={() => toggleMetric('miles')}
			>
				Miles Driven
			</button>
			<button
				class="px-3 py-1 text-sm rounded-md transition-colors {selectedMetrics.includes('costPerMile') 
					? 'bg-green-100 text-green-700 border border-green-300' 
					: 'bg-gray-100 text-gray-600 hover:bg-gray-200 border border-gray-300'}"
				onclick={() => toggleMetric('costPerMile')}
			>
				Cost per Mile
			</button>
		</div>
	</div>
	
	{#if selectedMetrics.length === 0}
		<div class="flex items-center justify-center h-64 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
			<div class="text-center">
				<div class="text-gray-400 text-4xl mb-2">📊</div>
				<p class="text-gray-500">Select at least one metric to display</p>
			</div>
		</div>
	{:else if Object.keys(chartData).length === 0}
		<div class="flex items-center justify-center h-64 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
			<div class="text-center">
				<div class="text-gray-400 text-4xl mb-2">📊</div>
				<p class="text-gray-500">No data available for selected metrics</p>
			</div>
		</div>
	{:else}
		<div class="bg-white p-4 rounded-lg shadow border">
			<div bind:this={chartContainer} class="chart-container"></div>
			
			<!-- Summary stats -->
			<div class="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
				{#if selectedMetrics.includes('cost') && costData.length > 0}
					<div class="bg-blue-50 p-4 rounded-lg">
						<div class="text-sm font-medium text-blue-800">Total Cost</div>
						<div class="text-2xl font-bold text-blue-900">
							${costData.reduce((sum, d) => sum + (d.amount || 0), 0).toFixed(2)}
						</div>
						<div class="text-xs text-blue-600 mt-1">
							Avg: ${(costData.reduce((sum, d) => sum + (d.amount || 0), 0) / costData.length).toFixed(2)}/month
						</div>
					</div>
				{/if}
				
				{#if selectedMetrics.includes('miles') && milesData.length > 0}
					<div class="bg-red-50 p-4 rounded-lg">
						<div class="text-sm font-medium text-red-800">Total Miles</div>
						<div class="text-2xl font-bold text-red-900">
							{milesData.reduce((sum, d) => sum + (d.miles || 0), 0).toLocaleString()}
						</div>
						<div class="text-xs text-red-600 mt-1">
							Avg: {Math.round(milesData.reduce((sum, d) => sum + (d.miles || 0), 0) / milesData.length).toLocaleString()}/month
						</div>
					</div>
				{/if}
				
				{#if selectedMetrics.includes('costPerMile') && costPerMileData.length > 0}
					<div class="bg-green-50 p-4 rounded-lg">
						<div class="text-sm font-medium text-green-800">Avg Cost/Mile</div>
						<div class="text-2xl font-bold text-green-900">
							${(costPerMileData.reduce((sum, d) => sum + (d.costPerMile || 0), 0) / costPerMileData.length).toFixed(3)}
						</div>
						<div class="text-xs text-green-600 mt-1">
							Range: ${Math.min(...costPerMileData.map(d => d.costPerMile || 0)).toFixed(3)} - ${Math.max(...costPerMileData.map(d => d.costPerMile || 0)).toFixed(3)}
						</div>
					</div>
				{/if}
			</div>
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