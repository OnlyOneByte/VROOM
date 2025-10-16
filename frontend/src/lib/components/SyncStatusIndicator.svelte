<script lang="ts">
	import { onMount } from 'svelte';
	import { syncStatus, isOnline, offlineExpenses } from '$lib/stores/offline';
	import { syncManager, lastSyncTime, syncConflicts } from '$lib/utils/sync-manager';
	import { RefreshCw, CircleCheck, CircleAlert, Clock, Wifi, WifiOff } from 'lucide-svelte';

	let showDetails = false;

	$: pendingCount = $offlineExpenses.filter(expense => !expense.synced).length;
	$: hasConflicts = $syncConflicts.length > 0;

	onMount(() => {
		// Setup auto-sync
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
		if ($syncStatus === 'syncing') return 'text-blue-500';
		if ($syncStatus === 'error') return 'text-red-500';
		if ($syncStatus === 'success') return 'text-green-500';
		if (pendingCount > 0) return 'text-yellow-500';
		return 'text-gray-500';
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

<div class="relative">
	<!-- Status indicator button -->
	<button
		on:click={() => (showDetails = !showDetails)}
		class="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors {getStatusColor()}"
	>
		<svelte:component
			this={getStatusIcon()}
			class="h-4 w-4 {$syncStatus === 'syncing' ? 'animate-spin' : ''}"
		/>
		<span class="text-sm font-medium">{getStatusText()}</span>
	</button>

	<!-- Details dropdown -->
	{#if showDetails}
		<div
			class="absolute top-full right-0 mt-2 w-80 bg-white border border-gray-200 rounded-lg shadow-lg z-50"
		>
			<div class="p-4 space-y-4">
				<!-- Connection status -->
				<div class="flex items-center justify-between">
					<span class="text-sm text-gray-600">Connection</span>
					<div class="flex items-center gap-2 {$isOnline ? 'text-green-600' : 'text-red-600'}">
						<svelte:component this={$isOnline ? Wifi : WifiOff} class="h-4 w-4" />
						<span class="text-sm font-medium">{$isOnline ? 'Online' : 'Offline'}</span>
					</div>
				</div>

				<!-- Pending expenses -->
				{#if pendingCount > 0}
					<div class="flex items-center justify-between">
						<span class="text-sm text-gray-600">Pending sync</span>
						<div class="flex items-center gap-2">
							<Clock class="h-4 w-4 text-yellow-500" />
							<span class="text-sm font-medium">{pendingCount} expenses</span>
						</div>
					</div>
				{/if}

				<!-- Conflicts -->
				{#if hasConflicts}
					<div class="flex items-center justify-between">
						<span class="text-sm text-gray-600">Conflicts</span>
						<div class="flex items-center gap-2 text-orange-600">
							<CircleAlert class="h-4 w-4" />
							<span class="text-sm font-medium">{$syncConflicts.length} need resolution</span>
						</div>
					</div>
				{/if}

				<!-- Last sync -->
				<div class="flex items-center justify-between">
					<span class="text-sm text-gray-600">Last sync</span>
					<span class="text-sm font-medium text-gray-900">
						{formatLastSync($lastSyncTime)}
					</span>
				</div>

				<!-- Sync button -->
				{#if $isOnline && pendingCount > 0}
					<button
						on:click={handleManualSync}
						disabled={$syncStatus === 'syncing'}
						class="w-full bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2"
					>
						<RefreshCw class="h-4 w-4 {$syncStatus === 'syncing' ? 'animate-spin' : ''}" />
						{$syncStatus === 'syncing' ? 'Syncing...' : 'Sync Now'}
					</button>
				{/if}

				<!-- Status message -->
				{#if $syncStatus === 'error'}
					<div class="text-sm text-red-600 bg-red-50 p-2 rounded">
						Sync failed. Check your connection and try again.
					</div>
				{:else if $syncStatus === 'success'}
					<div class="text-sm text-green-600 bg-green-50 p-2 rounded">
						All expenses synced successfully.
					</div>
				{:else if !$isOnline}
					<div class="text-sm text-orange-600 bg-orange-50 p-2 rounded">
						You're offline. Expenses will sync when connection is restored.
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>

<!-- Click outside to close -->
{#if showDetails}
	<button
		class="fixed inset-0 z-40"
		on:click={() => (showDetails = false)}
		aria-label="Close sync status details"
	></button>
{/if}
