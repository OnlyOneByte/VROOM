<script lang="ts">
	import { onlineStatus, syncState, offlineExpenseQueue } from '$lib/stores/offline.svelte';
	import { syncOfflineExpenses } from '$lib/utils/offline-storage';
	import { Wifi, WifiOff, RefreshCw, CircleCheck, CircleAlert } from '@lucide/svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';

	let pendingCount = $derived(
		offlineExpenseQueue.current.filter(expense => !expense.synced).length
	);

	async function handleSync() {
		if (onlineStatus.current && pendingCount > 0) {
			await syncOfflineExpenses();
		}
	}
</script>

<div class="fixed top-4 right-4 z-50">
	{#if !onlineStatus.current}
		<Badge variant="destructive" class="px-3 py-2 shadow-lg text-sm gap-2">
			<WifiOff size={16} />
			<span class="font-medium">Offline</span>
			{#if pendingCount > 0}
				<Badge variant="destructive" class="text-xs px-2 py-1">
					{pendingCount} pending
				</Badge>
			{/if}
		</Badge>
	{:else if syncState.current === 'syncing'}
		<Badge
			variant="secondary"
			class="px-3 py-2 shadow-lg text-sm gap-2 bg-primary text-primary-foreground border-transparent"
		>
			<RefreshCw size={16} class="animate-spin" />
			<span class="font-medium">Syncing...</span>
		</Badge>
	{:else if syncState.current === 'success'}
		<Badge variant="default" class="px-3 py-2 shadow-lg text-sm gap-2 border-transparent">
			<CircleCheck size={16} />
			<span class="font-medium">Synced</span>
		</Badge>
	{:else if syncState.current === 'error'}
		<Badge variant="destructive" class="px-3 py-2 shadow-lg text-sm gap-2">
			<CircleAlert size={16} />
			<span class="font-medium">Sync failed</span>
			<Button variant="destructive" size="sm" onclick={handleSync} class="h-auto px-2 py-1 text-xs">
				Retry
			</Button>
		</Badge>
	{:else if pendingCount > 0}
		<Badge variant="outline" class="px-3 py-2 shadow-lg text-sm gap-2">
			<Wifi size={16} />
			<span class="font-medium">Online</span>
			<Button
				variant="secondary"
				size="sm"
				onclick={handleSync}
				class="h-auto px-2 py-1 text-xs gap-1"
			>
				<RefreshCw size={12} />
				Sync {pendingCount}
			</Button>
		</Badge>
	{/if}
</div>
