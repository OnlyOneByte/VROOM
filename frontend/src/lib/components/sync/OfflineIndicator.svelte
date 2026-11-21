<script lang="ts">
	import { onlineStatus, syncState, offlineExpenseQueue } from '#lib/stores/offline.svelte.ts';
	import { authStore } from '#lib/stores/auth.svelte.ts';
	import { syncManager } from '#lib/utils/sync/sync-manager.ts';
	import { handleErrorWithNotification } from '#lib/utils/error-handling.ts';
	import { countPendingSync } from '#lib/utils/sync/pending-expenses.ts';
	import { Wifi, WifiOff, RefreshCw, CircleCheck, CircleAlert, ServerOff } from '@lucide/svelte';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';

	let pendingCount = $derived(countPendingSync(offlineExpenseQueue.current));
	let recheckingSession = $state(false);

	async function recheckSession() {
		recheckingSession = true;
		try {
			await authStore.initialize();
		} finally {
			recheckingSession = false;
		}
	}

	$effect(() => {
		if (onlineStatus.current && authStore.sessionUnverified) void recheckSession();
	});

	async function handleSync() {
		if (!onlineStatus.current || pendingCount === 0) return;
		try {
			await syncManager.syncAll();
		} catch (error) {
			handleErrorWithNotification(error, 'Sync failed');
		}
	}
</script>

<div class="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 sm:bottom-4">
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
	{:else if authStore.sessionUnverified}
		<Badge variant="outline" class="px-3 py-2 shadow-lg text-sm gap-2 bg-background">
			<ServerOff size={16} />
			<span class="font-medium">Can't reach VROOM</span>
			<Button
				variant="secondary"
				size="sm"
				onclick={recheckSession}
				disabled={recheckingSession}
				class="h-auto px-2 py-1 text-xs gap-1"
			>
				<RefreshCw size={12} class={recheckingSession ? 'animate-spin' : ''} />
				Retry
			</Button>
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
