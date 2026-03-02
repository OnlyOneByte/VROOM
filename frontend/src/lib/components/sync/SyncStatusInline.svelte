<script lang="ts">
	import { onMount } from 'svelte';
	import { syncStatus, isOnline, offlineExpenses } from '$lib/stores/offline';
	import {
		syncManager,
		lastBackupTime,
		lastSheetsSync,
		lastDataChangeTime,
		googleDriveBackupEnabled,
		googleSheetsSyncEnabled,
		syncConflicts,
		fetchLastSyncTime
	} from '$lib/utils/sync-manager';
	import { RefreshCw, CircleAlert, Clock, Wifi, WifiOff } from 'lucide-svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
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
				if (import.meta.env.DEV) console.error('Manual sync failed:', error);
			}
		}
	}
</script>

<div class="border-t border-border pt-3 space-y-2">
	{#if isExpanded}
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
				<span class="text-muted-foreground">Connection</span>
				{#snippet connectionStatus()}
					{@const ConnectionIcon = $isOnline ? Wifi : WifiOff}
					<Badge variant={$isOnline ? 'default' : 'destructive'} class="text-xs px-2 py-0.5 gap-1">
						<ConnectionIcon class="h-3 w-3" />
						<span>{$isOnline ? 'Online' : 'Offline'}</span>
					</Badge>
				{/snippet}
				{@render connectionStatus()}
			</div>

			<!-- Pending expenses -->
			{#if pendingCount > 0}
				<div class="flex items-center justify-between text-xs">
					<span class="text-muted-foreground">Pending</span>
					<Badge variant="secondary" class="text-xs px-2 py-0.5 gap-1">
						<Clock class="h-3 w-3" />
						<span>{pendingCount}</span>
					</Badge>
				</div>
			{/if}

			<!-- Conflicts -->
			{#if $syncConflicts.length > 0}
				<div class="flex items-center justify-between text-xs">
					<span class="text-muted-foreground">Conflicts</span>
					<Badge variant="destructive" class="text-xs px-2 py-0.5 gap-1">
						<CircleAlert class="h-3 w-3" />
						<span>{$syncConflicts.length}</span>
					</Badge>
				</div>
			{/if}

			<!-- Last backup -->
			{#if $googleDriveBackupEnabled || $googleSheetsSyncEnabled}
				<div class="flex items-center justify-between text-xs">
					<span class="text-muted-foreground">Last backup</span>
					<span class="text-foreground"
						>{formatCompactRelativeTime($lastBackupTime ?? $lastSheetsSync)}</span
					>
				</div>
			{/if}

			<!-- Last change -->
			{#if $lastDataChangeTime}
				<div class="flex items-center justify-between text-xs">
					<span class="text-muted-foreground">Last change</span>
					<span class="text-foreground">{formatCompactRelativeTime($lastDataChangeTime)}</span>
				</div>
			{/if}

			<!-- Sync button -->
			{#if $isOnline && pendingCount > 0}
				<Button
					size="sm"
					onclick={handleManualSync}
					disabled={$syncStatus === 'syncing'}
					class="w-full h-7 text-xs"
				>
					<RefreshCw class="h-3 w-3 mr-1.5 {$syncStatus === 'syncing' ? 'animate-spin' : ''}" />
					{$syncStatus === 'syncing' ? 'Syncing...' : 'Sync Now'}
				</Button>
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
							class="absolute -top-1 -right-1 text-[10px] font-bold h-3.5 w-3.5 p-0 flex items-center justify-center"
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
