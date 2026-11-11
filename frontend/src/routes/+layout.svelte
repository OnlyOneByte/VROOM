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
	// The generated `:root[data-theme="<id>"]` blocks for non-default themes. Imported right after
	// app.css so a non-default theme paints with zero FOUC and zero token duplication in JS. themeStore
	// sets `data-theme` on <html>; with no data-theme (or "default") app.css's bare :root wins.
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

	// Hydrate the settings store app-wide once authenticated. currencyUnit and unit
	// preferences are GLOBAL display state — getCurrencySymbol()/formatCurrency() and
	// unit formatters read settingsStore.settings, falling back to USD/imperial when
	// it's null. Without this, a page that doesn't itself call settingsStore.load()
	// (e.g. the insurance forms) showed "$" for a EUR/GBP user on a direct/refreshed
	// load. Loading it here makes the symbol correct everywhere.
	async function loadUserSettings() {
		if (settingsLoaded) return;
		try {
			await settingsStore.load();
			settingsLoaded = true;
		} catch (error) {
			if (import.meta.env.DEV) console.error('Failed to load settings:', error);
		}
	}

	// Opportunistically materialize due recurring expenses on app init — authed + online + at most once
	// per local calendar day (the gate + localStorage debounce live in maybeTriggerRecurringExpenses).
	// Fail-soft: a trigger error is swallowed there and the manual "Run due reminders" button remains.
	// Once per session here (recurringTriggered) so re-running the auth effect doesn't re-call it within
	// the same load.
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

	// The SOLE toast dedup for the notification queue: a notification is toasted once, ever, even if
	// it is re-added or the effect re-runs. Do not add a second "ids I saw last run" snapshot — the
	// effect removes each notification as it toasts it, so any snapshot taken afterwards is empty.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- intentionally non-reactive tracking Set, not used in $state or $derived
	const shownNotifications = new Set<string>();

	// The offline-sync conflict dialog: loaded on demand because its dialog/scroll-area/alert chrome
	// is dead weight on every route for a modal that appears only when a queued write collides with
	// the server. Set-once on purpose — resolving the last conflict empties the list, and unmounting
	// the dialog in that same flush would tear it down mid-close.
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
	});

	$effect(() => {
		handleRouteProtection(currentPath, authState.isAuthenticated, authState.isLoading);
	});
</script>

<svelte:head>
	<!--
		Do NOT re-declare `viewport` or `theme-color` here. app.html owns both, and a duplicate in
		<svelte:head> lands AFTER it in the document:
		  - viewport: a later <meta name="viewport"> REPLACES the earlier description wholesale rather
		    than merging, so one that omits `viewport-fit=cover` resets it to `auto`. The safe-area
		    insets app.css's .safe-top/.safe-bottom read then collapse to 0 on notched devices.
		  - theme-color: the browser uses the FIRST declaration, which is also the one themeStore
		    rewrites (document.querySelector returns the first match), so a second one is dead weight
		    that silently disagrees with the installed-app manifest colour in vite.config.ts.
	-->
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

<!-- Sync conflict resolver (loaded on first conflict) -->
{#if SyncConflictResolver}
	<SyncConflictResolver />
{/if}

<!-- Sonner toast container -->
<Toaster position="bottom-right" richColors closeButton />
