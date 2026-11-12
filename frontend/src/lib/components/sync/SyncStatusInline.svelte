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
	} from '$lib/utils/sync/sync-manager';
	import { RefreshCw, CircleAlert, Clock, Wifi, WifiOff, TriangleAlert } from '@lucide/svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { formatCompactRelativeTime } from '$lib/utils/formatters';
	import { getSyncStatusInfo } from '$lib/utils/sync/sync-status';
	import { countParked, countPendingSync } from '$lib/utils/sync/pending-expenses';
	import { routes } from '$lib/routes';
	import { resolve } from '$app/paths';
	import { appStore } from '$lib/stores/app.svelte';
	import { handleErrorWithNotification } from '$lib/utils/error-handling';

	let { isExpanded = true } = $props();

	let pendingCount = $derived(countPendingSync(offlineExpenseQueue.current));
	let parkedCount = $derived(countParked(offlineExpenseQueue.current));
	let parkedLinkLabel = $derived(
		parkedCount === 1
			? '1 expense needs attention — open expenses'
			: `${parkedCount} expenses need attention — open expenses`
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
		}, 30000);

		return () => clearInterval(interval);
	});

	let isRetryingParked = $state(false);

	async function handleRetryParked() {
		if (!onlineStatus.current || parkedCount === 0 || isRetryingParked) return;
		isRetryingParked = true;
		try {
			const result = await syncManager.retryParked();
			if (result.needsAttention > 0) {
				appStore.showWarning(
					result.needsAttention === 1
						? '1 expense still needs attention — open expenses to fix it'
						: `${result.needsAttention} expenses still need attention — open expenses to fix them`
				);
			} else if (result.synced > 0) {
				appStore.showSuccess(
					result.synced === 1 ? '1 expense synced' : `${result.synced} expenses synced`
				);
			}
		} catch (error) {
			handleErrorWithNotification(error, 'Retry failed');
		} finally {
			isRetryingParked = false;
		}
	}

	async function handleManualSync() {
		if (onlineStatus.current && pendingCount > 0) {
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
			<div class="flex items-center justify-between">
				{#snippet statusHeader()}
					{@const StatusIcon = statusInfo.icon}
					<div class="flex items-center gap-2 {statusInfo.color}">
						<StatusIcon class="h-4 w-4 {syncState.current === 'syncing' ? 'animate-spin' : ''}" />
						<span class="text-xs font-medium">{statusInfo.text}</span>
					</div>
				{/snippet}
				{@render statusHeader()}
			</div>

			<div class="flex items-center justify-between text-xs">
				<span class="text-muted-foreground">Connection</span>
				{#snippet connectionStatusSnippet()}
					{@const ConnectionIcon = onlineStatus.current ? Wifi : WifiOff}
					<Badge
						variant={onlineStatus.current ? 'default' : 'destructive'}
						class="text-xs px-2 py-0.5 gap-1"
					>
						<ConnectionIcon class="h-3 w-3" />
						<span>{onlineStatus.current ? 'Online' : 'Offline'}</span>
					</Badge>
				{/snippet}
				{@render connectionStatusSnippet()}
			</div>

			{#if pendingCount > 0}
				<div class="flex items-center justify-between text-xs">
					<span class="text-muted-foreground">Pending</span>
					<Badge variant="secondary" class="text-xs px-2 py-0.5 gap-1">
						<Clock class="h-3 w-3" />
						<span>{pendingCount}</span>
					</Badge>
				</div>
			{/if}

			{#if parkedCount > 0}
				<div class="flex items-center justify-between text-xs">
					<span class="text-muted-foreground">Needs attention</span>
					<a
						href={resolve(routes.expenses)}
						aria-label={parkedLinkLabel}
						class="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						<Badge variant="destructive" class="text-xs px-2 py-0.5 gap-1">
							<TriangleAlert class="h-3 w-3" />
							<span>{parkedCount}</span>
						</Badge>
					</a>
				</div>
			{/if}

			{#if syncConflicts.current.length > 0}
				<div class="flex items-center justify-between text-xs">
					<span class="text-muted-foreground">Conflicts</span>
					<Badge variant="destructive" class="text-xs px-2 py-0.5 gap-1">
						<CircleAlert class="h-3 w-3" />
						<span>{syncConflicts.current.length}</span>
					</Badge>
				</div>
			{/if}

			{#if backupEnabled.current || sheetsSyncEnabled.current}
				<div class="flex items-center justify-between text-xs">
					<span class="text-muted-foreground">Last backup</span>
					<span class="text-foreground"
						>{formatCompactRelativeTime(lastBackupTime.current ?? lastSheetsSync.current)}</span
					>
				</div>
			{/if}

			{#if lastDataChangeTime.current}
				<div class="flex items-center justify-between text-xs">
					<span class="text-muted-foreground">Last change</span>
					<span class="text-foreground"
						>{formatCompactRelativeTime(lastDataChangeTime.current)}</span
					>
				</div>
			{/if}

			{#if onlineStatus.current && parkedCount > 0}
				<Button
					size="sm"
					variant="outline"
					onclick={handleRetryParked}
					disabled={isRetryingParked || syncState.current === 'syncing'}
					aria-busy={isRetryingParked}
					class="w-full h-7 text-xs"
				>
					<RefreshCw class="h-3 w-3 mr-1.5 {isRetryingParked ? 'animate-spin' : ''}" />
					{isRetryingParked ? 'Retrying...' : `Retry ${parkedCount} needing attention`}
				</Button>
			{/if}

			{#if onlineStatus.current && pendingCount > 0}
				<Button
					size="sm"
					onclick={handleManualSync}
					disabled={syncState.current === 'syncing'}
					class="w-full h-7 text-xs"
				>
					<RefreshCw
						class="h-3 w-3 mr-1.5 {syncState.current === 'syncing' ? 'animate-spin' : ''}"
					/>
					{syncState.current === 'syncing' ? 'Syncing...' : 'Sync Now'}
				</Button>
			{/if}
		</div>
	{:else}
		{#snippet collapsedIcon()}
			{@const StatusIcon = statusInfo.icon}
			<div class="flex justify-center px-3">
				<div class="{statusInfo.color} relative" title={statusInfo.text}>
					<StatusIcon class="h-5 w-5 {syncState.current === 'syncing' ? 'animate-spin' : ''}" />
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
