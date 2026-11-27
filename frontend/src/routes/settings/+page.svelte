<script lang="ts">
	import { onMount } from 'svelte';
	import { trackPendingSave } from '#lib/utils/pending-saves.ts';
	import PageHeader from '#lib/components/common/page-header.svelte';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { settingsStore } from '#lib/stores/settings.svelte.ts';
	import { appStore } from '#lib/stores/app.svelte.ts';
	import { logLoadFailure, userFacingErrorMessage } from '#lib/utils/error-handling.ts';
	import { authStore } from '#lib/stores/auth.svelte.ts';
	import { routes } from '#lib/routes.ts';
	import { LoaderCircle, ChevronRight, CircleAlert } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import {
		Card,
		CardAction,
		CardContent,
		CardHeader,
		CardTitle
	} from '#lib/components/ui/card/index.ts';
	import UnitPreferencesCard from '#lib/components/settings/cards/UnitPreferencesCard.svelte';
	import CommunityStatsCard from '#lib/components/settings/cards/CommunityStatsCard.svelte';
	import ThemeCard from '#lib/components/settings/cards/ThemeCard.svelte';
	import ThemePickerCard from '#lib/components/settings/cards/ThemePickerCard.svelte';
	import PWAInstallCard from '#lib/components/settings/cards/PwaInstallCard.svelte';
	import PushNotificationsCard from '#lib/components/settings/cards/PushNotificationsCard.svelte';
	import CalendarFeedCard from '#lib/components/settings/cards/CalendarFeedCard.svelte';
	import { fetchLastSyncTime } from '#lib/utils/sync/sync-manager.ts';
	import { providerApi } from '#lib/services/provider-api.ts';
	import { signupApi } from '#lib/services/signup-api.ts';
	import { can } from '#lib/utils/permissions.ts';
	import type { CommunityStatsUpdate, UserProviderInfo, UserSettings } from '#lib/types/index.ts';

	let user = $derived(authStore.user);

	let signingOut = $state(false);

	async function handleSignOut() {
		if (signingOut) return;
		signingOut = true;
		try {
			await authStore.logout();
		} catch (error) {
			appStore.showError(`Couldn't sign out. ${userFacingErrorMessage(error)}`);
		} finally {
			signingOut = false;
		}
	}

	let settings = $derived(settingsStore.settings);
	let loadError = $derived(settingsStore.error && !settings ? settingsStore.error : null);

	let savesInFlight = $state(0);

	onMount(() => trackPendingSave(() => savesInFlight > 0));
	let isBackingUp = $state(false);

	let distanceUnit = $state<'miles' | 'kilometers'>('miles');
	let volumeUnit = $state<'gallons_us' | 'gallons_uk' | 'liters'>('gallons_us');
	let chargeUnit = $state<'kwh'>('kwh');
	let currencyUnit = $state('USD');

	let storageProviders = $state<UserProviderInfo[] | null>(null);

	let storageSummary = $derived.by(() => {
		if (storageProviders === null) return 'Photos and backups in storage you own';
		if (storageProviders.length === 0) return 'Not set up yet';
		return storageProviders.map(p => p.displayName).join(' · ');
	});

	const AI_ANCHORS = new Set(['#settings-ai', '#receipt-scanning', '#assistant-providers']);

	const migrateCard = import('#lib/components/settings/cards/MigrateFromTrackerCard.svelte');
	migrateCard.catch(() => undefined);

	let isInitialized = $state(false);

	onMount(() => {
		if (location.hash === '#settings-connections') {
			void goto(resolve(routes.settingsStorage), { replaceState: true });
			return;
		}
		if (AI_ANCHORS.has(location.hash)) {
			const anchor = location.hash === '#settings-ai' ? '' : location.hash;
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- the path is resolved; only the card's anchor is added
			void goto(`${resolve(routes.settingsAi)}${anchor}`, { replaceState: true });
			return;
		}
		settingsStore.load();
		loadProviders();
	});

	function retryLoad() {
		settingsStore.load();
		loadProviders();
	}

	async function loadProviders() {
		storageProviders = await providerApi
			.getProviders('storage')
			.catch((): UserProviderInfo[] | null => null);
	}

	let managesServer = $state(false);

	onMount(async () => {
		try {
			managesServer = can(await signupApi.serverRules(), 'server.signup.manage');
		} catch (error) {
			logLoadFailure(error, "Couldn't check server permissions");
			managesServer = false;
		}
	});

	$effect(() => {
		if (settings && !isInitialized) {
			distanceUnit = settings.unitPreferences.distanceUnit;
			volumeUnit = settings.unitPreferences.volumeUnit;
			chargeUnit = settings.unitPreferences.chargeUnit;
			currencyUnit = settings.currencyUnit;
			isInitialized = true;
		}
	});

	let savesOverlapped = false;
	let saveGeneration = 0;

	async function persist(updates: Partial<UserSettings>) {
		if (savesInFlight > 0) savesOverlapped = true;
		saveGeneration++;
		savesInFlight++;
		try {
			await settingsStore.update(updates);
		} finally {
			savesInFlight--;
			if (savesInFlight === 0) void resyncAfterSaves();
		}
	}

	let resyncing = false;

	async function resyncAfterSaves() {
		if (resyncing) return;
		resyncing = true;
		try {
			while (savesOverlapped) {
				savesOverlapped = false;
				const generation = saveGeneration;
				await settingsStore.load().catch(() => undefined);
				if (saveGeneration !== generation) {
					savesOverlapped = true;
					if (savesInFlight > 0) return;
				}
			}
			if (savesInFlight === 0) isInitialized = false;
		} finally {
			resyncing = false;
		}
	}

	async function saveSettings(updates: Partial<UserSettings>, savedMessage: string) {
		try {
			await persist(updates);
			await fetchLastSyncTime();
			appStore.showSuccess(savedMessage);
		} catch (error) {
			appStore.showError(`Couldn't save settings. ${userFacingErrorMessage(error)}`);
		}
	}

	function saveUnits() {
		void saveSettings({ unitPreferences: { distanceUnit, volumeUnit, chargeUnit } }, 'Units saved');
	}

	function saveCurrency() {
		void saveSettings({ currencyUnit }, 'Currency saved');
	}

	async function saveCommunityStats(updates: CommunityStatsUpdate) {
		try {
			await persist(updates);
		} catch (error) {
			appStore.showError(`Couldn't save community settings. ${userFacingErrorMessage(error)}`);
			throw error;
		}
		appStore.showSuccess(communitySavedMessage(updates));
	}

	function communitySavedMessage(updates: CommunityStatsUpdate): string {
		if (updates.communityStatsOptIn === undefined) return 'Region saved';
		return updates.communityStatsOptIn ? 'Community stats turned on' : 'Community stats turned off';
	}

	async function handleBackup() {
		isBackingUp = true;
		try {
			await settingsStore.downloadBackup();
			appStore.showSuccess('Backup downloaded successfully');
		} catch (error) {
			appStore.showError(`Couldn't download the backup. ${userFacingErrorMessage(error)}`);
		} finally {
			isBackingUp = false;
		}
	}
