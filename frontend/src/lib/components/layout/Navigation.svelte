<script lang="ts">
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import { resolve } from '$app/paths';
	import { Dialog as DialogPrimitive } from 'bits-ui';
	import { authStore } from '#lib/stores/auth.svelte.ts';
	import { routes, isFormRoute } from '#lib/routes.ts';
	import {
		House,
		List,
		Car,
		ChartColumn,
		Bell,
		Shield,
		MapPin,
		Bot,
		Settings,
		User,
		Ellipsis,
		ChevronDown,
		ChevronRight,
		Plus,
		LogOut
	} from '@lucide/svelte';
	import SyncStatusInline from '../sync/SyncStatusInline.svelte';
	import OfflineIndicator from '../sync/OfflineIndicator.svelte';
	import { syncState, onlineStatus, offlineExpenseQueue } from '#lib/stores/offline.svelte.ts';
	import {
		syncConflicts,
		syncManager,
		fetchLastSyncTime,
		providerNeedsAttention
	} from '#lib/utils/sync/sync-manager.ts';
	import { getSyncStatusInfo } from '#lib/utils/sync/sync-status.ts';
	import { countPendingSync } from '#lib/utils/sync/pending-expenses.ts';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import { Sheet, SheetContent, SheetHeader, SheetTitle } from '#lib/components/ui/sheet/index.ts';
	import { cn } from '#lib/utils.ts';
	import { handleErrorWithNotification } from '#lib/utils/error-handling.ts';

	const wide = new MediaQuery('min-width: 64rem');
	let moreOpen = $state(false);
	let syncOpen = $state(false);

	onMount(() => {
		syncManager.setupAutoSync();

		const interval = setInterval(() => {
			if (onlineStatus.current) {
				fetchLastSyncTime();
			}
		}, 30000);

		return () => clearInterval(interval);
	});

	let currentPath = $derived(page.url.pathname);

	const home = { name: 'Home', href: routes.dashboard, icon: House } as const;
	const log = { name: 'Log', href: routes.expenses, icon: List } as const;
	const garage = { name: 'Garage', href: '/vehicles', icon: Car } as const;
	const explore = { name: 'Explore', href: routes.analytics, icon: ChartColumn } as const;
	const reminders = { name: 'Reminders', href: routes.reminders, icon: Bell } as const;
	const primary = [home, log, garage, explore, reminders] as const;

	const more = [
		{ name: 'Insurance', href: routes.insurance, icon: Shield },
		{ name: 'Trips', href: routes.trips, icon: MapPin },
		{ name: 'Assistant', href: routes.assistant, icon: Bot },
		{ name: 'Settings', href: routes.settings, icon: Settings },
		{ name: 'Profile', href: routes.profile, icon: User }
	] as const;

	const sheetItems = [explore, reminders, ...more];

	function isActive(href: string): boolean {
		if (href === routes.dashboard) {
			return currentPath === '/' || currentPath === routes.dashboard;
		}
		return currentPath.startsWith(href);
	}

	let moreActive = $derived(more.some(item => isActive(item.href)));
	let sheetActive = $derived(sheetItems.some(item => isActive(item.href)));
	let showBottomBar = $derived(!isFormRoute(currentPath));

	async function handleLogout() {
		moreOpen = false;
		try {
			await authStore.logout();
		} catch (error) {
			handleErrorWithNotification(error, "Couldn't sign out");
		}
	}

	let pendingCount = $derived(countPendingSync(offlineExpenseQueue.current));

	let syncStatusInfo = $derived(
		getSyncStatusInfo({
			isOnline: onlineStatus.current,
			syncStatus: syncState.current,
			pendingCount,
			conflictsCount: syncConflicts.current.length,
			serverReachable: !authStore.sessionUnverified,
			providerNeedsAttention: providerNeedsAttention.current
		})
	);

	let announcedStatus = $derived(
		getSyncStatusInfo({
			isOnline: onlineStatus.current,
			syncStatus: 'idle',
			pendingCount: 0,
			conflictsCount: syncConflicts.current.length,
			serverReachable: !authStore.sessionUnverified,
			providerNeedsAttention: providerNeedsAttention.current
		}).text
	);

	let initials = $derived(
		(authStore.user?.displayName ?? authStore.user?.email ?? '')
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map(part => part[0]?.toUpperCase())
			.join('')
	);

	const panelClass =
		'absolute right-0 top-full z-50 mt-2 w-72 rounded-[var(--r-lg)] border border-border bg-popover p-2 text-popover-foreground shadow-[var(--shadow-pop)] outline-none';
</script>

