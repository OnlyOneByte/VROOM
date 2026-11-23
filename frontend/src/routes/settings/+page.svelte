<script lang="ts">
	import { onMount } from 'svelte';
	import { trackPendingSave } from '#lib/utils/pending-saves.ts';
	import PageHeader from '#lib/components/common/page-header.svelte';
	import { resolve } from '$app/paths';
	import { settingsStore } from '#lib/stores/settings.svelte.ts';
	import { appStore } from '#lib/stores/app.svelte.ts';
	import { userFacingErrorMessage } from '#lib/utils/error-handling.ts';
	import { authStore } from '#lib/stores/auth.svelte.ts';
	import { routes } from '#lib/routes.ts';
	import { LoaderCircle, ChevronRight, CircleAlert } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Card, CardContent } from '#lib/components/ui/card/index.ts';
	import { Avatar, AvatarFallback } from '#lib/components/ui/avatar/index.ts';
	import UnitPreferencesCard from '#lib/components/settings/cards/UnitPreferencesCard.svelte';
	import ThemeCard from '#lib/components/settings/cards/ThemeCard.svelte';
	import ThemePickerCard from '#lib/components/settings/cards/ThemePickerCard.svelte';
	import PWAInstallCard from '#lib/components/settings/cards/PwaInstallCard.svelte';
	import PushNotificationsCard from '#lib/components/settings/cards/PushNotificationsCard.svelte';
	import PhotoStorageSettings from '#lib/components/settings/cards/StorageProvidersCard.svelte';
	import ModelProvidersCard from '#lib/components/settings/cards/ModelProvidersCard.svelte';
	import { fetchLastSyncTime } from '#lib/utils/sync/sync-manager.ts';
	import { providerApi } from '#lib/services/provider-api.ts';
	import FormLayout from '#lib/components/common/form-layout.svelte';
	import { toast } from 'svelte-sonner';
	import type {
		BackupConfig,
		RestoreResult,
		UserProviderInfo,
		UserSettings
	} from '#lib/types/index.ts';

	let user = $derived(authStore.user);

	let initials = $derived.by(() => {
		if (!user?.displayName) return '?';
		return user.displayName
			.split(' ')
			.map((n: string) => n[0])
			.join('')
			.toUpperCase()
			.slice(0, 2);
	});

	let settings = $derived(settingsStore.settings);
	let loadError = $derived(settingsStore.error && !settings ? settingsStore.error : null);

	let savesInFlight = $state(0);

	onMount(() => trackPendingSave(() => savesInFlight > 0));
	let isBackingUp = $state(false);

	let distanceUnit = $state<'miles' | 'kilometers'>('miles');
	let volumeUnit = $state<'gallons_us' | 'gallons_uk' | 'liters'>('gallons_us');
	let chargeUnit = $state<'kwh'>('kwh');
	let currencyUnit = $state('USD');

	let syncInactivityMinutes = $state(5);

	let storageProviders = $state<UserProviderInfo[]>([]);

	let backupConfig = $derived<BackupConfig>(settings?.backupConfig ?? { providers: {} });

	let backupProvidersEnabled = $derived(Object.values(backupConfig.providers).some(p => p.enabled));

	let sheetsSyncEnabled = $derived(
		Object.values(backupConfig.providers).some(p => p.sheetsSyncEnabled)
	);

	let backupProviders = $derived.by(() => {
		const enabledIds = Object.entries(backupConfig.providers)
			.filter(([, s]) => s.enabled)
			.map(([id]) => id);
		return storageProviders
			.filter(p => enabledIds.includes(p.id))
			.map(p => ({ id: p.id, displayName: p.displayName, providerType: p.providerType }));
	});

	let showBackupDialog = $state(false);
	let showRestoreDialog = $state(false);

	type BackupDialogModule =
		typeof import('#lib/components/settings/storage-provider/backup/BackupDialog.svelte');
	type RestoreDialogModule =
		typeof import('#lib/components/settings/storage-provider/backup/RestoreDialog.svelte');
	let backupDialog = $state<Promise<BackupDialogModule | null> | null>(null);
	let restoreDialog = $state<Promise<RestoreDialogModule | null> | null>(null);

	const migrateCard = import('#lib/components/settings/cards/MigrateFromTrackerCard.svelte');
	migrateCard.catch(() => undefined);

	function dialogLoadFailed(error: unknown) {
		appStore.showError(`Couldn't open this dialog. ${userFacingErrorMessage(error)}`);
	}

	let isInitialized = $state(false);

	onMount(() => {
		settingsStore.load();
		loadProviders();
	});

	function retryLoad() {
		settingsStore.load();
		loadProviders();
	}

	async function loadProviders() {
		try {
			storageProviders = await providerApi.getProviders('storage');
		} catch {
			// Leave the list empty; the page already renders its empty state.
		}
	}

	$effect(() => {
		if (settings && !isInitialized) {
			distanceUnit = settings.unitPreferences.distanceUnit;
			volumeUnit = settings.unitPreferences.volumeUnit;
			chargeUnit = settings.unitPreferences.chargeUnit;
			currencyUnit = settings.currencyUnit;
			syncInactivityMinutes = settings.syncInactivityMinutes || 5;
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

	function saveSyncInterval() {
		void saveSettings({ syncInactivityMinutes }, 'Backup timing saved');
	}

	let syncOnInactivityRequested = false;

	$effect(() => {
		if (!settings || syncOnInactivityRequested || settings.syncOnInactivity !== false) return;
		if (!backupProvidersEnabled && !sheetsSyncEnabled) return;
		syncOnInactivityRequested = true;
		persist({ syncOnInactivity: true }).catch(() => {
			syncOnInactivityRequested = false;
		});
	});

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

	function handleBackupNowClick() {
		backupDialog ??=
			import('#lib/components/settings/storage-provider/backup/BackupDialog.svelte').catch(
				error => {
					backupDialog = null;
					showBackupDialog = false;
					dialogLoadFailed(error);
					return null;
				}
			);
		showBackupDialog = true;
	}

	async function handleBackupExecute() {
		showBackupDialog = false;
		const toastId = toast.loading('Backup in progress...');

		try {
			const data = await settingsStore.executeSync(['backup'], true);
			const providers = (count: number) => `${count} provider${count === 1 ? '' : 's'}`;
			const nameOf = (id: string) =>
				storageProviders.find(provider => provider.id === id)?.displayName ?? id;

			if (data.outcome === 'success') {
				toast.success(`Backed up to ${providers(Object.keys(data.results).length)}`, {
					id: toastId
				});
			} else if (data.outcome === 'partial') {
				const succeeded = Object.values(data.results).filter(r => r.success).length;
				toast.warning(
					`Backed up to ${providers(succeeded)}. ${data.failedProviders.map(nameOf).join(', ')} failed.`,
					{ id: toastId }
				);
			} else if (data.outcome === 'noop') {
				toast.info('Nothing to back up: no provider has backups turned on', { id: toastId });
			} else {
				toast.error(`Backup failed for ${data.failedProviders.map(nameOf).join(', ')}`, {
					id: toastId
				});
			}

			await fetchLastSyncTime();
			await settingsStore.load();
			isInitialized = false;
		} catch (error) {
			toast.dismiss(toastId);
			appStore.showError(`Couldn't back up. ${userFacingErrorMessage(error)}`);
		}
	}

	function handleRestoreClick() {
		restoreDialog ??=
			import('#lib/components/settings/storage-provider/backup/RestoreDialog.svelte').catch(
				error => {
					restoreDialog = null;
					showRestoreDialog = false;
					dialogLoadFailed(error);
					return null;
				}
			);
		showRestoreDialog = true;
	}

	function handleRestoreComplete(result: RestoreResult) {
		if (result.imported) {
			const total = Object.values(result.imported).reduce((sum, count) => sum + count, 0);
			appStore.showSuccess(`Successfully restored ${total} records`);
		}
		settingsStore.load();
		isInitialized = false;
	}
</script>

<svelte:head>
	<title>Settings - VROOM Car Tracker</title>
	<meta name="description" content="Manage your preferences, units, and storage providers" />
</svelte:head>

<FormLayout>
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
			<a href={resolve(routes.profile)} class="block w-full text-left">
				<Card class="hover:bg-accent/50 transition-colors cursor-pointer">
					<CardContent class="flex items-center gap-4 py-5">
						<Avatar class="h-12 w-12">
							<AvatarFallback class="bg-primary/10 text-primary text-sm font-medium">
								{initials}
							</AvatarFallback>
						</Avatar>
						<div class="flex-1 min-w-0">
							<p class="text-sm font-semibold text-foreground truncate">
								{user?.displayName ?? 'User'}
							</p>
							<p class="text-xs text-muted-foreground truncate">
								{user?.email ?? 'Account & profile settings'}
							</p>
						</div>
						<ChevronRight class="h-5 w-5 text-muted-foreground flex-shrink-0" />
					</CardContent>
				</Card>
			</a>

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
			<PWAInstallCard />
			<PushNotificationsCard />
			{#await migrateCard then { default: MigrateFromTrackerCard }}
				<MigrateFromTrackerCard />
			{:catch}
				<p
					class="rounded-lg border bg-card p-6 text-sm text-destructive"
					role="alert"
					data-testid="migrate-load-error"
				>
					Couldn't load the migration tool. Check your connection and reload.
				</p>
			{/await}
			<section class="space-y-4" aria-labelledby="settings-connections">
				<div>
					<h2 id="settings-connections" class="text-lg font-semibold">Connections</h2>
					<p class="text-sm text-muted-foreground">
						Storage and AI services you connect with your own account or key.
					</p>
				</div>
				<PhotoStorageSettings
					{isBackingUp}
					bind:syncInactivityMinutes
					onSyncInactivityChange={saveSyncInterval}
					onBackupNow={handleBackupNowClick}
					onRestore={handleRestoreClick}
					onDownloadBackup={handleBackup}
				/>
				<ModelProvidersCard domain="vlm" />
				<ModelProvidersCard domain="llm" />
			</section>
		</div>
	{/if}

	{#if backupDialog}
		{#await backupDialog then module}
			{#if module}
				<module.default
					bind:open={showBackupDialog}
					{backupProvidersEnabled}
					onSync={handleBackupExecute}
				/>
			{/if}
		{/await}
	{/if}

	{#if restoreDialog}
		{#await restoreDialog then module}
			{#if module}
				<module.default
					bind:open={showRestoreDialog}
					{backupProviders}
					{sheetsSyncEnabled}
					onRestore={handleRestoreComplete}
					onClose={() => {}}
				/>
			{/if}
		{/await}
	{/if}
</FormLayout>
