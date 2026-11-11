<script lang="ts">
	import { onMount, type Component } from 'svelte';
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
	import { syncConflicts } from '$lib/utils/sync/sync-state.svelte';
	import { pwaInfo } from 'virtual:pwa-info';
	import { loadOfflineExpenses } from '$lib/utils/offline-storage';
	import { offlineExpenseQueue } from '$lib/stores/offline.svelte';
	import '../app.css';
	// Theme token blocks are imported after app.css so non-default themes paint without FOUC.
	import '$lib/theme/themes.css';

	import { LoaderCircle } from '@lucide/svelte';

	import { reminderApi } from '$lib/services/reminder-api';
	import { maybeTriggerRecurringExpenses } from '$lib/utils/reminder-helpers';
	import { onlineStatus } from '$lib/stores/offline.svelte';
	import { themeStore } from '$lib/stores/theme.svelte';
	import { settingsStore } from '$lib/stores/settings.svelte';

	let { children } = $props();

	let settingsLoaded = $state(false);
	let recurringTriggered = $state(false);

	// Formatters fall back to USD/imperial until settings load, so load them app-wide.
	async function loadUserSettings() {
		if (settingsLoaded) return;
		try {
			await settingsStore.load();
			settingsLoaded = true;
		} catch (error) {
			if (import.meta.env.DEV) console.error('Failed to load settings:', error);
		}
	}

	// Runs once per session; the daily gate lives in maybeTriggerRecurringExpenses.
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

	// The only toast dedup: the effect removes each notification as it toasts it, so a snapshot would be empty.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- intentionally non-reactive tracking Set, not used in $state or $derived
	const shownNotifications = new Set<string>();

	// Lazy-loaded and never unmounted: clearing the last conflict must not tear down the dialog mid-close.
	let SyncConflictResolver = $state<Component | null>(null);

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
			loadUserSettings();
			maybeTriggerRecurring();
		}
	});

	$effect(() => {
		if (SyncConflictResolver || syncConflicts.current.length === 0) return;
		void import('$lib/components/sync/SyncConflictResolver.svelte').then(module => {
			SyncConflictResolver = module.default;
		});
	});

	$effect(() => {
		appState.notifications.forEach(notification => {
			if (shownNotifications.has(notification.id)) {
				return;
			}

			shownNotifications.add(notification.id);

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
	});

	$effect(() => {
		handleRouteProtection(currentPath, authState.isAuthenticated, authState.isLoading);
	});
</script>

<svelte:head>
	<!-- app.html owns viewport and theme-color; a second declaration here overrides it. -->
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- PWA manifest link from @vite-pwa/sveltekit -->
	{@html webManifestLink}
</svelte:head>

{#if authState.isLoading}
	<div class="min-h-screen bg-background flex items-center justify-center">
		<div class="text-center">
			<div class="text-6xl mb-4">🚗</div>
			<LoaderCircle class="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
			<p class="text-muted-foreground">Loading VROOM...</p>
		</div>
	</div>
{:else if isAuthPage || isHomePage}
	<main class="min-h-screen bg-background">
		{@render children?.()}
	</main>
{:else if showNavigation}
	<div class="min-h-screen bg-background">
		<Navigation />

		<main class="lg:pl-20 transition-all duration-300">
			<div class="px-4 sm:px-6 lg:px-8 py-6">
				{@render children?.()}
			</div>
		</main>
	</div>
{:else}
	<main class="min-h-screen bg-background">
		{@render children?.()}
	</main>
{/if}

<OfflineIndicator />

<PWAInstallPrompt />

{#if SyncConflictResolver}
	<SyncConflictResolver />
{/if}

<Toaster position="bottom-right" richColors closeButton />
