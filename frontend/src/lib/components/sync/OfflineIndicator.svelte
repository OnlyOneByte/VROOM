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

<div
	class="fixed top-[calc(0.75rem+env(safe-area-inset-top))] right-[5.75rem] z-50 lg:top-4 lg:right-4"
>
	{#if !onlineStatus.current}
		<Badge
			variant="destructive"
			class="px-2 py-2 shadow-lg text-xs gap-1 lg:px-3 lg:text-sm lg:gap-2"
		>
			<WifiOff size={16} class="hidden lg:block" />
			<span class="font-medium" class:max-[359px]:sr-only={pendingCount > 0}>Offline</span>
			{#if pendingCount > 0}
				<Badge variant="destructive" class="text-xs px-2 py-1">
					{pendingCount} pending
				</Badge>
			{/if}
		</Badge>
	{:else if authStore.sessionUnverified}
		<Badge
			variant="outline"
			role="status"
			class="py-0 pl-2 pr-0 shadow-lg text-xs gap-1 bg-background lg:px-3 lg:py-2 lg:text-sm lg:gap-2"
		>
			<ServerOff size={16} class="hidden lg:block" />
			<span class="font-medium max-[359px]:sr-only"
				>Can't reach <span class="sr-only lg:not-sr-only">VROOM</span></span
			>
			<Button
				variant="ghost"
				size="icon-lg"
				onclick={recheckSession}
				disabled={recheckingSession}
				class="lg:h-auto lg:w-auto lg:px-2 lg:py-1 lg:text-xs lg:gap-1"
			>
				<RefreshCw size={14} class={recheckingSession ? 'animate-spin' : ''} />
				<span class="sr-only lg:not-sr-only">Retry</span>
			</Button>
		</Badge>
	{:else if syncState.current === 'syncing'}
		<Badge
			variant="secondary"
			class="px-2 py-2 shadow-lg text-xs gap-1 bg-primary text-primary-foreground border-transparent lg:px-3 lg:text-sm lg:gap-2"
		>
			<RefreshCw size={16} class="animate-spin" />
			<span class="font-medium">Syncing...</span>
		</Badge>
	{:else if syncState.current === 'success'}
		<Badge
			variant="default"
			class="px-2 py-2 shadow-lg text-xs gap-1 border-transparent lg:px-3 lg:text-sm lg:gap-2"
		>
			<CircleCheck size={16} />
			<span class="font-medium">Synced</span>
		</Badge>
	{:else if syncState.current === 'error'}
		<Badge
			variant="destructive"
			class="py-0 pl-2 pr-0 shadow-lg text-xs gap-1 lg:px-3 lg:py-2 lg:text-sm lg:gap-2"
		>
			<CircleAlert size={16} class="hidden lg:block" />
			<span class="font-medium max-[359px]:sr-only">Sync failed</span>
			<Button
				variant="destructive"
				size="icon-lg"
				onclick={handleSync}
				class="lg:h-auto lg:w-auto lg:px-2 lg:py-1 lg:text-xs"
			>
				<RefreshCw size={14} class="lg:hidden" />
				<span class="sr-only lg:not-sr-only">Retry</span>
			</Button>
		</Badge>
	{:else if pendingCount > 0}
		<Badge variant="outline" class="p-0 shadow-lg text-sm gap-2 bg-background lg:px-3 lg:py-2">
			<Wifi size={16} class="hidden lg:block" />
			<span class="font-medium hidden lg:inline">Online</span>
			<Button
				variant="secondary"
				size="sm"
				onclick={handleSync}
				class="h-10 px-3 text-xs gap-1 lg:h-auto lg:px-2 lg:py-1"
			>
				<RefreshCw size={12} />
				Sync {pendingCount}
			</Button>
		</Badge>
	{/if}
</div>
