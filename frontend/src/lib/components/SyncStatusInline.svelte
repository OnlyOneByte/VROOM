<script lang="ts">
	import { onMount } from 'svelte';
	import { syncStatus, isOnline, offlineExpenses } from '$lib/stores/offline';
	import { syncManager, lastSyncTime, syncConflicts } from '$lib/utils/sync-manager';
	import { RefreshCw, CircleCheck, CircleAlert, Clock, Wifi, WifiOff } from 'lucide-svelte';

	let { isExpanded = true } = $props();

	let pendingCount = $derived($offlineExpenses.filter(expense => !expense.synced).length);
	let hasConflicts = $derived($syncConflicts.length > 0);

	onMount(() => {
		syncManager.setupAutoSync();
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

	function formatLastSync(date: Date | null): string {
		if (!date) return 'Never';

		const now = new Date();
		const diff = now.getTime() - date.getTime();
		const minutes = Math.floor(diff / 60000);
		const hours = Math.floor(minutes / 60);
		const days = Math.floor(hours / 24);

		if (minutes < 1) return 'Just now';
		if (minutes < 60) return `${minutes}m ago`;
		if (hours < 24) return `${hours}h ago`;
		return `${days}d ago`;
	}

	function getStatusColor(): string {
		if (!$isOnline) return 'text-red-500';
		if (hasConflicts) return 'text-orange-500';
		if ($syncStatus === 'syncing') return 'text-yellow-500';
		if ($syncStatus === 'error') return 'text-red-500';
		if ($syncStatus === 'success') return 'text-green-500';
		if (pendingCount > 0) return 'text-yellow-500';
		return 'text-green-500';
	}

	function getStatusIcon() {
		if (!$isOnline) return WifiOff;
		if (hasConflicts) return CircleAlert;
		if ($syncStatus === 'syncing') return RefreshCw;
		if ($syncStatus === 'error') return CircleAlert;
		if ($syncStatus === 'success') return CircleCheck;
		if (pendingCount > 0) return Clock;
		return Wifi;
	}

	function getStatusText(): string {
		if (!$isOnline) return 'Offline';
		if (hasConflicts) return `${$syncConflicts.length} conflicts`;
		if ($syncStatus === 'syncing') return 'Syncing...';
		if ($syncStatus === 'error') return 'Sync failed';
		if ($syncStatus === 'success') return 'Synced';
		if (pendingCount > 0) return `${pendingCount} pending`;
		return 'Up to date';
	}
</script>

<div class="border-t border-gray-200 pt-3 space-y-2">
	{#if isExpanded}
		<!-- Expanded view with all details -->
		<div class="px-3 space-y-2">
			<!-- Status header -->
			<div class="flex items-center justify-between">
				{#snippet statusHeader()}
					{@const StatusIcon = getStatusIcon()}
					<div class="flex items-center gap-2 {getStatusColor()}">
						<StatusIcon class="h-4 w-4 {$syncStatus === 'syncing' ? 'animate-spin' : ''}" />
						<span class="text-xs font-medium">{getStatusText()}</span>
					</div>
				{/snippet}
				{@render statusHeader()}
			</div>

			<!-- Connection status -->
			<div class="flex items-center justify-between text-xs">
				<span class="text-gray-500">Connection</span>
				{#snippet connectionStatus()}
					{@const ConnectionIcon = $isOnline ? Wifi : WifiOff}
					<div class="flex items-center gap-1 {$isOnline ? 'text-green-600' : 'text-red-600'}">
						<ConnectionIcon class="h-3 w-3" />
						<span>{$isOnline ? 'Online' : 'Offline'}</span>
					</div>
				{/snippet}
				{@render connectionStatus()}
			</div>

			<!-- Pending expenses -->
			{#if pendingCount > 0}
				<div class="flex items-center justify-between text-xs">
					<span class="text-gray-500">Pending</span>
					<div class="flex items-center gap-1 text-yellow-600">
						<Clock class="h-3 w-3" />
						<span>{pendingCount}</span>
					</div>
				</div>
			{/if}

			<!-- Conflicts -->
			{#if hasConflicts}
				<div class="flex items-center justify-between text-xs">
					<span class="text-gray-500">Conflicts</span>
					<div class="flex items-center gap-1 text-orange-600">
						<CircleAlert class="h-3 w-3" />
						<span>{$syncConflicts.length}</span>
					</div>
				</div>
			{/if}

			<!-- Last sync -->
			<div class="flex items-center justify-between text-xs">
				<span class="text-gray-500">Last sync</span>
				<span class="text-gray-700">{formatLastSync($lastSyncTime)}</span>
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
			{@const StatusIcon = getStatusIcon()}
			<div class="flex justify-center px-3">
				<div class="{getStatusColor()} relative" title={getStatusText()}>
					<StatusIcon class="h-5 w-5 {$syncStatus === 'syncing' ? 'animate-spin' : ''}" />
					{#if pendingCount > 0}
						<span
							class="absolute -top-1 -right-1 bg-yellow-500 text-white text-[10px] font-bold rounded-full h-3.5 w-3.5 flex items-center justify-center"
						>
							{pendingCount > 9 ? '9+' : pendingCount}
						</span>
					{/if}
				</div>
			</div>
		{/snippet}
		{@render collapsedIcon()}
	{/if}
</div>
