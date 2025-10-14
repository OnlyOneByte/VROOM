<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { createBarChart, createPieChart, cleanupTooltips, type CategoryData } from '$lib/utils/charts';

	interface Props {
		data: { [category: string]: { amount: number; count: number; percentage: number } };
		title?: string;
		chartType?: 'bar' | 'pie';
		width?: number;
		height?: number;
	}

	let { 
		data, 
		title = 'Expense Categories', 
		chartType = 'bar',
		width = 800, 
		height = 400 
	}: Props = $props();

	let chartContainer = $state<HTMLDivElement>();

	// Convert data object to array format for charts
	let chartData = $derived.by(() => {
		return Object.entries(data).map(([category, info]) => ({
			category: category.charAt(0).toUpperCase() + category.slice(1),
			amount: info.amount,
			count: info.count,
			percentage: info.percentage
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
		if (chartType === 'pie') {
			createPieChart(chartContainer, chartData, { width, height });
		} else {
			createBarChart(chartContainer, chartData, { width, height });
		}
	}

	// Reactive update when data or chart type changes
	$effect(() => {
		if (chartContainer && chartData.length > 0) {
			renderChart();
		}
	});
</script>

<div class="chart-wrapper">
	<div class="flex items-center justify-between mb-4">
		<h3 class="text-lg font-semibold text-gray-900">{title}</h3>
		
		<div class="flex space-x-2">
			<button
				class="px-3 py-1 text-sm rounded-md transition-colors {chartType === 'bar' 
					? 'bg-blue-100 text-blue-700' 
					: 'bg-gray-100 text-gray-600 hover:bg-gray-200'}"
				onclick={() => chartType = 'bar'}
			>
				Bar Chart
			</button>
			<button
				class="px-3 py-1 text-sm rounded-md transition-colors {chartType === 'pie' 
					? 'bg-blue-100 text-blue-700' 
					: 'bg-gray-100 text-gray-600 hover:bg-gray-200'}"
				onclick={() => chartType = 'pie'}
			>
				Pie Chart
			</button>
		</div>
	</div>
	
	{#if chartData.length === 0}
		<div class="flex items-center justify-center h-64 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
			<div class="text-center">
				<div class="text-gray-400 text-4xl mb-2">📊</div>
				<p class="text-gray-500">No expense categories to display</p>
			</div>
		</div>
	{:else}
		<div class="bg-white p-4 rounded-lg shadow border">
			<div bind:this={chartContainer} class="chart-container"></div>
			
			<!-- Summary table -->
			<div class="mt-6 overflow-x-auto">
				<table class="min-w-full divide-y divide-gray-200">
					<thead class="bg-gray-50">
						<tr>
							<th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
								Category
							</th>
							<th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
								Amount
							</th>
							<th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
								Count
							</th>
							<th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
								Percentage
							</th>
						</tr>
					</thead>
					<tbody class="bg-white divide-y divide-gray-200">
						{#each chartData as item}
							<tr>
								<td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
									{item.category}
								</td>
								<td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
									${item.amount.toFixed(2)}
								</td>
								<td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
									{item.count}
								</td>
								<td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
									{item.percentage.toFixed(1)}%
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
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