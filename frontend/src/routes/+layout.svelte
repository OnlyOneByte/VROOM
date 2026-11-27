<script lang="ts">
	import { onMount, type Component } from 'svelte';
	import { page } from '$app/state';
	import { authStore } from '#lib/stores/auth.svelte.ts';
	import { appStore } from '#lib/stores/app.svelte.ts';
	import { handleRouteProtection, isPublicRoute } from '#lib/utils/auth.js';
	import Navigation from '#lib/components/layout/Navigation.svelte';
	import { isFormRoute, routes } from '#lib/routes.ts';
	import { cn } from '#lib/utils.ts';
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
	import '#lib/theme/fonts.css';

	import { LoaderCircle } from '@lucide/svelte';

	import { reminderApi } from '#lib/services/reminder-api.ts';
	import { userTimeZone } from '#lib/services/analytics-api.ts';
	import { maybeTriggerRecurringExpenses } from '#lib/utils/reminder-helpers.ts';
	import { onlineStatus } from '#lib/stores/offline.svelte.ts';
	import { themeStore } from '#lib/stores/theme.svelte.ts';
	import { settingsStore } from '#lib/stores/settings.svelte.ts';
	import BrandMark from '#lib/components/common/BrandMark.svelte';
	import LoadErrorCard from '#lib/components/common/LoadErrorCard.svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { resolve } from '$app/paths';
	import { userFacingErrorMessage } from '#lib/utils/error-handling.ts';

	let { children } = $props();

	let signingOutWaiting = $state(false);

	async function signOutWaiting() {
		signingOutWaiting = true;
		try {
			await authStore.logout();
			location.assign(resolve(routes.auth));
		} catch (e) {
			appStore.showError(`Couldn’t sign out. ${userFacingErrorMessage(e)}`);
			signingOutWaiting = false;
		}
	}

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

	onMount(() => {
		const timeZoneTimer = setTimeout(userTimeZone);
		return () => clearTimeout(timeZoneTimer);
	});

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
	let isPending = $derived(authState.isAuthenticated && authState.user?.pendingApproval === true);
	let showNavigation = $derived(authState.isAuthenticated && !authState.isLoading && !isPending);
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
		if (authState.isAuthenticated && !authState.isLoading && !isPending) {
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
				style: `--toast-duration: ${notification.duration || 5000}ms;`,
				...(notification.toastId && {
					id: notification.toastId,
					description: undefined,
					action: undefined
				}),
				...(notification.description && { description: notification.description }),
				...(notification.action && { action: notification.action })
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
		const dismissals = appStore.toastDismissals;
		if (dismissals.length === 0) return;
		for (const id of dismissals) toast.dismiss(id);
		appStore.clearToastDismissals();
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
{:else if isPending && !isPublicRoute(currentPath)}
	<main class="min-h-screen bg-background">
		{#await import('#lib/components/layout/AccountPending.svelte')}
			<div class="flex min-h-screen items-center justify-center" aria-busy="true" role="status">
				<LoaderCircle class="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
				<span class="sr-only">Loading</span>
			</div>
		{:then { default: AccountPending }}
			<AccountPending />
		{:catch}
			<div class="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-3 p-4">
				<LoadErrorCard
					title="Couldn't load this page"
					message="Your account is waiting for an admin to approve it. Check your connection, then reload the page."
					onRetry={() => location.reload()}
				/>
				<Button
					variant="ghost"
					class="h-10 self-center"
					disabled={signingOutWaiting}
					onclick={() => void signOutWaiting()}
				>
					{#if signingOutWaiting}
						<LoaderCircle class="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
					{/if}
					Sign Out
				</Button>
			</div>
		{/await}
	</main>
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
		{#if authStore.user?.demo}
			{#await import('#lib/components/layout/DemoBanner.svelte') then { default: DemoBanner }}
				<DemoBanner />
			{/await}
		{/if}

		<main
			bind:this={mainEl}
			id="main"
			tabindex="-1"
			class={cn(
				'outline-none',
				!isFormRoute(currentPath) &&
					'pb-[calc(6rem+env(safe-area-inset-bottom))] lg:pb-0 short:pb-0'
			)}
		>
			<div class="px-4 sm:px-6 lg:px-10 py-6">
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
