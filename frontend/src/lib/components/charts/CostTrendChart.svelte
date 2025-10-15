<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { createLineChart, cleanupTooltips, type ChartData } from '$lib/utils/charts';

	interface Props {
		data: ChartData[];
		title?: string;
		width?: number;
		height?: number;
	}

	let { data, title = 'Cost Trends', width = 800, height = 400 }: Props = $props();

	let chartContainer = $state<HTMLDivElement>();

	onMount(() => {
		if (chartContainer && data.length > 0) {
			createLineChart(chartContainer, data, { width, height });
		}
	});

	onDestroy(() => {
		cleanupTooltips();
	});

	// Reactive update when data changes
	$effect(() => {
		if (chartContainer && data.length > 0) {
			createLineChart(chartContainer, data, { width, height });
		}
	});
</script>

<div class="w-full">
	<h3 class="text-lg font-semibold text-gray-900 mb-4">{title}</h3>

	{#if data.length === 0}
		<div
			class="flex items-center justify-center h-64 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300"
		>
			<div class="text-center">
				<div class="text-gray-400 text-4xl mb-2">📊</div>
				<p class="text-gray-500">No data available for the selected period</p>
			</div>
		</div>
	{:else}
		<div class="bg-white p-4 rounded-lg shadow border">
			<div bind:this={chartContainer} class="w-full overflow-x-auto"></div>
		</div>
	{/if}
</div>
