<script lang="ts">
	import { onMount, type Component } from 'svelte';
	import { page } from '$app/state';
	import { authStore } from '#lib/stores/auth.svelte.ts';
	import { appStore } from '#lib/stores/app.svelte.ts';
	import { handleRouteProtection, isPublicRoute } from '#lib/utils/auth.js';
	import Navigation from '#lib/components/layout/Navigation.svelte';
	import { Toaster } from '#lib/components/ui/sonner/index.ts';
	import { toast } from 'svelte-sonner';
	import OfflineIndicator from '#lib/components/sync/OfflineIndicator.svelte';
	import { NOTIFICATION_LIMITS } from '#lib/constants/limits.ts';
	import PWAInstallPrompt from '#lib/components/layout/PWAInstallPrompt.svelte';
	import { syncConflicts } from '#lib/utils/sync/sync-state.svelte.ts';
	import { pwaInfo } from 'virtual:pwa-info';
	import '../app.css';
	// Theme overrides must load after app.css, or non-default themes flash the default palette.
	import '#lib/theme/themes.css';

	import { LoaderCircle } from '@lucide/svelte';

	import { reminderApi } from '#lib/services/reminder-api.ts';
	import { maybeTriggerRecurringExpenses } from '#lib/utils/reminder-helpers.ts';
	import { onlineStatus } from '#lib/stores/offline.svelte.ts';
	import { themeStore } from '#lib/stores/theme.svelte.ts';
	import { settingsStore } from '#lib/stores/settings.svelte.ts';
	import BrandMark from '#lib/components/common/BrandMark.svelte';

	let { children } = $props();

	let settingsLoaded = $state(false);
	let recurringTriggered = $state(false);

	async function loadUserSettings() {
		if (settingsLoaded) return;
		try {
			await settingsStore.load();
			settingsLoaded = true;
		} catch (error) {
			if (import.meta.env.DEV) console.error('Failed to load settings:', error);
		}
	}

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

	let SyncConflictResolver = $state<Component | null>(null);

	let webManifestLink = $derived(pwaInfo ? pwaInfo.webManifest.linkTag : '');

	onMount(async () => {
		themeStore.initialize();
		mayBeSignedIn = authStore.remembersUser();
		authStore.initialize({ fromCache: !isPublicRoute(page.url.pathname) });

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
	let mainEl = $state<HTMLElement | null>(null);

	function skipToContent(event: MouseEvent) {
		event.preventDefault();
		mainEl?.focus();
	}
	let isAuthPage = $derived(currentPath.startsWith('/auth'));
	let isHomePage = $derived(currentPath === '/');
	let mayBeSignedIn = $state(true);
	let showSplash = $derived(
		authState.isLoading &&
			(!isPublicRoute(currentPath) || ((isAuthPage || isHomePage) && mayBeSignedIn))
	);

	$effect(() => {
		if (authState.isAuthenticated && !authState.isLoading) {
			loadUserSettings();
			maybeTriggerRecurring();
		}
	});

	$effect(() => {
		if (SyncConflictResolver || syncConflicts.current.length === 0) return;
		void import('#lib/components/sync/SyncConflictResolver.svelte').then(module => {
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
	<!-- Viewport and theme-color belong in app.html: a copy here lands later and overrides it. -->
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- PWA manifest link from @vite-pwa/sveltekit -->
	{@html webManifestLink}
</svelte:head>

{#if showSplash}
	<div class="min-h-screen bg-background flex items-center justify-center">
		<div class="text-center">
			<BrandMark class="h-14 w-14 mx-auto mb-4" />
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
		<a
			href="#main"
			onclick={skipToContent}
			class="sr-only rounded-md border bg-background text-sm font-medium text-foreground shadow-md outline-none focus-visible:not-sr-only focus-visible:px-4 focus-visible:py-2 focus-visible:fixed focus-visible:left-4 focus-visible:top-4 focus-visible:z-[100] focus-visible:ring-[3px] focus-visible:ring-ring/50"
		>
			Skip to content
		</a>
		<Navigation />

		<main
			bind:this={mainEl}
			id="main"
			tabindex="-1"
			class="lg:pl-20 transition-all duration-300 outline-none"
		>
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

{#if !showNavigation}
	<OfflineIndicator />
{/if}

<PWAInstallPrompt />

{#if SyncConflictResolver}
	<SyncConflictResolver />
{/if}

<Toaster position="bottom-right" richColors closeButton />
