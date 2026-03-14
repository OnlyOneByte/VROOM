<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { appStore } from '$lib/stores/app.svelte';
	import { authStore } from '$lib/stores/auth.svelte';
	import { routes } from '$lib/routes';
	import { Settings as SettingsIcon, Save, LoaderCircle, ChevronRight } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Avatar, AvatarFallback } from '$lib/components/ui/avatar';
	import UnitPreferencesCard from '$lib/components/settings/cards/UnitPreferencesCard.svelte';
	import ThemeCard from '$lib/components/settings/cards/ThemeCard.svelte';
	import PWAInstallCard from '$lib/components/settings/cards/PwaInstallCard.svelte';
	import BackupNowDialog from '$lib/components/settings/storage-provider/backup/BackupDialog.svelte';
	import UnifiedRestoreDialog from '$lib/components/settings/storage-provider/backup/RestoreDialog.svelte';
	import PhotoStorageSettings from '$lib/components/settings/cards/StorageProvidersCard.svelte';
	import { fetchLastSyncTime } from '$lib/utils/sync/sync-manager';
	import { providerApi } from '$lib/services/provider-api';
	import FormLayout from '$lib/components/common/form-layout.svelte';
	import { toast } from 'svelte-sonner';
	import type { BackupConfig, RestoreResult, UserProviderInfo } from '$lib/types';

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

	// Derive state from store
	let settings = $derived(settingsStore.settings);
	let isLoading = $derived(settingsStore.isLoading);

	let isSaving = $state(false);
	let isBackingUp = $state(false);

	// Unit preferences
	let distanceUnit = $state<'miles' | 'kilometers'>('miles');
	let volumeUnit = $state<'gallons_us' | 'gallons_uk' | 'liters'>('gallons_us');
	let chargeUnit = $state<'kwh'>('kwh');
	let currencyUnit = $state('USD');

	// Backup settings — derived from backupConfig
	let autoBackupEnabled = $state(false);
	let backupFrequency = $state<'daily' | 'weekly' | 'monthly'>('weekly');
	let syncInactivityMinutes = $state(5);

	// Provider state for backup card and restore dialog
	let storageProviders = $state<UserProviderInfo[]>([]);

	// Derived backup state from backupConfig
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

	// Dialog state
	let showBackupDialog = $state(false);
	let showRestoreDialog = $state(false);

	let isInitialized = $state(false);

	onMount(() => {
		settingsStore.load();
		loadProviders();
	});

	async function loadProviders() {
		try {
			storageProviders = await providerApi.getProviders('storage');
		} catch {
			// Non-critical
		}
	}

	$effect(() => {
		if (settings && !isInitialized) {
			distanceUnit = settings.unitPreferences.distanceUnit;
			volumeUnit = settings.unitPreferences.volumeUnit;
			chargeUnit = settings.unitPreferences.chargeUnit;
			currencyUnit = settings.currencyUnit;
			autoBackupEnabled = settings.autoBackupEnabled;
			backupFrequency = settings.backupFrequency;
			syncInactivityMinutes = settings.syncInactivityMinutes || 5;
			isInitialized = true;
		}
	});

	async function handleSave() {
		isSaving = true;
		try {
			await settingsStore.update({
				unitPreferences: { distanceUnit, volumeUnit, chargeUnit },
				currencyUnit,
				autoBackupEnabled,
				backupFrequency,
				syncOnInactivity: backupProvidersEnabled || sheetsSyncEnabled,
				syncInactivityMinutes
			});
			await fetchLastSyncTime();
			isInitialized = false;
			appStore.showSuccess('Settings saved successfully');
		} catch {
			appStore.showError('Failed to save settings');
		} finally {
			isSaving = false;
		}
	}

	async function handleBackup() {
		isBackingUp = true;
		try {
			await settingsStore.downloadBackup();
			appStore.showSuccess('Backup downloaded successfully');
		} catch {
			appStore.showError('Failed to create backup');
		} finally {
			isBackingUp = false;
		}
	}

	function handleBackupNowClick() {
		showBackupDialog = true;
	}

	async function handleBackupExecute() {
		showBackupDialog = false;
		const toastId = toast.loading('Backup in progress...');

		try {
			const result = await settingsStore.executeSync(['backup'], true);
			const data = result?.data;

			if (data) {
				if (data.status === 'in_progress') {
					toast.error('A backup is already in progress', { id: toastId });
					return;
				}

				if (data.skipped) {
					toast.info('No changes since last backup — skipped', { id: toastId });
					return;
				}

				const successCount = Object.values(data.results).filter(r => r.success).length;
				const failCount = Object.values(data.results).filter(r => !r.success).length;

				if (failCount > 0) {
					toast.error(`${failCount} provider${failCount > 1 ? 's' : ''} failed`, {
						id: toastId
					});
				} else if (successCount > 0) {
					toast.success(`Backed up to ${successCount} provider${successCount > 1 ? 's' : ''}`, {
						id: toastId
					});
				}
			} else {
				toast.success('Backup complete', { id: toastId });
			}

			await fetchLastSyncTime();
			await settingsStore.load();
			isInitialized = false;
		} catch (error) {
			const msg = error instanceof Error ? error.message : 'Failed to execute backup';
			if (msg.includes('BACKUP_IN_PROGRESS') || msg.includes('backup is already in progress')) {
				toast.error('A backup is already in progress. Please try again later.', { id: toastId });
			} else {
				toast.error(msg, { id: toastId });
			}
		}
	}

	function handleRestoreClick() {
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

<FormLayout>
	<div class="mb-6">
		<h1 class="text-3xl font-bold text-foreground flex items-center gap-3">
			<SettingsIcon class="h-8 w-8 text-primary" />Settings
		</h1>
		<p class="text-muted-foreground mt-2">Manage your preferences and data</p>
	</div>

	{#if isLoading}
		<div class="flex items-center justify-center py-12">
			<LoaderCircle class="h-8 w-8 animate-spin text-primary" />
		</div>
	{:else}
		<div class="space-y-6 pb-32 sm:pb-24">
			<a href={resolve(routes.profile)} class="block w-full text-left">
				<Card class="hover:bg-accent/50 transition-colors cursor-pointer">
					<CardContent class="flex items-center gap-4 py-5">
						<Avatar class="h-12 w-12"
							><AvatarFallback class="bg-primary/10 text-primary text-sm font-medium"
								>{initials}</AvatarFallback
							></Avatar
						>
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
			<UnitPreferencesCard bind:distanceUnit bind:volumeUnit bind:chargeUnit bind:currencyUnit />
			<PWAInstallCard />
			<PhotoStorageSettings
				{isBackingUp}
				bind:syncInactivityMinutes
				onBackupNow={handleBackupNowClick}
				onRestore={handleRestoreClick}
				onDownloadBackup={handleBackup}
			/>
		</div>
	{/if}

	<Button
		onclick={handleSave}
		disabled={isSaving}
		class="fixed sm:bottom-8 sm:right-8 bottom-4 left-4 right-4 sm:left-auto sm:w-auto w-auto sm:rounded-full rounded-full group bg-foreground hover:bg-foreground/90 text-background shadow-2xl transition-all duration-300 sm:hover:scale-110 z-50 h-16 sm:h-16 pl-6 pr-10 border-0 justify-center disabled:opacity-50 disabled:cursor-not-allowed"
	>
		{#if isSaving}
			<LoaderCircle class="h-6 w-6 animate-spin transition-transform duration-300" />
			<span class="font-bold text-lg">Saving...</span>
		{:else}
			<Save class="h-6 w-6 transition-transform duration-300 group-hover:scale-110" />
			<span class="font-bold text-lg">Save Settings</span>
		{/if}
	</Button>

	<BackupNowDialog
		bind:open={showBackupDialog}
		{backupProvidersEnabled}
		onSync={handleBackupExecute}
	/>

	<UnifiedRestoreDialog
		bind:open={showRestoreDialog}
		{backupProviders}
		{sheetsSyncEnabled}
		onRestore={handleRestoreComplete}
		onClose={() => {}}
	/>
</FormLayout>
