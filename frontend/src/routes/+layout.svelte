<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { authStore } from '$lib/stores/auth.svelte';
	import { appStore } from '$lib/stores/app.svelte';
	import { handleRouteProtection } from '$lib/utils/auth.js';
	import Navigation from '$lib/components/layout/Navigation.svelte';
	import { Toaster } from '$lib/components/ui/sonner';
	import { toast } from 'svelte-sonner';
	import OfflineIndicator from '$lib/components/sync/OfflineIndicator.svelte';
	import { NOTIFICATION_LIMITS } from '$lib/constants/limits';
	import PWAInstallPrompt from '$lib/components/layout/PWAInstallPrompt.svelte';
	import SyncConflictResolver from '$lib/components/sync/SyncConflictResolver.svelte';
	import { pwaInfo } from 'virtual:pwa-info';
	import { loadOfflineExpenses } from '$lib/utils/offline-storage';
	import { offlineExpenseQueue } from '$lib/stores/offline.svelte';
	import '../app.css';

	import { LoaderCircle } from '@lucide/svelte';

	import { vehicleApi } from '$lib/services/vehicle-api';
	import { reminderApi } from '$lib/services/reminder-api';
	import { maybeTriggerRecurringExpenses } from '$lib/utils/reminder-helpers';
	import { onlineStatus } from '$lib/stores/offline.svelte';
	import { themeStore } from '$lib/stores/theme.svelte';
	import { settingsStore } from '$lib/stores/settings.svelte';

	let { children } = $props();

	let vehiclesLoaded = $state(false);
	let settingsLoaded = $state(false);
	let recurringTriggered = $state(false);

	async function loadUserVehicles() {
		if (vehiclesLoaded) return;
		try {
			const vehicles = await vehicleApi.getVehicles();
			appStore.setVehicles(vehicles);
			vehiclesLoaded = true;
		} catch (error) {
			if (import.meta.env.DEV) console.error('Failed to load vehicles:', error);
		}
	}

	// Hydrate the settings store app-wide once authenticated. currencyUnit and unit
	// preferences are GLOBAL display state — getCurrencySymbol()/formatCurrency() and
	// unit formatters read settingsStore.settings, falling back to USD/imperial when
	// it's null. Without this, a page that doesn't itself call settingsStore.load()
	// (e.g. the insurance forms) showed "$" for a EUR/GBP user on a direct/refreshed
	// load. Loading it here makes the symbol correct everywhere. (cycle 203)
	async function loadUserSettings() {
		if (settingsLoaded) return;
		try {
			await settingsStore.load();
			settingsLoaded = true;
		} catch (error) {
			if (import.meta.env.DEV) console.error('Failed to load settings:', error);
		}
	}

	// recurring-expenses T5/D1: opportunistically materialize due recurring expenses on app init —
	// authed + online + at most once per local calendar day (the gate + localStorage debounce live in
	// maybeTriggerRecurringExpenses). Fail-soft (a trigger error is swallowed there; the manual "Run due
	// reminders" button remains). Once per session here (recurringTriggered) so re-running the auth
	// effect doesn't re-call it within the same load.
	async function maybeTriggerRecurring() {
		if (recurringTriggered) return;
		recurringTriggered = true;
		await maybeTriggerRecurringExpenses({
			isAuthed: authState.isAuthenticated,
			isOnline: onlineStatus.current,
			isBrowser: true,
			trigger: () => reminderApi.trigger()
		});
	}

	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- intentionally non-reactive tracking Set, not used in $state or $derived
	const shownNotifications = new Set<string>();

	let previousNotificationIds = new Set<string>();

	let webManifestLink = $derived(pwaInfo ? pwaInfo.webManifest.linkTag : '');

	onMount(async () => {
		themeStore.initialize();
		authStore.initialize();
		offlineExpenseQueue.current = loadOfflineExpenses();

		if (pwaInfo) {
			const pwaRegister: typeof import('virtual:pwa-register') =
				await import('virtual:pwa-register');
			pwaRegister.registerSW({
				immediate: true,
				onRegistered(r: ServiceWorkerRegistration | undefined) {
					if (import.meta.env.DEV) console.log('SW Registered:', r);
				},
				onRegisterError(error: unknown) {
					if (import.meta.env.DEV) console.error('SW registration error', error);
				}
			});
		}
	});

	const authState = authStore;
	let appState = $derived({
		notifications: appStore.notifications
	});
	let currentPath = $derived(page.url.pathname);
	let showNavigation = $derived(authState.isAuthenticated && !authState.isLoading);
	let isAuthPage = $derived(currentPath.startsWith('/auth'));
	let isHomePage = $derived(currentPath === '/');

	$effect(() => {
		if (authState.isAuthenticated && !authState.isLoading) {
			loadUserVehicles();
			loadUserSettings();
			maybeTriggerRecurring();
		}
	});

	$effect(() => {
		appState.notifications.forEach(notification => {
			if (previousNotificationIds.has(notification.id) || shownNotifications.has(notification.id)) {
				return;
			}

			shownNotifications.add(notification.id);

			// Prevent memory leak by limiting Set size
			if (shownNotifications.size > NOTIFICATION_LIMITS.MAX_HISTORY) {
				const oldestId = Array.from(shownNotifications)[0];
				if (oldestId) {
					shownNotifications.delete(oldestId);
				}
			}

			const options = {
				duration: notification.duration || 5000,
				style: `--toast-duration: ${notification.duration || 5000}ms;`
			};

			const toastFn = {
				success: toast.success,
				error: toast.error,
				warning: toast.warning,
				info: toast.info
			}[notification.type];

			toastFn(notification.message, options);
			appStore.removeNotification(notification.id);
		});

		previousNotificationIds = new Set(appState.notifications.map(n => n.id));
	});

	$effect(() => {
		handleRouteProtection(currentPath, authState.isAuthenticated, authState.isLoading);
	});
</script>

<svelte:head>
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<meta name="theme-color" content="#2563eb" />
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- PWA manifest link from @vite-pwa/sveltekit -->
	{@html webManifestLink}
</svelte:head>

{#if authState.isLoading}
	<!-- Loading screen -->
	<div class="min-h-screen bg-background flex items-center justify-center">
		<div class="text-center">
			<div class="text-6xl mb-4">🚗</div>
			<LoaderCircle class="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
			<p class="text-muted-foreground">Loading VROOM...</p>
		</div>
	</div>
{:else if isAuthPage || isHomePage}
	<!-- Auth and home pages without navigation -->
	<main class="min-h-screen bg-background">
		{@render children?.()}
	</main>
{:else if showNavigation}
	<!-- Main app layout with navigation -->
	<div class="min-h-screen bg-background">
		<Navigation />

		<main class="lg:pl-20 transition-all duration-300">
			<div class="px-4 sm:px-6 lg:px-8 py-6">
				{@render children?.()}
			</div>
		</main>
	</div>
{:else}
	<!-- Fallback layout -->
	<main class="min-h-screen bg-background">
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
