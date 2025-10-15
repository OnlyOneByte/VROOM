<script lang="ts">
	import { isOnline, syncStatus, offlineExpenses } from '$lib/stores/offline';
	import { syncOfflineExpenses } from '$lib/utils/offline-storage';
	import { Wifi, WifiOff, RefreshCw, CheckCircle, AlertCircle } from 'lucide-svelte';

	$: pendingCount = $offlineExpenses.filter(expense => !expense.synced).length;

	async function handleSync() {
		if ($isOnline && pendingCount > 0) {
			await syncOfflineExpenses();
		}
	}
</script>

<div class="fixed top-4 right-4 z-50">
	{#if !$isOnline}
		<!-- Offline indicator -->
		<div class="bg-red-500 text-white px-3 py-2 rounded-lg shadow-lg flex items-center gap-2">
			<WifiOff size={16} />
			<span class="text-sm font-medium">Offline</span>
			{#if pendingCount > 0}
				<span class="bg-red-600 text-xs px-2 py-1 rounded-full">
					{pendingCount} pending
				</span>
			{/if}
		</div>
	{:else if $syncStatus === 'syncing'}
		<!-- Syncing indicator -->
		<div class="bg-blue-500 text-white px-3 py-2 rounded-lg shadow-lg flex items-center gap-2">
			<RefreshCw size={16} class="animate-spin" />
			<span class="text-sm font-medium">Syncing...</span>
		</div>
	{:else if $syncStatus === 'success'}
		<!-- Success indicator -->
		<div class="bg-green-500 text-white px-3 py-2 rounded-lg shadow-lg flex items-center gap-2">
			<CheckCircle size={16} />
			<span class="text-sm font-medium">Synced</span>
		</div>
	{:else if $syncStatus === 'error'}
		<!-- Error indicator -->
		<div class="bg-red-500 text-white px-3 py-2 rounded-lg shadow-lg flex items-center gap-2">
			<AlertCircle size={16} />
			<span class="text-sm font-medium">Sync failed</span>
			<button on:click={handleSync} class="bg-red-600 hover:bg-red-700 px-2 py-1 rounded text-xs">
				Retry
			</button>
		</div>
	{:else if pendingCount > 0}
		<!-- Pending sync indicator -->
		<div class="bg-yellow-500 text-white px-3 py-2 rounded-lg shadow-lg flex items-center gap-2">
			<Wifi size={16} />
			<span class="text-sm font-medium">Online</span>
			<button
				on:click={handleSync}
				class="bg-yellow-600 hover:bg-yellow-700 px-2 py-1 rounded text-xs flex items-center gap-1"
			>
				<RefreshCw size={12} />
				Sync {pendingCount}
			</button>
		</div>
	{/if}
</div>
