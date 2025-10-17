<script lang="ts">
	import { isOnline, syncStatus, offlineExpenses } from '$lib/stores/offline';
	import { syncOfflineExpenses } from '$lib/utils/offline-storage';
	import { Wifi, WifiOff, RefreshCw, CheckCircle, AlertCircle } from 'lucide-svelte';
	import { Badge } from '$lib/components/ui/badge';

	let pendingCount = $derived($offlineExpenses.filter(expense => !expense.synced).length);

	async function handleSync() {
		if ($isOnline && pendingCount > 0) {
			await syncOfflineExpenses();
		}
	}
</script>

<div class="fixed top-4 right-4 z-50">
	{#if !$isOnline}
		<!-- Offline indicator -->
		<Badge variant="destructive" class="px-3 py-2 shadow-lg text-sm gap-2">
			<WifiOff size={16} />
			<span class="font-medium">Offline</span>
			{#if pendingCount > 0}
				<Badge variant="destructive" class="bg-red-600 text-xs px-2 py-1">
					{pendingCount} pending
				</Badge>
			{/if}
		</Badge>
	{:else if $syncStatus === 'syncing'}
		<!-- Syncing indicator -->
		<Badge
			variant="secondary"
			class="px-3 py-2 shadow-lg text-sm gap-2 bg-blue-500 text-white border-transparent"
		>
			<RefreshCw size={16} class="animate-spin" />
			<span class="font-medium">Syncing...</span>
		</Badge>
	{:else if $syncStatus === 'success'}
		<!-- Success indicator -->
		<Badge
			variant="default"
			class="px-3 py-2 shadow-lg text-sm gap-2 bg-green-500 text-white border-transparent"
		>
			<CheckCircle size={16} />
			<span class="font-medium">Synced</span>
		</Badge>
	{:else if $syncStatus === 'error'}
		<!-- Error indicator -->
		<Badge variant="destructive" class="px-3 py-2 shadow-lg text-sm gap-2">
			<AlertCircle size={16} />
			<span class="font-medium">Sync failed</span>
			<button onclick={handleSync} class="bg-red-600 hover:bg-red-700 px-2 py-1 rounded text-xs">
				Retry
			</button>
		</Badge>
	{:else if pendingCount > 0}
		<!-- Pending sync indicator -->
		<Badge
			variant="secondary"
			class="px-3 py-2 shadow-lg text-sm gap-2 bg-yellow-500 text-white border-transparent"
		>
			<Wifi size={16} />
			<span class="font-medium">Online</span>
			<button
				onclick={handleSync}
				class="bg-yellow-600 hover:bg-yellow-700 px-2 py-1 rounded text-xs flex items-center gap-1"
			>
				<RefreshCw size={12} />
				Sync {pendingCount}
			</button>
		</Badge>
	{/if}
</div>
