<script lang="ts">
	import { page } from '$app/stores';
	import { authStore } from '$lib/stores/auth.js';
	import { appStore } from '$lib/stores/app.js';
	import type { AppState } from '$lib/types/index.js';
	import {
		House,
		Receipt,
		ChartColumn,
		Settings,
		Menu,
		X,
		LogOut,
		User,
		MapPin
	} from 'lucide-svelte';
	import SyncStatusInline from './SyncStatusInline.svelte';
	import { syncStatus, isOnline, offlineExpenses } from '$lib/stores/offline';
	import { syncConflicts } from '$lib/utils/sync-manager';
	import { Wifi, WifiOff, RefreshCw, CircleAlert, Clock } from 'lucide-svelte';

	let appState = $state<AppState>({
		vehicles: [],
		selectedVehicle: null,
		notifications: [],
		isLoading: false,
		isMobileMenuOpen: false
	});
	let currentPath = $state('');

	// Subscribe to stores using $effect
	$effect(() => {
		const unsubscribeApp = appStore.subscribe(state => {
			appState = state;
		});

		const unsubscribePage = page.subscribe($page => {
			currentPath = $page.url.pathname;
		});

		return () => {
			unsubscribeApp();
			unsubscribePage();
		};
	});

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
		appStore.closeMobileMenu();
	}

	function toggleMobileMenu() {
		appStore.toggleMobileMenu();
	}

	function closeMobileMenu() {
		appStore.closeMobileMenu();
	}

	// Desktop sidebar hover state
	let isDesktopSidebarExpanded = $state(false);

	// Mobile sync status helpers
	let pendingCount = $derived($offlineExpenses.filter(expense => !expense.synced).length);
	let hasConflicts = $derived($syncConflicts.length > 0);

	function getMobileStatusColor(): string {
		if (!$isOnline) return 'text-red-500';
		if (hasConflicts) return 'text-orange-500';
		if ($syncStatus === 'syncing') return 'text-yellow-500';
		if ($syncStatus === 'error') return 'text-red-500';
		if (pendingCount > 0) return 'text-yellow-500';
		return 'text-green-500';
	}

	function getMobileStatusIcon() {
		if (!$isOnline) return WifiOff;
		if (hasConflicts) return CircleAlert;
		if ($syncStatus === 'syncing') return RefreshCw;
		if ($syncStatus === 'error') return CircleAlert;
		if (pendingCount > 0) return Clock;
		return Wifi;
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
				{@const StatusIcon = getMobileStatusIcon()}
				<div class="{getMobileStatusColor()} relative">
					<StatusIcon class="h-5 w-5 {$syncStatus === 'syncing' ? 'animate-spin' : ''}" />
					{#if pendingCount > 0}
						<span
							class="absolute -top-1 -right-1 bg-yellow-500 text-white text-[10px] font-bold rounded-full h-3.5 w-3.5 flex items-center justify-center"
						>
							{pendingCount > 9 ? '9+' : pendingCount}
						</span>
					{/if}
				</div>
			{/snippet}
			{@render mobileStatusIcon()}

			<button
				type="button"
				class="p-2 rounded-md text-gray-600 hover:text-gray-900 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
				onclick={toggleMobileMenu}
			>
				{#if appState.isMobileMenuOpen}
					<X class="h-6 w-6" />
				{:else}
					<Menu class="h-6 w-6" />
				{/if}
			</button>
		</div>
	</div>
</div>

<!-- Mobile menu overlay -->
{#if appState.isMobileMenuOpen}
	<div
		class="lg:hidden fixed inset-0 z-30 bg-gray-600 bg-opacity-75"
		role="button"
		tabindex="0"
		onclick={closeMobileMenu}
		onkeydown={e => (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') && closeMobileMenu()}
		aria-label="Close mobile menu"
	></div>
{/if}

<!-- Desktop Sidebar -->
<div
	class="hidden lg:fixed lg:inset-y-0 lg:flex lg:flex-col transition-all duration-300 ease-in-out z-40"
	class:lg:w-64={isDesktopSidebarExpanded}
	class:lg:w-20={!isDesktopSidebarExpanded}
	onmouseenter={() => (isDesktopSidebarExpanded = true)}
	onmouseleave={() => (isDesktopSidebarExpanded = false)}
	role="navigation"
>
	<div class="flex flex-col flex-grow bg-white border-r border-gray-200 pt-5 pb-4 overflow-y-auto">
		<!-- Logo -->
		<div class="flex items-center flex-shrink-0 px-6 transition-all duration-300">
			<div class="flex items-center">
				<span class="text-2xl">🚗</span>
				{#if isDesktopSidebarExpanded}
					<span class="ml-3 text-xl font-bold text-gray-900 whitespace-nowrap">VROOM</span>
				{/if}
			</div>
		</div>

		<!-- Navigation -->
		<nav class="mt-8 flex-1 px-3 space-y-1">
			{#each navigation as item}
				{@const IconComponent = item.icon}
				<a
					href={item.href}
					class="group flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors duration-200"
					class:bg-primary-100={isActive(item.href)}
					class:text-primary-700={isActive(item.href)}
					class:text-gray-700={!isActive(item.href)}
					class:hover:bg-gray-100={!isActive(item.href)}
					class:justify-center={!isDesktopSidebarExpanded}
					title={!isDesktopSidebarExpanded ? item.name : ''}
				>
					<IconComponent
						class="h-5 w-5 flex-shrink-0 {isActive(item.href)
							? 'text-primary-600'
							: 'text-gray-500'} {isDesktopSidebarExpanded ? 'mr-3' : ''}"
					/>
					{#if isDesktopSidebarExpanded}
						<span class="whitespace-nowrap">{item.name}</span>
					{/if}
				</a>
			{/each}
		</nav>

		<!-- Desktop User menu -->
		<div class="flex-shrink-0 px-3 pb-3">
			<!-- User Navigation -->
			<div class="space-y-1">
				{#each userNavigation as item}
					{@const IconComponent = item.icon}
					<a
						href={item.href}
						class="group flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors duration-200"
						class:bg-primary-100={isActive(item.href)}
						class:text-primary-700={isActive(item.href)}
						class:text-gray-700={!isActive(item.href)}
						class:hover:bg-gray-100={!isActive(item.href)}
						class:justify-center={!isDesktopSidebarExpanded}
						title={!isDesktopSidebarExpanded ? item.name : ''}
					>
						<IconComponent
							class="h-5 w-5 flex-shrink-0 {isActive(item.href)
								? 'text-primary-600'
								: 'text-gray-500'} {isDesktopSidebarExpanded ? 'mr-3' : ''}"
						/>
						{#if isDesktopSidebarExpanded}
							<span class="whitespace-nowrap">{item.name}</span>
						{/if}
					</a>
				{/each}
			</div>

			<button
				type="button"
				class="w-full flex items-center px-3 py-2 text-sm font-medium text-gray-700 rounded-md hover:bg-gray-100 transition-colors duration-200 mt-2"
				class:justify-center={!isDesktopSidebarExpanded}
				onclick={handleLogout}
				title={!isDesktopSidebarExpanded ? 'Sign out' : ''}
			>
				<LogOut class="h-5 w-5 text-gray-500 {isDesktopSidebarExpanded ? 'mr-3' : ''}" />
				{#if isDesktopSidebarExpanded}
					<span class="whitespace-nowrap">Sign out</span>
				{/if}
			</button>
		</div>

		<!-- Sync Status -->
		<div class="flex-shrink-0 px-3 pb-4">
			<SyncStatusInline isExpanded={isDesktopSidebarExpanded} />
		</div>
	</div>
</div>

<!-- Mobile sidebar -->
<div
	class="lg:hidden fixed inset-y-0 left-0 z-40 w-64 bg-white transform transition-transform duration-300 ease-in-out"
	class:translate-x-0={appState.isMobileMenuOpen}
	class:-translate-x-full={!appState.isMobileMenuOpen}
>
	<div class="flex flex-col h-full pt-16 pb-4 overflow-y-auto">
		<!-- Mobile Navigation -->
		<nav class="flex-1 px-3 space-y-1">
			{#each navigation as item}
				{@const IconComponent = item.icon}
				<a
					href={item.href}
					class="group flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors duration-200"
					class:bg-primary-100={isActive(item.href)}
					class:text-primary-700={isActive(item.href)}
					class:text-gray-700={!isActive(item.href)}
					class:hover:bg-gray-100={!isActive(item.href)}
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

		<!-- Mobile User menu -->
		<div class="flex-shrink-0 px-3 pb-4">
			<!-- Mobile User Navigation -->
			<div class="space-y-1">
				{#each userNavigation as item}
					{@const IconComponent = item.icon}
					<a
						href={item.href}
						class="group flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors duration-200"
						class:bg-primary-100={isActive(item.href)}
						class:text-primary-700={isActive(item.href)}
						class:text-gray-700={!isActive(item.href)}
						class:hover:bg-gray-100={!isActive(item.href)}
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
	</div>
</div>

<!-- Mobile content padding -->
<div class="lg:hidden h-16"></div>
