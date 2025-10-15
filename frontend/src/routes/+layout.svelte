<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { authStore } from '$lib/stores/auth.js';
	import { appStore } from '$lib/stores/app.js';
	import type { AuthState, AppState } from '$lib/types/index.js';
	import { handleRouteProtection } from '$lib/utils/auth.js';
	import Navigation from '$lib/components/Navigation.svelte';
	import NotificationToast from '$lib/components/NotificationToast.svelte';
	import OfflineIndicator from '$lib/components/OfflineIndicator.svelte';
	import PWAInstallPrompt from '$lib/components/PWAInstallPrompt.svelte';
	import SyncConflictResolver from '$lib/components/SyncConflictResolver.svelte';
	import { registerServiceWorker } from '$lib/utils/pwa';
	import { loadOfflineExpenses } from '$lib/utils/offline-storage';
	import { offlineExpenses } from '$lib/stores/offline';
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();

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

	onMount(() => {
		// Initialize authentication
		authStore.initialize();

		// Initialize PWA functionality
		registerServiceWorker();

		// Load offline expenses
		const savedOfflineExpenses = loadOfflineExpenses();
		offlineExpenses.set(savedOfflineExpenses);

		// Subscribe to auth state
		const unsubscribeAuth = authStore.subscribe(state => {
			authState = state;
		});

		// Subscribe to app state for notifications
		const unsubscribeApp = appStore.subscribe(state => {
			appState = state;
		});

		// Subscribe to page changes for route protection
		const unsubscribePage = page.subscribe($page => {
			currentPath = $page.url.pathname;
			handleRouteProtection($page.url.pathname, authState.isAuthenticated, authState.isLoading);
		});

		return () => {
			unsubscribeAuth();
			unsubscribeApp();
			unsubscribePage();
		};
	});

	// Determine if we should show the navigation
	let showNavigation = $derived(authState.isAuthenticated && !authState.isLoading);

	// Determine if we should show the main layout
	let isAuthPage = $derived(currentPath.startsWith('/auth'));
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<meta name="theme-color" content="#2563eb" />
</svelte:head>

{#if authState.isLoading}
	<!-- Loading screen -->
	<div class="min-h-screen bg-gray-50 flex items-center justify-center">
		<div class="text-center">
			<div class="text-6xl mb-4">🚗</div>
			<div
				class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-4"
			></div>
			<p class="text-gray-600">Loading VROOM...</p>
		</div>
	</div>
{:else if isAuthPage}
	<!-- Auth pages without navigation -->
	<main class="min-h-screen bg-gray-50">
		{@render children?.()}
	</main>
{:else if showNavigation}
	<!-- Main app layout with navigation -->
	<div class="min-h-screen bg-gray-50">
		<Navigation />

		<main class="lg:pl-64">
			<div class="px-4 sm:px-6 lg:px-8 py-6">
				{@render children?.()}
			</div>
		</main>
	</div>
{:else}
	<!-- Fallback layout -->
	<main class="min-h-screen bg-gray-50">
		{@render children?.()}
	</main>
{/if}

<!-- Offline indicator -->
<OfflineIndicator />

<!-- PWA install prompt -->
<PWAInstallPrompt />

<!-- Sync conflict resolver -->
<SyncConflictResolver />

<!-- Notification toasts -->
{#if appState.notifications.length > 0}
	<div class="fixed top-4 left-4 z-50 space-y-2">
		{#each appState.notifications as notification}
			<NotificationToast {notification} />
		{/each}
	</div>
{/if}
