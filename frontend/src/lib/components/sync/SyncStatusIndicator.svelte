<script lang="ts">
	import { onMount } from 'svelte';
	import { syncState, onlineStatus, offlineExpenseQueue } from '$lib/stores/offline.svelte';
	import {
		syncManager,
		lastBackupTime,
		lastSheetsSync,
		lastDataChangeTime,
		backupEnabled,
		sheetsSyncEnabled,
		syncConflicts,
		fetchLastSyncTime
	} from '$lib/utils/sync-manager';
	import { Wifi, WifiOff, RefreshCw, CircleAlert, Clock } from '@lucide/svelte';
	import { Popover, PopoverContent, PopoverTrigger } from '$lib/components/ui/popover';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { formatCompactRelativeTime } from '$lib/utils/formatters';
	import { getSyncStatusInfo } from '$lib/utils/sync-status';

	let open = $state(false);

	let pendingCount = $derived(
		offlineExpenseQueue.current.filter(expense => !expense.synced).length
	);

	let statusInfo = $derived(
		getSyncStatusInfo({
			isOnline: onlineStatus.current,
			syncStatus: syncState.current,
			pendingCount,
			conflictsCount: syncConflicts.current.length
		})
	);

	onMount(() => {
		syncManager.setupAutoSync();

		const interval = setInterval(() => {
			if (onlineStatus.current) {
				fetchLastSyncTime();
			}
		}, 60000);

		return () => clearInterval(interval);
	});

	async function handleManualSync() {
		if (onlineStatus.current && pendingCount > 0) {
			try {
				await syncManager.syncAll();
			} catch (error) {
				if (import.meta.env.DEV) console.error('Manual sync failed:', error);
			}
		}
	}

	function handleSyncClick() {
		handleManualSync();
		open = false;
	}
</script>

<Popover bind:open>
	<PopoverTrigger>
		{#snippet child({ props })}
			{@const StatusIcon = statusInfo.icon}
			<button
				{...props}
				class="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-accent transition-colors {statusInfo.color}"
			>
				<StatusIcon class="h-4 w-4 {syncState.current === 'syncing' ? 'animate-spin' : ''}" />
				<span class="text-sm font-medium">{statusInfo.text}</span>
			</button>
		{/snippet}
	</PopoverTrigger>

	<PopoverContent align="end" class="w-80">
		<div class="space-y-4">
			<!-- Connection status -->
			<div class="flex items-center justify-between">
				<span class="text-sm text-muted-foreground">Connection</span>
				{#if onlineStatus.current}
					<Badge variant="default" class="gap-1">
						<Wifi class="h-3 w-3" />
						Online
					</Badge>
				{:else}
					<Badge variant="destructive" class="gap-1">
						<WifiOff class="h-3 w-3" />
						Offline
					</Badge>
				{/if}
			</div>

			<!-- Pending expenses -->
			{#if pendingCount > 0}
				<div class="flex items-center justify-between">
					<span class="text-sm text-muted-foreground">Pending sync</span>
					<div class="flex items-center gap-2">
						<Clock class="h-4 w-4 text-chart-5" />
						<span class="text-sm font-medium">{pendingCount} expenses</span>
					</div>
				</div>
			{/if}

			<!-- Conflicts -->
			{#if syncConflicts.current.length > 0}
				<div class="flex items-center justify-between">
					<span class="text-sm text-muted-foreground">Conflicts</span>
					<div class="flex items-center gap-2 text-destructive">
						<CircleAlert class="h-4 w-4" />
						<span class="text-sm font-medium">{syncConflicts.current.length} need resolution</span>
					</div>
				</div>
			{/if}

			<!-- Last backup -->
			{#if backupEnabled.current || sheetsSyncEnabled.current}
				<div class="flex items-center justify-between">
					<span class="text-sm text-muted-foreground">Last backup</span>
					<span class="text-sm font-medium">
						{formatCompactRelativeTime(lastBackupTime.current ?? lastSheetsSync.current)}
					</span>
				</div>
			{/if}

			<!-- Last change -->
			{#if lastDataChangeTime.current}
				<div class="flex items-center justify-between">
					<span class="text-sm text-muted-foreground">Last change</span>
					<span class="text-sm font-medium">
						{formatCompactRelativeTime(lastDataChangeTime.current)}
					</span>
				</div>
			{/if}

			<!-- Sync button -->
			{#if onlineStatus.current && pendingCount > 0}
				<Button onclick={handleSyncClick} disabled={syncState.current === 'syncing'} class="w-full">
					<RefreshCw class="h-4 w-4 mr-2 {syncState.current === 'syncing' ? 'animate-spin' : ''}" />
					{syncState.current === 'syncing' ? 'Syncing...' : 'Sync Now'}
				</Button>
			{/if}

			<!-- Status message -->
			{#if syncState.current === 'error'}
				<div class="text-sm text-destructive bg-destructive/10 p-2 rounded">
					Sync failed. Check your connection and try again.
				</div>
			{:else if syncState.current === 'success'}
				<div class="text-sm text-chart-2 bg-chart-2/10 p-2 rounded">
					All expenses synced successfully.
				</div>
			{:else if !onlineStatus.current}
				<div class="text-sm text-chart-5 bg-chart-5/10 p-2 rounded">
					You're offline. Expenses will sync when connection is restored.
				</div>
			{/if}
		</div>
	</PopoverContent>
</Popover>
