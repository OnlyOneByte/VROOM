<script lang="ts">
	import { onMount } from 'svelte';
	import { syncStatus, isOnline, offlineExpenses } from '$lib/stores/offline';
	import {
		syncManager,
		lastSyncTime,
		syncConflicts,
		fetchLastSyncTime
	} from '$lib/utils/sync-manager';
	import { RefreshCw, CircleAlert, Clock, Wifi, WifiOff } from 'lucide-svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { formatCompactRelativeTime } from '$lib/utils/formatters';
	import { getSyncStatusInfo } from '$lib/utils/sync-status';

	let { isExpanded = true } = $props();

	let pendingCount = $derived($offlineExpenses.filter(expense => !expense.synced).length);

	let statusInfo = $derived(
		getSyncStatusInfo({
			isOnline: $isOnline,
			syncStatus: $syncStatus,
			pendingCount,
			conflictsCount: $syncConflicts.length
		})
	);

	onMount(() => {
		syncManager.setupAutoSync();

		// Refresh last sync time every 30 seconds
		const interval = setInterval(() => {
			if ($isOnline) {
				fetchLastSyncTime();
			}
		}, 30000);

		return () => clearInterval(interval);
	});

	async function handleManualSync() {
		if ($isOnline && pendingCount > 0) {
			try {
				await syncManager.syncAll();
			} catch (error) {
				console.error('Manual sync failed:', error);
			}
		}
	}
</script>

<div class="border-t border-gray-200 pt-3 space-y-2">
	{#if isExpanded}
		<!-- Expanded view with all details -->
		<div class="px-3 space-y-2">
			<!-- Status header -->
			<div class="flex items-center justify-between">
				{#snippet statusHeader()}
					{@const StatusIcon = statusInfo.icon}
					<div class="flex items-center gap-2 {statusInfo.color}">
						<StatusIcon class="h-4 w-4 {$syncStatus === 'syncing' ? 'animate-spin' : ''}" />
						<span class="text-xs font-medium">{statusInfo.text}</span>
					</div>
				{/snippet}
				{@render statusHeader()}
			</div>

			<!-- Connection status -->
			<div class="flex items-center justify-between text-xs">
				<span class="text-gray-500">Connection</span>
				{#snippet connectionStatus()}
					{@const ConnectionIcon = $isOnline ? Wifi : WifiOff}
					<Badge
						variant={$isOnline ? 'default' : 'destructive'}
						class="text-xs px-2 py-0.5 gap-1 {$isOnline ? 'bg-green-600 border-transparent' : ''}"
					>
						<ConnectionIcon class="h-3 w-3" />
						<span>{$isOnline ? 'Online' : 'Offline'}</span>
					</Badge>
				{/snippet}
				{@render connectionStatus()}
			</div>

			<!-- Pending expenses -->
			{#if pendingCount > 0}
				<div class="flex items-center justify-between text-xs">
					<span class="text-gray-500">Pending</span>
					<Badge
						variant="secondary"
						class="text-xs px-2 py-0.5 gap-1 bg-yellow-500 text-white border-transparent"
					>
						<Clock class="h-3 w-3" />
						<span>{pendingCount}</span>
					</Badge>
				</div>
			{/if}

			<!-- Conflicts -->
			{#if $syncConflicts.length > 0}
				<div class="flex items-center justify-between text-xs">
					<span class="text-gray-500">Conflicts</span>
					<Badge
						variant="secondary"
						class="text-xs px-2 py-0.5 gap-1 bg-orange-500 text-white border-transparent"
					>
						<CircleAlert class="h-3 w-3" />
						<span>{$syncConflicts.length}</span>
					</Badge>
				</div>
			{/if}

			<!-- Last sync -->
			<div class="flex items-center justify-between text-xs">
				<span class="text-gray-500">Last sync</span>
				<span class="text-gray-700">{formatCompactRelativeTime($lastSyncTime)}</span>
			</div>

			<!-- Sync button -->
			{#if $isOnline && pendingCount > 0}
				<button
					onclick={handleManualSync}
					disabled={$syncStatus === 'syncing'}
					class="w-full bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white px-3 py-1.5 rounded text-xs font-medium flex items-center justify-center gap-1.5"
				>
					<RefreshCw class="h-3 w-3 {$syncStatus === 'syncing' ? 'animate-spin' : ''}" />
					{$syncStatus === 'syncing' ? 'Syncing...' : 'Sync Now'}
				</button>
			{/if}
		</div>
	{:else}
		<!-- Collapsed view - just icon -->
		{#snippet collapsedIcon()}
			{@const StatusIcon = statusInfo.icon}
			<div class="flex justify-center px-3">
				<div class="{statusInfo.color} relative" title={statusInfo.text}>
					<StatusIcon class="h-5 w-5 {$syncStatus === 'syncing' ? 'animate-spin' : ''}" />
					{#if pendingCount > 0}
						<Badge
							variant="secondary"
							class="absolute -top-1 -right-1 bg-yellow-500 text-white text-[10px] font-bold h-3.5 w-3.5 p-0 flex items-center justify-center border-transparent"
						>
							{pendingCount > 9 ? '9+' : pendingCount}
						</Badge>
					{/if}
				</div>
			</div>
		{/snippet}
		{@render collapsedIcon()}
	{/if}
</div>
