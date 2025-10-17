<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { authStore } from '$lib/stores/auth.js';
	import { appStore } from '$lib/stores/app.js';
	import { handleRouteProtection } from '$lib/utils/auth.js';
	import Navigation from '$lib/components/Navigation.svelte';
	import { Toaster } from '$lib/components/ui/sonner';
	import { toast } from 'svelte-sonner';
	import OfflineIndicator from '$lib/components/OfflineIndicator.svelte';
	import PWAInstallPrompt from '$lib/components/PWAInstallPrompt.svelte';
	import SyncConflictResolver from '$lib/components/SyncConflictResolver.svelte';
	import { registerServiceWorker } from '$lib/utils/pwa';
	import { loadOfflineExpenses } from '$lib/utils/offline-storage';
	import { offlineExpenses } from '$lib/stores/offline';
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();

	let vehiclesLoaded = $state(false);

	async function loadUserVehicles() {
		// Prevent loading vehicles multiple times
		if (vehiclesLoaded) return;

		try {
			const response = await fetch('/api/vehicles', {
				credentials: 'include'
			});

			if (response.ok) {
				const result = await response.json();
				const vehicles = result.data || [];
				appStore.setVehicles(vehicles);
				vehiclesLoaded = true;
			}
		} catch (error) {
			console.error('Failed to load vehicles:', error);
		}
	}

	// Track shown notifications globally to prevent duplicates across remounts
	const shownNotifications = new Set<string>();
	let previousNotificationIds = new Set<string>();

	onMount(() => {
		// Initialize authentication
		authStore.initialize();

		// Initialize PWA functionality
		registerServiceWorker();

		// Load offline expenses
		const savedOfflineExpenses = loadOfflineExpenses();
		offlineExpenses.set(savedOfflineExpenses);
	});

	// Use automatic store subscriptions with $
	let authState = $derived($authStore);
	let appState = $derived($appStore);
	let currentPath = $derived($page.url.pathname);

	// Load vehicles when user becomes authenticated
	$effect(() => {
		if (authState.isAuthenticated && !authState.isLoading) {
			loadUserVehicles();
		}
	});

	// Handle notifications
	$effect(() => {
		// Only process NEW notifications (not in previous set)
		appState.notifications.forEach(notification => {
			// Skip if we've seen this notification before
			if (previousNotificationIds.has(notification.id) || shownNotifications.has(notification.id)) {
				return;
			}

			// Mark as shown
			shownNotifications.add(notification.id);

			const duration = notification.duration || 5000;
			const options = {
				duration,
				style: `--toast-duration: ${duration}ms;`
			};

			switch (notification.type) {
				case 'success':
					toast.success(notification.message, options);
					break;
				case 'error':
					toast.error(notification.message, options);
					break;
				case 'warning':
					toast.warning(notification.message, options);
					break;
				case 'info':
					toast.info(notification.message, options);
					break;
			}

			// Remove notification from store after showing
			appStore.removeNotification(notification.id);
		});

		// Update previous notification IDs for next comparison
		previousNotificationIds = new Set(appState.notifications.map(n => n.id));
	});

	// Handle route protection
	$effect(() => {
		handleRouteProtection(currentPath, authState.isAuthenticated, authState.isLoading);
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

		<main class="lg:pl-20 transition-all duration-300">
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

<!-- Sonner toast container -->
<Toaster position="bottom-right" richColors closeButton />
