<script lang="ts">
	import { page } from '$app/stores';
	import { authStore } from '$lib/stores/auth.js';
	import { appStore } from '$lib/stores/app.js';
	import type { AuthState, AppState } from '$lib/types/index.js';
	import { Home, Receipt, BarChart3, Settings, Menu, X, LogOut, User } from 'lucide-svelte';
	import SyncStatusIndicator from './SyncStatusIndicator.svelte';

	let authState = $state<AuthState>({
		user: null,
		isAuthenticated: false,
		isLoading: true,
		error: null,
		token: null
	});
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
		const unsubscribeAuth = authStore.subscribe(state => {
			authState = state;
		});

		const unsubscribeApp = appStore.subscribe(state => {
			appState = state;
		});

		const unsubscribePage = page.subscribe($page => {
			currentPath = $page.url.pathname;
		});

		return () => {
			unsubscribeAuth();
			unsubscribeApp();
			unsubscribePage();
		};
	});

	const navigation = [
		{ name: 'Dashboard', href: '/vehicles', icon: Home },
		{ name: 'Expenses', href: '/expenses', icon: Receipt },
		{ name: 'Analytics', href: '/analytics', icon: BarChart3 },
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
</script>

<!-- Mobile menu button -->
<div class="lg:hidden fixed top-0 left-0 right-0 z-40 bg-white border-b border-gray-200">
	<div class="flex items-center justify-between px-4 py-3">
		<div class="flex items-center gap-3">
			<span class="text-2xl">🚗</span>
			<span class="font-bold text-gray-900">VROOM</span>
		</div>

		<SyncStatusIndicator />

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
<div class="hidden lg:fixed lg:inset-y-0 lg:flex lg:w-64 lg:flex-col">
	<div class="flex flex-col flex-grow bg-white border-r border-gray-200 pt-5 pb-4 overflow-y-auto">
		<!-- Logo -->
		<div class="flex items-center justify-between flex-shrink-0 px-6">
			<div class="flex items-center">
				<span class="text-2xl">🚗</span>
				<span class="ml-3 text-xl font-bold text-gray-900">VROOM</span>
			</div>
			<SyncStatusIndicator />
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

		<!-- Desktop User menu -->
		<div class="flex-shrink-0 px-3 pb-4">
			<div class="flex items-center px-3 py-2 text-sm">
				<div class="flex items-center justify-center w-8 h-8 bg-primary-100 rounded-full mr-3">
					<User class="h-4 w-4 text-primary-600" />
				</div>
				<div class="flex-1 min-w-0">
					<p class="text-sm font-medium text-gray-900 truncate">
						{authState.user?.displayName || 'User'}
					</p>
					<p class="text-xs text-gray-500 truncate">
						{authState.user?.email || ''}
					</p>
				</div>
			</div>

			<button
				type="button"
				class="w-full flex items-center px-3 py-2 text-sm font-medium text-gray-700 rounded-md hover:bg-gray-100 transition-colors duration-200"
				onclick={handleLogout}
			>
				<LogOut class="mr-3 h-5 w-5 text-gray-500" />
				Sign out
			</button>
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
			<div class="flex items-center px-3 py-2 text-sm">
				<div class="flex items-center justify-center w-8 h-8 bg-primary-100 rounded-full mr-3">
					<User class="h-4 w-4 text-primary-600" />
				</div>
				<div class="flex-1 min-w-0">
					<p class="text-sm font-medium text-gray-900 truncate">
						{authState.user?.displayName || 'User'}
					</p>
					<p class="text-xs text-gray-500 truncate">
						{authState.user?.email || ''}
					</p>
				</div>
			</div>

			<button
				type="button"
				class="w-full flex items-center px-3 py-2 text-sm font-medium text-gray-700 rounded-md hover:bg-gray-100 transition-colors duration-200"
				onclick={handleLogout}
			>
				<LogOut class="mr-3 h-5 w-5 text-gray-500" />
				Sign out
			</button>
		</div>
	</div>
</div>

<!-- Mobile content padding -->
<div class="lg:hidden h-16"></div>
