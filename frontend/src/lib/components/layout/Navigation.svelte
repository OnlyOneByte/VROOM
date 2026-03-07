<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { authStore } from '$lib/stores/auth.svelte';
	import { routes } from '$lib/routes';
	import {
		House,
		Receipt,
		Shield,
		ChartColumn,
		Settings,
		Menu,
		LogOut,
		MapPin
	} from '@lucide/svelte';
	import SyncStatusInline from '../sync/SyncStatusInline.svelte';
	import { syncState, onlineStatus, offlineExpenseQueue } from '$lib/stores/offline.svelte';
	import { syncConflicts } from '$lib/utils/sync-manager';
	import { getSyncStatusInfo } from '$lib/utils/sync-status';
	import { Badge } from '$lib/components/ui/badge';
	import {
		Sheet,
		SheetContent,
		SheetHeader,
		SheetTitle,
		SheetTrigger
	} from '$lib/components/ui/sheet';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import { cn } from '$lib/utils';

	let mobileMenuOpen = $state(false);

	// Use page rune from $app/state
	let currentPath = $derived(page.url.pathname);

	const navigation = [
		{ name: 'Dashboard', href: routes.dashboard, icon: House },
		{ name: 'Expenses', href: routes.expenses, icon: Receipt },
		{ name: 'Insurance', href: routes.insurance, icon: Shield },
		{ name: 'Analytics', href: routes.analytics, icon: ChartColumn },
		{ name: 'Trips', href: routes.trips, icon: MapPin }
	] as const;

	const userNavigation = [{ name: 'Settings', href: routes.settings, icon: Settings }] as const;

	function isActive(href: string): boolean {
		if (href === routes.dashboard) {
			return currentPath === '/' || currentPath === routes.dashboard;
		}
		return currentPath.startsWith(href);
	}

	function handleLogout() {
		authStore.logout();
		mobileMenuOpen = false;
	}

	function closeMobileMenu() {
		mobileMenuOpen = false;
	}

	// Desktop sidebar hover state
	let isDesktopSidebarExpanded = $state(false);

	// Mobile sync status helpers
	let pendingCount = $derived(
		offlineExpenseQueue.current.filter(expense => !expense.synced).length
	);

	let syncStatusInfo = $derived(
		getSyncStatusInfo({
			isOnline: onlineStatus.current,
			syncStatus: syncState.current,
			pendingCount,
			conflictsCount: syncConflicts.current.length
		})
	);
</script>

<!-- Mobile menu button -->
<div
	class="lg:hidden fixed top-0 left-0 right-0 z-40 bg-background border-b border-border pt-[env(safe-area-inset-top)]"