</script>

<svelte:head>
	<title>Settings - VROOM Car Tracker</title>
	<meta name="description" content="Manage your preferences, units, and storage providers" />
</svelte:head>

<div class="mx-auto w-full max-w-2xl lg:max-w-5xl">
	<div class="mb-6">
		<PageHeader title="Settings" description="Manage your preferences and data" />
	</div>

	{#if loadError}
		<div class="rounded-lg border bg-card p-6">
			<div class="mb-4 flex items-center gap-3 text-destructive">
				<CircleAlert class="h-5 w-5" />
				<p class="font-medium">Couldn't load settings</p>
			</div>
			<p class="mb-4 text-sm text-muted-foreground">{loadError}</p>
			<Button onclick={retryLoad}>Retry</Button>
		</div>
	{:else if !settings}
		<div class="flex items-center justify-center py-12">
			<LoaderCircle class="h-8 w-8 animate-spin text-primary" />
		</div>
	{:else}
		<div class="space-y-6">
			<div class="grid gap-x-12 gap-y-6 lg:grid-cols-2 lg:items-start">
				<div class="space-y-6">
					<ThemeCard />
					<ThemePickerCard />
					<UnitPreferencesCard
						bind:distanceUnit
						bind:volumeUnit
						bind:chargeUnit
						bind:currencyUnit
						onUnitsChange={saveUnits}
						onCurrencyChange={saveCurrency}
					/>
					{#if settings.communityStatsMode !== 'off'}
						<CommunityStatsCard
							optIn={settings.communityStatsOptIn ?? false}
							region={settings.communityRegion ?? null}
							minGroup={settings.communityStatsMinGroup}
							onSave={saveCommunityStats}
						/>
					{/if}
				</div>
				<div class="space-y-6">
					<Card variant="section" role="region" aria-labelledby="settings-account">
						<CardHeader>
							<CardTitle level={2} id="settings-account" class="text-base">Account</CardTitle>
							<CardAction>
								<a
									href={resolve(routes.profile)}
									class="text-sm font-semibold text-accent-ink underline-offset-4 hover:underline"
								>
									Profile
								</a>
							</CardAction>
						</CardHeader>
						<CardContent class="divide-y">
							<div class="flex items-center justify-between gap-4 pb-3">
								<div class="min-w-0">
									<p class="truncate font-medium">{user?.displayName ?? 'User'}</p>
									{#if user?.email}
										<p class="truncate text-sm text-muted-foreground">{user.email}</p>
									{/if}
								</div>
								<Button variant="outline" onclick={handleSignOut} disabled={signingOut}>
									{#if signingOut}
										<LoaderCircle class="animate-spin" aria-hidden="true" />
										Signing out…
									{:else}
										Sign out
									{/if}
								</Button>
							</div>
							{#if managesServer}
								<a
									href={resolve(routes.settingsServer)}
									class="group flex items-center justify-between gap-4 py-3"
									data-testid="settings-server-link"
								>
									<span class="min-w-0">
										<span class="block font-medium underline-offset-4 group-hover:underline">
											Server
										</span>
										<span class="block text-sm text-muted-foreground">
											Who can join, invites and new accounts
										</span>
									</span>
									<ChevronRight class="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
								</a>
							{/if}
						</CardContent>
					</Card>

					<Card variant="section" role="region" aria-labelledby="settings-storage">
						<CardHeader>
							<CardTitle level={2} id="settings-storage" class="text-base">
								Backups and storage
							</CardTitle>
							<CardAction>
								<a
									href={resolve(routes.settingsStorage)}
									class="text-sm font-semibold text-accent-ink underline-offset-4 hover:underline"
									aria-label="Manage backups and storage"
								>
									Manage
								</a>
							</CardAction>
						</CardHeader>
						<CardContent class="pb-3" data-testid="settings-storage-summary">
							<p class="font-medium">Storage you own</p>
							<p class="truncate text-sm text-muted-foreground">{storageSummary}</p>
						</CardContent>
					</Card>

					<Card variant="section" role="region" aria-labelledby="settings-ai">
						<CardHeader>
							<CardTitle level={2} id="settings-ai" class="text-base">AI helpers</CardTitle>
							<CardAction>
								<a
									href={resolve(routes.settingsAi)}
									class="text-sm font-semibold text-accent-ink underline-offset-4 hover:underline"
									aria-label="Manage AI helpers"
								>
									Manage
								</a>
							</CardAction>
						</CardHeader>
						<CardContent class="pb-3" data-testid="settings-ai-summary">
							<p class="font-medium">Receipt scanning and the assistant</p>
							<p class="text-sm text-muted-foreground">Optional, with your own provider and key</p>
						</CardContent>
					</Card>

					<Card variant="section" role="region" aria-labelledby="settings-data">
						<CardHeader>
							<CardTitle level={2} id="settings-data" class="text-base">Your data</CardTitle>
						</CardHeader>
						<CardContent class="divide-y">
							{#await migrateCard then { default: MigrateFromTrackerCard }}
								<MigrateFromTrackerCard />
							{:catch}
								<p
									class="py-3 text-sm text-destructive"
									role="alert"
									data-testid="migrate-load-error"
								>
									Couldn't load the migration tool. Check your connection and reload.
								</p>
							{/await}
							<div class="flex items-center justify-between gap-4 py-3">
								<div class="min-w-0">
									<p class="font-medium">Export everything</p>
									<p class="text-sm text-muted-foreground">
										A ZIP of CSV files you can restore later
									</p>
								</div>
								<Button variant="outline" onclick={handleBackup} disabled={isBackingUp}>
									{#if isBackingUp}
										<LoaderCircle class="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
										Exporting…
									{:else}
										Export
									{/if}
								</Button>
							</div>
							<PWAInstallCard />
							<PushNotificationsCard />
							<CalendarFeedCard />
						</CardContent>
					</Card>
				</div>
			</div>
		</div>
	{/if}
</div>
