<script lang="ts">
	import { BarChart3 } from 'lucide-svelte';
</script>

<svelte:head>
	<title>Analytics - VROOM Car Tracker</title>
	<meta name="description" content="Analyze your vehicle expenses and trends" />
</svelte:head>

<div class="space-y-6">
	<!-- Header -->
	<div>
		<h1 class="text-2xl font-bold text-gray-900">Analytics</h1>
		<p class="text-gray-600">Visualize your spending patterns and trends</p>
	</div>

	<!-- Placeholder content -->
	<div class="card text-center py-12">
		<BarChart3 class="h-12 w-12 text-gray-400 mx-auto mb-4" />
		<h3 class="text-lg font-medium text-gray-900 mb-2">Analytics dashboard coming soon</h3>
		<p class="text-gray-600 mb-6">
			This feature will be implemented in a future task
		</p>
	</div>
</div>