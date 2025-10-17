<script lang="ts">
	import { onMount } from 'svelte';
	import { syncStatus, isOnline, offlineExpenses } from '$lib/stores/offline';
	import { syncManager, lastSyncTime, syncConflicts } from '$lib/utils/sync-manager';
	import { RefreshCw, CircleCheck, CircleAlert, Clock, Wifi, WifiOff } from 'lucide-svelte';
	import { Popover, PopoverContent, PopoverTrigger } from '$lib/components/ui/popover';

	let open = $state(false);

	let pendingCount = $derived($offlineExpenses.filter(expense => !expense.synced).length);
	let hasConflicts = $derived($syncConflicts.length > 0);

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

	function handleSyncClick() {
		handleManualSync();
		open = false;
	}

	import { formatCompactRelativeTime } from '$lib/utils/formatters';

	function getSyncStatusInfo() {
		if (!$isOnline) return { color: 'text-red-500', icon: WifiOff, text: 'Offline' };
		if (hasConflicts)
			return {
				color: 'text-orange-500',
				icon: CircleAlert,
				text: `${$syncConflicts.length} conflicts`
			};
		if ($syncStatus === 'syncing')
			return { color: 'text-blue-500', icon: RefreshCw, text: 'Syncing...' };
		if ($syncStatus === 'error')
			return { color: 'text-red-500', icon: CircleAlert, text: 'Sync failed' };
		if ($syncStatus === 'success')
			return { color: 'text-green-500', icon: CircleCheck, text: 'Synced' };
		if (pendingCount > 0)
			return { color: 'text-yellow-500', icon: Clock, text: `${pendingCount} pending` };
		return { color: 'text-gray-500', icon: Wifi, text: 'Up to date' };
	}
</script>

<Popover bind:open>
	<PopoverTrigger>
		{#snippet child({ props })}
			{@const statusInfo = getSyncStatusInfo()}
			{@const StatusIcon = statusInfo.icon}
			<button
				{...props}
				class="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors {statusInfo.color}"
			>
				<StatusIcon class="h-4 w-4 {$syncStatus === 'syncing' ? 'animate-spin' : ''}" />
				<span class="text-sm font-medium">{statusInfo.text}</span>
			</button>
		{/snippet}
	</PopoverTrigger>

	<PopoverContent align="end" class="w-80">
		<div class="space-y-4">
			<!-- Connection status -->
			<div class="flex items-center justify-between">
				<span class="text-sm text-gray-600">Connection</span>
				{#if $isOnline}
					{@const ConnectionIcon = Wifi}
					<div class="flex items-center gap-2 text-green-600">
						<ConnectionIcon class="h-4 w-4" />
						<span class="text-sm font-medium">Online</span>
					</div>
				{:else}
					{@const ConnectionIcon = WifiOff}
					<div class="flex items-center gap-2 text-red-600">
						<ConnectionIcon class="h-4 w-4" />
						<span class="text-sm font-medium">Offline</span>
					</div>
				{/if}
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
					{formatCompactRelativeTime($lastSyncTime)}
				</span>
			</div>

			<!-- Sync button -->
			{#if $isOnline && pendingCount > 0}
				<button
					onclick={handleSyncClick}
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
	</PopoverContent>
</Popover>