>
	<div class="flex items-center justify-between px-4 py-3">
		<div class="flex items-center gap-3">
			<span class="text-2xl">🚗</span>
			<span class="font-bold text-foreground">VROOM</span>
		</div>

		<div class="flex items-center gap-3">
			<!-- Mobile sync status icon -->
			{#snippet mobileStatusIcon()}
				{@const StatusIcon = syncStatusInfo.icon}
				<div class="{syncStatusInfo.color} relative" role="status" aria-label="Sync status">
					<StatusIcon class="h-5 w-5 {syncState.current === 'syncing' ? 'animate-spin' : ''}" />
					{#if pendingCount > 0}
						<Badge
							variant="secondary"
							class="absolute -top-1 -right-1 text-[10px] font-bold h-3.5 w-3.5 p-0 flex items-center justify-center"
							aria-label="{pendingCount} pending items"
						>
							{pendingCount > 9 ? '9+' : pendingCount}
						</Badge>
					{/if}
				</div>
			{/snippet}
			{@render mobileStatusIcon()}

			<Sheet bind:open={mobileMenuOpen}>
				<SheetTrigger
					class="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring"
					aria-label="Open navigation menu"
				>
					<Menu class="h-6 w-6" />
				</SheetTrigger>
				<SheetContent side="left" class="w-64 p-0 flex flex-col">
					<SheetHeader class="px-6 pt-6 pb-4 border-b border-border">
						<SheetTitle>
							<div class="flex items-center">
								<span class="text-2xl">🚗</span>
								<span class="ml-3 text-xl font-bold text-foreground">VROOM</span>
							</div>
						</SheetTitle>
					</SheetHeader>

					<!-- Mobile Navigation -->
					<ScrollArea class="flex-1 px-3 mt-8">
						<nav class="space-y-1">
							{#each navigation as item (item.href)}
								{@const IconComponent = item.icon}
								<a
									href={resolve(item.href)}
									class={cn(
										'group flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors duration-200',
										isActive(item.href)
											? 'bg-primary/10 text-primary'
											: 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
									)}
									onclick={closeMobileMenu}
								>
									<IconComponent
										class={cn(
											'mr-3 h-5 w-5 flex-shrink-0',
											isActive(item.href) ? 'text-primary' : 'text-muted-foreground'
										)}
									/>
									{item.name}
								</a>
							{/each}
						</nav>
					</ScrollArea>

					<!-- Mobile User menu -->
					<div class="flex-shrink-0 px-3 pb-4">
						<div class="space-y-1">
							{#each userNavigation as item (item.href)}
								{@const IconComponent = item.icon}
								<a
									href={resolve(item.href)}
									class={cn(
										'group flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors duration-200',
										isActive(item.href)
											? 'bg-primary/10 text-primary'
											: 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
									)}
									onclick={closeMobileMenu}
								>
									<IconComponent
										class={cn(
											'mr-3 h-5 w-5 flex-shrink-0',
											isActive(item.href) ? 'text-primary' : 'text-muted-foreground'
										)}
									/>
									{item.name}
								</a>
							{/each}
						</div>

						<button
							type="button"
							class="w-full flex items-center px-3 py-2 text-sm font-medium text-muted-foreground rounded-md hover:bg-accent hover:text-accent-foreground transition-colors duration-200 mt-2"
							onclick={handleLogout}
						>
							<LogOut class="mr-3 h-5 w-5 text-muted-foreground" />
							Sign out
						</button>
					</div>

					<!-- Mobile Sync Status -->
					<div class="flex-shrink-0 px-3 pb-4 border-t border-border pt-3">
						<SyncStatusInline isExpanded={true} />
					</div>
				</SheetContent>
			</Sheet>
		</div>
	</div>
</div>

<!-- Desktop Sidebar -->
<div
	class={cn(
		'hidden lg:fixed lg:inset-y-0 lg:flex lg:flex-col z-40',
		'transition-all duration-300 ease-in-out',
		isDesktopSidebarExpanded ? 'lg:w-64' : 'lg:w-20'
	)}
	onmouseenter={() => (isDesktopSidebarExpanded = true)}
	onmouseleave={() => (isDesktopSidebarExpanded = false)}
	role="navigation"
>
	<div
		class={cn(
			'flex flex-col flex-grow overflow-y-auto',
			'bg-background border-r border-border',
			'pt-5 pb-4'
		)}
	>
		<!-- Logo -->
		<div class={cn('flex items-center flex-shrink-0 px-6', 'transition-all duration-300')}>
			<div class="flex items-center">
				<span class="text-2xl">🚗</span>
				{#if isDesktopSidebarExpanded}
					<span class={cn('ml-3 text-xl font-bold whitespace-nowrap', 'text-foreground')}
						>VROOM</span
					>
				{/if}
			</div>
		</div>

		<!-- Navigation -->
		<nav class={cn('mt-8 flex-1 px-3 space-y-1')}>
			{#each navigation as item (item.href)}
				{@const IconComponent = item.icon}
				<a
					href={resolve(item.href)}
					class={cn(
						'group flex items-center px-3 py-2 text-sm font-medium rounded-md',
						'transition-colors duration-200',
						'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
						isActive(item.href)
							? 'bg-primary/10 text-primary'
							: 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
						!isDesktopSidebarExpanded && 'justify-center'
					)}
					title={!isDesktopSidebarExpanded ? item.name : ''}
				>
					<IconComponent
						class={cn(
							'h-5 w-5 flex-shrink-0',
							isActive(item.href) ? 'text-primary' : 'text-muted-foreground',
							isDesktopSidebarExpanded && 'mr-3'
						)}
					/>
					{#if isDesktopSidebarExpanded}
						<span class="whitespace-nowrap">{item.name}</span>
					{/if}
				</a>
			{/each}
		</nav>

		<!-- Desktop User menu -->
		<div class={cn('flex-shrink-0 px-3 pb-3')}>
			<!-- User Navigation -->
			<div class="space-y-1">
				{#each userNavigation as item (item.href)}
					{@const IconComponent = item.icon}
					<a
						href={resolve(item.href)}
						class={cn(
							'group flex items-center px-3 py-2 text-sm font-medium rounded-md',
							'transition-colors duration-200',
							'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
							isActive(item.href)
								? 'bg-primary/10 text-primary'
								: 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
							!isDesktopSidebarExpanded && 'justify-center'
						)}
						title={!isDesktopSidebarExpanded ? item.name : ''}
					>
						<IconComponent
							class={cn(
								'h-5 w-5 flex-shrink-0',
								isActive(item.href) ? 'text-primary' : 'text-muted-foreground',
								isDesktopSidebarExpanded && 'mr-3'
							)}
						/>
						{#if isDesktopSidebarExpanded}
							<span class="whitespace-nowrap">{item.name}</span>
						{/if}
					</a>
				{/each}
			</div>

			<button
				type="button"
				class={cn(
					'w-full flex items-center px-3 py-2 text-sm font-medium rounded-md',
					'transition-colors duration-200 mt-2',
					'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
					'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
					!isDesktopSidebarExpanded && 'justify-center'
				)}
				onclick={handleLogout}
				title={!isDesktopSidebarExpanded ? 'Sign out' : ''}
			>
				<LogOut class={cn('h-5 w-5 text-muted-foreground', isDesktopSidebarExpanded && 'mr-3')} />
				{#if isDesktopSidebarExpanded}
					<span class="whitespace-nowrap">Sign out</span>
				{/if}
			</button>
		</div>

		<!-- Sync Status -->
		<div class={cn('flex-shrink-0 px-3 pb-4')}>
			<SyncStatusInline isExpanded={isDesktopSidebarExpanded} />
		</div>
	</div>
</div>

<!-- Mobile content padding — accounts for fixed top bar + safe area -->
<div class="lg:hidden h-16 pt-[env(safe-area-inset-top)]"></div>
