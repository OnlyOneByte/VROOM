<script lang="ts">
	import { onMount } from 'svelte';
	import { Plus, Receipt, RefreshCw, Clock, CheckCircle } from 'lucide-svelte';
	import { offlineExpenses, isOnline, syncStatus } from '$lib/stores/offline';
	import { syncOfflineExpenses } from '$lib/utils/offline-storage';

	let loading = true;

	$: pendingExpenses = $offlineExpenses.filter(expense => !expense.synced);
	$: syncedExpenses = $offlineExpenses.filter(expense => expense.synced);

	onMount(async () => {
		await loadExpenses();
	});

	async function loadExpenses() {
		loading = true;
		try {
			// In a real implementation, this would load from the API
			// For now, we'll just show offline expenses
		} catch (error) {
			console.error('Failed to load expenses:', error);
		} finally {
			loading = false;
		}
	}

	async function handleSync() {
		if ($isOnline && pendingExpenses.length > 0) {
			await syncOfflineExpenses();
		}
	}
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

		<a href="/expenses/new" class="btn btn-primary inline-flex items-center gap-2">
			<Plus class="h-4 w-4" />
			Add Expense
		</a>
	</div>

	<!-- Offline Expenses Section -->
	{#if pendingExpenses.length > 0}
		<div class="card">
			<div class="flex items-center justify-between mb-4">
				<div class="flex items-center gap-2">
					<Clock class="h-5 w-5 text-orange-500" />
					<h2 class="text-lg font-semibold text-gray-900">
						Pending Sync ({pendingExpenses.length})
					</h2>
				</div>

				{#if $isOnline}
					<button
						on:click={handleSync}
						disabled={$syncStatus === 'syncing'}
						class="btn btn-sm btn-primary flex items-center gap-2"
					>
						<RefreshCw class="h-4 w-4 {$syncStatus === 'syncing' ? 'animate-spin' : ''}" />
						{$syncStatus === 'syncing' ? 'Syncing...' : 'Sync Now'}
					</button>
				{:else}
					<span class="text-sm text-gray-500">Will sync when online</span>
				{/if}
			</div>

			<div class="space-y-3">
				{#each pendingExpenses as expense}
					<div
						class="flex items-center justify-between p-3 bg-orange-50 border border-orange-200 rounded-lg"
					>
						<div class="flex-1">
							<div class="flex items-center gap-2 mb-1">
								<span class="font-medium text-gray-900 capitalize">{expense.type}</span>
								<span class="text-sm text-gray-500">•</span>
								<span class="text-sm text-gray-600">{expense.date}</span>
							</div>
							<div class="text-sm text-gray-600">
								${expense.amount.toFixed(2)}
								{#if expense.description}
									• {expense.description}
								{/if}
							</div>
						</div>
						<Clock class="h-4 w-4 text-orange-500" />
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Synced Offline Expenses -->
	{#if syncedExpenses.length > 0}
		<div class="card">
			<div class="flex items-center gap-2 mb-4">
				<CheckCircle class="h-5 w-5 text-green-500" />
				<h2 class="text-lg font-semibold text-gray-900">
					Recently Synced ({syncedExpenses.length})
				</h2>
			</div>

			<div class="space-y-3">
				{#each syncedExpenses.slice(0, 5) as expense}
					<div
						class="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-lg"
					>
						<div class="flex-1">
							<div class="flex items-center gap-2 mb-1">
								<span class="font-medium text-gray-900 capitalize">{expense.type}</span>
								<span class="text-sm text-gray-500">•</span>
								<span class="text-sm text-gray-600">{expense.date}</span>
							</div>
							<div class="text-sm text-gray-600">
								${expense.amount.toFixed(2)}
								{#if expense.description}
									• {expense.description}
								{/if}
							</div>
						</div>
						<CheckCircle class="h-4 w-4 text-green-500" />
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Empty State -->
	{#if pendingExpenses.length === 0 && syncedExpenses.length === 0 && !loading}
		<div class="card text-center py-12">
			<Receipt class="h-12 w-12 text-gray-400 mx-auto mb-4" />
			<h3 class="text-lg font-medium text-gray-900 mb-2">No expenses yet</h3>
			<p class="text-gray-600 mb-6">Start tracking your vehicle expenses with offline support</p>
			<a href="/expenses/new" class="btn btn-primary inline-flex items-center gap-2">
				<Plus class="h-4 w-4" />
				Add Your First Expense
			</a>
		</div>
	{/if}
</div>
