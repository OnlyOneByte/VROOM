<script lang="ts">
	import { Plus, Receipt } from 'lucide-svelte';
</script>

<svelte:head>
	<title>Expenses - VROOM Car Tracker</title>
	<meta name="description" content="Track and manage your vehicle expenses" />
</svelte:head>

<div class="space-y-6">
	<!-- Header -->
	<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
		<div>
			<h1 class="text-2xl font-bold text-gray-900">Expenses</h1>
			<p class="text-gray-600">Track and categorize your vehicle expenses</p>
		</div>
		
		<a 
			href="/expenses/new" 
			class="btn btn-primary inline-flex items-center gap-2"
		>
			<Plus class="h-4 w-4" />
			Add Expense
		</a>
	</div>

	<!-- Placeholder content -->
	<div class="card text-center py-12">
		<Receipt class="h-12 w-12 text-gray-400 mx-auto mb-4" />
		<h3 class="text-lg font-medium text-gray-900 mb-2">Expense tracking coming soon</h3>
		<p class="text-gray-600 mb-6">
			This feature will be implemented in the next task
		</p>
	</div>
</div>