{#snippet wordmark()}
	<a
		href={resolve(routes.dashboard)}
		class="justify-self-start rounded-md font-(family-name:--font-fig) text-[22px] font-bold tracking-[0.3em] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
		aria-label="VROOM home"
	>
		VR<span class="text-accent-ink">O</span>OM
	</a>
{/snippet}

{#snippet syncStatus()}
	{@const StatusIcon = syncStatusInfo.icon}
	<div class="relative">
		<span class="sr-only" role="status" aria-live="off">{syncStatusInfo.text}</span>
		<span class="sr-only" aria-live="polite" data-testid="sync-status-announcement">
			{announcedStatus}
		</span>
		<DialogPrimitive.Root bind:open={syncOpen}>
			<DialogPrimitive.Trigger
				class="inline-flex min-h-10 items-center gap-1.5 rounded-full px-2 text-[13px] font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				aria-label="Sync status: {syncStatusInfo.text}"
			>
				<span class="relative {syncStatusInfo.color}">
					<StatusIcon class="h-5 w-5 {syncState.current === 'syncing' ? 'animate-spin' : ''}" />
					{#if pendingCount > 0}
						<Badge
							variant="secondary"
							class="absolute -top-2 -right-2 text-xs font-bold h-4 min-w-4 px-0.5 py-0 flex items-center justify-center"
							aria-label="{pendingCount} pending items"
						>
							{pendingCount > 9 ? '9+' : pendingCount}
						</Badge>
					{/if}
				</span>
				<span class="hidden lg:inline" aria-hidden="true">{syncStatusInfo.text}</span>
			</DialogPrimitive.Trigger>
			<DialogPrimitive.Content class={panelClass} trapFocus preventScroll={false}>
				<DialogPrimitive.Title class="sr-only">Sync status</DialogPrimitive.Title>
				<SyncStatusInline />
			</DialogPrimitive.Content>
		</DialogPrimitive.Root>
	</div>
{/snippet}

{#snippet avatar()}
	<a
		href={resolve(routes.profile)}
		class="grid size-9 place-items-center rounded-full bg-surface text-[13px] font-semibold text-foreground ring-1 ring-inset ring-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
		aria-label="Profile"
		title="Profile"
	>
		{#if initials}
			<span aria-hidden="true">{initials}</span>
		{:else}
			<User class="h-4 w-4" aria-hidden="true" />
		{/if}
	</a>
{/snippet}

{#snippet signOut(className: string)}
	<button type="button" class={className} onclick={handleLogout}>
		<LogOut class="h-5 w-5 text-muted-foreground" aria-hidden="true" />
		Sign out
	</button>
{/snippet}

{#if wide.current}
	<header class="grid grid-cols-[1fr_auto_1fr] items-center gap-4 px-10 py-4">
		{@render wordmark()}

		<nav
			aria-label="Main"
			class="inline-flex gap-0.5 rounded-full bg-surface p-1 ring-1 ring-inset ring-border"
		>
			{#each primary as item (item.href)}
				<a
					href={resolve(item.href)}
					class={cn(
						'whitespace-nowrap rounded-full px-3.5 py-[7px] text-sm font-medium transition-colors',
						'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
						isActive(item.href)
							? 'bg-background text-foreground shadow-sm ring-1 ring-border'
							: 'text-muted-foreground hover:text-foreground'
					)}
					aria-current={isActive(item.href) ? 'page' : undefined}
				>
					{item.name}
				</a>
			{/each}
			<div class="relative">
				<DialogPrimitive.Root bind:open={moreOpen}>
					<DialogPrimitive.Trigger
						class={cn(
							'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-3.5 py-[7px] text-sm font-medium transition-colors',
							'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
							moreActive
								? 'bg-background text-foreground shadow-sm ring-1 ring-border'
								: 'text-muted-foreground hover:text-foreground'
						)}
					>
						More
						<ChevronDown class="h-4 w-4" aria-hidden="true" />
					</DialogPrimitive.Trigger>
					<DialogPrimitive.Content class={panelClass} trapFocus preventScroll={false}>
						<DialogPrimitive.Title class="sr-only">More</DialogPrimitive.Title>
						<ul class="space-y-0.5">
							{#each more as item (item.href)}
								{@const IconComponent = item.icon}
								<li>
									<a
										href={resolve(item.href)}
										class={cn(
											'flex items-center gap-3 rounded-[var(--r-md)] px-3 py-2 text-sm font-medium',
											'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
											isActive(item.href)
												? 'bg-sunk text-foreground'
												: 'text-muted-foreground hover:bg-sunk hover:text-foreground'
										)}
										aria-current={isActive(item.href) ? 'page' : undefined}
										onclick={() => (moreOpen = false)}
									>
										<IconComponent class="h-5 w-5" aria-hidden="true" />
										{item.name}
									</a>
								</li>
							{/each}
						</ul>
						<div class="mt-1 border-t border-border pt-1">
							{@render signOut(
								'flex w-full items-center gap-3 rounded-[var(--r-md)] px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-sunk hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
							)}
						</div>
					</DialogPrimitive.Content>
				</DialogPrimitive.Root>
			</div>
		</nav>

		<div class="flex items-center justify-self-end gap-2.5">
			<OfflineIndicator floating={false} />
			{@render syncStatus()}
			<a
				href={resolve(routes.expenseNew)}
				class="inline-flex min-h-10 items-center gap-2 whitespace-nowrap rounded-full bg-accent-fill py-0 pl-1.5 pr-4 text-sm font-semibold text-accent-fill-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
			>
				<span class="grid size-7 place-items-center rounded-full bg-accent-fill-foreground/15" aria-hidden="true">
					<Plus class="h-4 w-4" />
				</span>
				Add expense
			</a>
			{@render avatar()}
		</div>
	</header>
{:else}
	<header
		class="fixed short:static top-0 left-0 right-0 z-40 bg-background border-b border-border pt-[env(safe-area-inset-top)]"
	>
		<div class="flex items-center justify-between px-4 py-3">
			{@render wordmark()}
			<div class="flex items-center gap-2">
				<OfflineIndicator floating={false} />
				{@render syncStatus()}
				{@render avatar()}
			</div>
		</div>
	</header>
	<div class="short:hidden h-16 pt-[env(safe-area-inset-top)]"></div>

	{#if showBottomBar}
		<nav
			aria-label="Main"
			class="fixed short:static bottom-0 left-0 right-0 z-40 grid grid-cols-5 items-end bg-bar px-1.5 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-bar-fg"
		>
			{#snippet tab(item: typeof home | typeof log | typeof garage)}
				{@const IconComponent = item.icon}
				<a
					href={resolve(item.href)}
					class={cn(
						'flex min-h-12 flex-col items-center justify-end gap-0.5 rounded-md font-(family-name:--font-fig) text-xs font-bold uppercase tracking-[0.12em]',
						'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bar-on',
						isActive(item.href) && 'text-bar-on'
					)}
					aria-current={isActive(item.href) ? 'page' : undefined}
				>
					<IconComponent class="h-[22px] w-[22px]" aria-hidden="true" />
					{item.name}
				</a>
			{/snippet}
			{@render tab(home)}
			{@render tab(log)}
			<a
				href={resolve(routes.expenseNew)}
				class="group flex min-h-12 flex-col items-center justify-end gap-0.5 rounded-md font-(family-name:--font-fig) text-xs font-bold uppercase tracking-[0.12em] focus-visible:outline-none"
				aria-label="Add expense"
			>
				<span
					class="-mt-[26px] grid size-[58px] place-items-center short:mt-0 short:size-11 rounded-full bg-accent-fill text-accent-fill-foreground shadow-[0_0_0_4px_var(--bar),var(--shadow-pop)] group-focus-visible:ring-2 group-focus-visible:ring-bar-on group-focus-visible:ring-offset-4 group-focus-visible:ring-offset-bar"
					aria-hidden="true"
				>
					<Plus class="h-[26px] w-[26px]" />
				</span>
				<span aria-hidden="true">Add</span>
			</a>
			{@render tab(garage)}
			<button
				type="button"
				class={cn(
					'flex min-h-12 flex-col items-center justify-end gap-0.5 rounded-md font-(family-name:--font-fig) text-xs font-bold uppercase tracking-[0.12em]',
					'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bar-on',
					sheetActive && 'text-bar-on'
				)}
				aria-haspopup="dialog"
				aria-expanded={moreOpen}
				onclick={() => (moreOpen = true)}
			>
				<Ellipsis class="h-[22px] w-[22px]" aria-hidden="true" />
				More
			</button>
		</nav>
	{/if}

	<Sheet bind:open={moreOpen}>
		<SheetContent
			side="bottom"
			class="max-h-[86vh] rounded-t-[var(--r-xl)] bg-surface px-4 pt-6 pb-[max(1rem,env(safe-area-inset-bottom))]"
		>
			<SheetHeader class="p-0">
				<SheetTitle
					class="font-(family-name:--font-fig) text-[30px] leading-none font-bold uppercase tracking-[0.02em]"
				>
					More
				</SheetTitle>
			</SheetHeader>
			<ul class="overflow-y-auto">
				{#each sheetItems as item (item.href)}
					{@const IconComponent = item.icon}
					<li class="border-b border-border">
						<a
							href={resolve(item.href)}
							class="flex min-h-12 items-center gap-3 rounded-md px-1 text-base font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							aria-current={isActive(item.href) ? 'page' : undefined}
							onclick={() => (moreOpen = false)}
						>
							<IconComponent class="h-5 w-5 text-muted-foreground" aria-hidden="true" />
							<span class="flex-1">{item.name}</span>
							<ChevronRight class="h-4 w-4 text-muted-foreground" aria-hidden="true" />
						</a>
					</li>
				{/each}
				<li>
					{@render signOut(
						'flex min-h-12 w-full items-center gap-3 rounded-md px-1 text-base font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
					)}
				</li>
			</ul>
		</SheetContent>
	</Sheet>
{/if}
