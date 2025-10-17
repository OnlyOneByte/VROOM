<script lang="ts">
	import { page } from '$app/state';
	import { authStore } from '$lib/stores/auth.js';
	import { House, Receipt, ChartColumn, Settings, Menu, LogOut, User, MapPin } from 'lucide-svelte';
	import SyncStatusInline from './SyncStatusInline.svelte';
	import { syncStatus, isOnline, offlineExpenses } from '$lib/stores/offline';
	import { syncConflicts } from '$lib/utils/sync-manager';
	import { Wifi, WifiOff, RefreshCw, CircleAlert, Clock } from 'lucide-svelte';
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
		{ name: 'Dashboard', href: '/vehicles', icon: House },
		{ name: 'Expenses', href: '/expenses', icon: Receipt },
		{ name: 'Analytics', href: '/analytics', icon: ChartColumn },
		{ name: 'Trips', href: '/trips', icon: MapPin }
	];

	const userNavigation = [
		{ name: 'Profile', href: '/profile', icon: User },
		{ name: 'Settings', href: '/settings', icon: Settings }
	];

	function isActive(href: string): boolean {
		if (href === '/vehicles') {
			return currentPath === '/' || currentPath === '/vehicles';
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
	let pendingCount = $derived($offlineExpenses.filter(expense => !expense.synced).length);
	let hasConflicts = $derived($syncConflicts.length > 0);

	function getSyncStatusInfo() {
		if (!$isOnline) return { color: 'text-red-500', icon: WifiOff };
		if (hasConflicts) return { color: 'text-orange-500', icon: CircleAlert };
		if ($syncStatus === 'syncing') return { color: 'text-yellow-500', icon: RefreshCw };
		if ($syncStatus === 'error') return { color: 'text-red-500', icon: CircleAlert };
		if (pendingCount > 0) return { color: 'text-yellow-500', icon: Clock };
		return { color: 'text-green-500', icon: Wifi };
	}
</script>

<!-- Mobile menu button -->
<div class="lg:hidden fixed top-0 left-0 right-0 z-40 bg-white border-b border-gray-200">
	<div class="flex items-center justify-between px-4 py-3">
		<div class="flex items-center gap-3">
			<span class="text-2xl">🚗</span>
			<span class="font-bold text-gray-900">VROOM</span>
		</div>

		<div class="flex items-center gap-3">
			<!-- Mobile sync status icon -->
			{#snippet mobileStatusIcon()}
				{@const statusInfo = getSyncStatusInfo()}
				{@const StatusIcon = statusInfo.icon}
				<div class="{statusInfo.color} relative">
					<StatusIcon class="h-5 w-5 {$syncStatus === 'syncing' ? 'animate-spin' : ''}" />
					{#if pendingCount > 0}
						<Badge
							variant="secondary"
							class="absolute -top-1 -right-1 bg-yellow-500 text-white text-[10px] font-bold h-3.5 w-3.5 p-0 flex items-center justify-center border-transparent"
						>
							{pendingCount > 9 ? '9+' : pendingCount}
						</Badge>
					{/if}
				</div>
			{/snippet}
			{@render mobileStatusIcon()}

			<Sheet bind:open={mobileMenuOpen}>
				<SheetTrigger
					class="p-2 rounded-md text-gray-600 hover:text-gray-900 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
				>
					<Menu class="h-6 w-6" />
				</SheetTrigger>
				<SheetContent side="left" class="w-64 p-0 flex flex-col">
					<SheetHeader class="px-6 pt-6 pb-4 border-b border-gray-200">
						<SheetTitle>
							<div class="flex items-center">
								<span class="text-2xl">🚗</span>
								<span class="ml-3 text-xl font-bold text-gray-900">VROOM</span>
							</div>
						</SheetTitle>
					</SheetHeader>

					<!-- Mobile Navigation -->
					<ScrollArea class="flex-1 px-3 mt-8">
						<nav class="space-y-1">
							{#each navigation as item (item.href)}
								{@const IconComponent = item.icon}
								<a
									href={item.href}
									class="group flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors duration-200 {isActive(
										item.href
									)
										? 'bg-primary-100 text-primary-700'
										: 'text-gray-700 hover:bg-gray-100'}"
									onclick={closeMobileMenu}
								>
									<IconComponent
										class="mr-3 h-5 w-5 flex-shrink-0 {isActive(item.href)
											? 'text-primary-600'
											: 'text-gray-500'}"
									/>
									{item.name}
								</a>
							{/each}
						</nav>
					</ScrollArea>

					<!-- Mobile User menu -->
					<div class="flex-shrink-0 px-3 pb-4">
						<!-- Mobile User Navigation -->
						<div class="space-y-1">
							{#each userNavigation as item (item.href)}
								{@const IconComponent = item.icon}
								<a
									href={item.href}
									class="group flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors duration-200 {isActive(
										item.href
									)
										? 'bg-primary-100 text-primary-700'
										: 'text-gray-700 hover:bg-gray-100'}"
									onclick={closeMobileMenu}
								>
									<IconComponent
										class="mr-3 h-5 w-5 flex-shrink-0 {isActive(item.href)
											? 'text-primary-600'
											: 'text-gray-500'}"
									/>
									{item.name}
								</a>
							{/each}
						</div>

						<button
							type="button"
							class="w-full flex items-center px-3 py-2 text-sm font-medium text-gray-700 rounded-md hover:bg-gray-100 transition-colors duration-200 mt-2"
							onclick={handleLogout}
						>
							<LogOut class="mr-3 h-5 w-5 text-gray-500" />
							Sign out
						</button>
					</div>

					<!-- Mobile Sync Status -->
					<div class="flex-shrink-0 px-3 pb-4">
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
					href={item.href}
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
						href={item.href}
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

<!-- Mobile content padding -->
<div class="lg:hidden h-16"></div>
