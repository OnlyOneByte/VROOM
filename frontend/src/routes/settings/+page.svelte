<script lang="ts">
	import { onMount } from 'svelte';
	import { settingsStore } from '$lib/stores/settings.js';
	import { appStore } from '$lib/stores/app.js';
	import { Settings as SettingsIcon, Save, LoaderCircle } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import UnitPreferencesCard from '$lib/components/settings/UnitPreferencesCard.svelte';
	import PWAInstallCard from '$lib/components/settings/PWAInstallCard.svelte';
	import BackupSyncCard from '$lib/components/settings/BackupSyncCard.svelte';
	import SyncNowDialog from '$lib/components/settings/SyncNowDialog.svelte';
	import RestoreFromFileDialog from '$lib/components/settings/RestoreFromFileDialog.svelte';
	import RestoreFromDriveDialog from '$lib/components/settings/RestoreFromDriveDialog.svelte';
	import { fetchLastSyncTime } from '$lib/utils/sync-manager';

	// Derive state directly from store
	let settings = $derived($settingsStore.settings);
	let isLoading = $derived($settingsStore.isLoading);

	let isSaving = $state(false);
	let isBackingUp = $state(false);
	let isRestoring = $state(false);
	let isSyncing = $state(false);

	// Unit preferences
	let distanceUnit = $state<'miles' | 'kilometers'>('miles');
	let volumeUnit = $state<'gallons_us' | 'gallons_uk' | 'liters'>('gallons_us');
	let chargeUnit = $state<'kwh'>('kwh');
	let currencyUnit = $state('USD');

	// Backup/sync settings
	let autoBackupEnabled = $state(false);
	let backupFrequency = $state<'daily' | 'weekly' | 'monthly'>('weekly');
	let googleDriveBackupEnabled = $state(false);
	let googleDriveBackupRetentionCount = $state(10);
	let googleSheetsSyncEnabled = $state(false);
	let syncInactivityMinutes = $state(5);

	// Dialog state
	let showRestoreDialog = $state(false);
	let showDriveRestoreDialog = $state(false);
	let showSyncDialog = $state(false);
	let selectedFile = $state<File | null>(null);
	let restoreMode = $state<'preview' | 'replace' | 'merge'>('replace');
	let restorePreview = $state<Record<string, number | undefined> | null>(null);
	let restoreConflicts = $state<Array<{ table?: string; id?: string; field?: string }>>([]);
	let syncSheets = $state(true);
	let syncBackup = $state(true);
	let syncResults = $state<{
		success: boolean;
		data?: {
			results: Record<string, { success: boolean; message?: string; skipped?: boolean }>;
		};
	} | null>(null);
	let driveBackups = $state<
		Array<{
			fileId: string;
			fileName: string;
			size: string;
			createdTime: string;
			modifiedTime: string;
		}>
	>([]);
	let isLoadingBackups = $state(false);
	let selectedDriveBackup = $state<string | null>(null);

	let isInitialized = $state(false);

	onMount(() => {
		settingsStore.load();
	});

	$effect(() => {
		if (settings && !isInitialized) {
			distanceUnit = settings.distanceUnit;
			volumeUnit = settings.volumeUnit;
			chargeUnit = settings.chargeUnit;
			currencyUnit = settings.currencyUnit;
			autoBackupEnabled = settings.autoBackupEnabled;
			backupFrequency = settings.backupFrequency;
			googleDriveBackupEnabled = settings.googleDriveBackupEnabled;
			googleDriveBackupRetentionCount = settings.googleDriveBackupRetentionCount || 10;
			googleSheetsSyncEnabled = settings.googleSheetsSyncEnabled || false;
			syncInactivityMinutes = settings.syncInactivityMinutes || 5;
			isInitialized = true;

			if (settings.googleDriveBackupEnabled && !settings.googleDriveBackupFolderId) {
				settingsStore.initializeDrive().catch(() => {});
			}
		}
	});

	// --- Save ---
	async function handleSave() {
		isSaving = true;
		try {
			await settingsStore.configureSyncSettings({
				googleSheetsSyncEnabled,
				googleDriveBackupEnabled,
				syncInactivityMinutes
			});

			const hadFolderId = settings?.googleDriveBackupFolderId;
			if (googleDriveBackupEnabled && !hadFolderId) {
				try {
					await settingsStore.initializeDrive();
				} catch {
					appStore.showError(
						'Failed to initialize Google Drive. Make sure your Google account has Drive access.'
					);
				}
			}

			await settingsStore.update({
				distanceUnit,
				volumeUnit,
				chargeUnit,
				currencyUnit,
				autoBackupEnabled,
				backupFrequency,
				googleDriveBackupRetentionCount
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

	// --- Backup ---
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

	// --- File restore ---
	function handleRestoreClick() {
		showRestoreDialog = true;
		restorePreview = null;
		restoreConflicts = [];
		selectedFile = null;
		restoreMode = 'replace';
	}

	async function handleFileSelect(event: Event) {
		const target = event.target as HTMLInputElement;
		if (target.files && target.files.length > 0) {
			selectedFile = target.files[0] || null;
			if (selectedFile) {
				isRestoring = true;
				try {
					const result = await settingsStore.uploadBackup(selectedFile, 'preview');
					const data = result?.data || result;
					if (data.success && data.preview) restorePreview = data.preview;
					if (data.conflicts && data.conflicts.length > 0) restoreConflicts = data.conflicts;
				} catch {
					appStore.showError('Failed to preview backup');
				} finally {
					isRestoring = false;
				}
			}
		} else {
			selectedFile = null;
			restorePreview = null;
			restoreConflicts = [];
		}
	}

	async function handleRestoreExecute() {
		if (!selectedFile) return;
		isRestoring = true;
		try {
			const result = await settingsStore.uploadBackup(selectedFile, restoreMode);
			const data = result?.data || result;
			if (data.success && data.imported) {
				const imported = data.imported as Record<string, number>;
				const total = Object.values(imported).reduce((sum, count) => sum + count, 0);
				appStore.showSuccess(`Successfully restored ${total} records`);
				showRestoreDialog = false;
				selectedFile = null;
				restorePreview = null;
				restoreConflicts = [];
			}
		} catch {
			appStore.showError('Failed to restore backup');
		} finally {
			isRestoring = false;
		}
	}

	// --- Drive restore ---
	async function handleRestoreFromDriveClick() {
		showDriveRestoreDialog = true;
		selectedDriveBackup = null;
		restorePreview = null;
		restoreConflicts = [];
		restoreMode = 'replace';
		isLoadingBackups = true;
		try {
			const backups = await settingsStore.listBackups();
			driveBackups = (Array.isArray(backups) ? backups : []).map(b => ({
				fileId: b.fileId,
				fileName: b.fileName,
				size: b.size,
				createdTime: b.createdTime,
				modifiedTime: b.modifiedTime
			}));
		} catch (error) {
			appStore.showError(
				error instanceof Error ? error.message : 'Failed to load backups from Google Drive'
			);
		} finally {
			isLoadingBackups = false;
		}
	}

	async function handleDriveBackupSelect(fileId: string) {
		selectedDriveBackup = fileId;
		restorePreview = null;
		restoreConflicts = [];
		isRestoring = true;
		try {
			const result = await settingsStore.restoreFromDriveBackup(fileId, 'preview');
			const data = result?.data || result;
			if (data.success && data.preview) restorePreview = data.preview;
			if (data.conflicts && data.conflicts.length > 0) restoreConflicts = data.conflicts;
		} catch {
			appStore.showError('Failed to preview backup');
		} finally {
			isRestoring = false;
		}
	}

	async function handleDriveRestoreExecute() {
		if (!selectedDriveBackup) return;
		isRestoring = true;
		try {
			const result = await settingsStore.restoreFromDriveBackup(selectedDriveBackup, restoreMode);
			const data = result?.data || result;
			if (data.success && data.imported) {
				const imported = data.imported as Record<string, number>;
				const total = Object.values(imported).reduce((sum, count) => sum + count, 0);
				appStore.showSuccess(`Successfully restored ${total} records`);
				showDriveRestoreDialog = false;
				selectedDriveBackup = null;
				restorePreview = null;
				restoreConflicts = [];
			}
		} catch {
			appStore.showError('Failed to restore backup');
		} finally {
			isRestoring = false;
		}
	}

	// --- Sync ---
	function handleSyncNowClick() {
		syncSheets = googleSheetsSyncEnabled;
		syncBackup = googleDriveBackupEnabled;
		syncResults = null;
		showSyncDialog = true;
	}

	async function handleSyncExecute() {
		isSyncing = true;
		syncResults = null;
		try {
			const syncTypes: ('sheets' | 'backup')[] = [];
			if (syncSheets) syncTypes.push('sheets');
			if (syncBackup) syncTypes.push('backup');

			if (syncTypes.length === 0) {
				appStore.showError('Please select at least one sync type');
				return;
			}

			const result = await settingsStore.executeSync(syncTypes);
			syncResults = result;

			const results = result?.data?.results;
			if (!results) return;

			const successMessages: string[] = [];
			let hasAuthError = false;

			for (const [type, typeResult] of Object.entries(results) as [
				string,
				{ success: boolean; message?: string; skipped?: boolean }
			][]) {
				if (typeResult.success && !typeResult.skipped) {
					successMessages.push(type === 'sheets' ? 'Google Sheets' : 'Google Drive backup');
				} else if (!typeResult.success) {
					const typeName = type === 'sheets' ? 'Google Sheets' : 'Google Drive backup';
					appStore.showError(`${typeName}: ${typeResult.message || 'Failed'}`);
					if (typeResult.message?.includes('re-authenticate')) hasAuthError = true;
				}
			}

			if (hasAuthError) {
				appStore.showError(
					'Google Drive access expired. Click "Re-authenticate with Google" below.'
				);
			}
			if (successMessages.length > 0) {
				appStore.showSuccess(`Successfully synced to ${successMessages.join(' and ')}`);
			}

			await fetchLastSyncTime();
			await settingsStore.load();
			isInitialized = false;
		} catch (error) {
			appStore.showError(error instanceof Error ? error.message : 'Failed to execute sync');
		} finally {
			isSyncing = false;
		}
	}

	function handleReauthenticate() {
		window.location.href = '/api/v1/auth/reauth/google';
	}
</script>

<div class="max-w-4xl mx-auto">
	<div class="mb-6">
		<h1 class="text-3xl font-bold text-foreground flex items-center gap-3">
			<SettingsIcon class="h-8 w-8 text-primary" />
			Settings
		</h1>
		<p class="text-muted-foreground mt-2">Manage your preferences and data</p>
	</div>

	{#if isLoading}
		<div class="flex items-center justify-center py-12">
			<LoaderCircle class="h-8 w-8 animate-spin text-primary" />
		</div>
	{:else}
		<div class="space-y-6 pb-32 sm:pb-24">
			<UnitPreferencesCard bind:distanceUnit bind:volumeUnit bind:chargeUnit bind:currencyUnit />

			<PWAInstallCard />

			<BackupSyncCard
				{settings}
				{isBackingUp}
				bind:googleDriveBackupEnabled
				bind:googleDriveBackupRetentionCount
				bind:googleSheetsSyncEnabled
				bind:syncInactivityMinutes
				onBackup={handleBackup}
				onRestoreClick={handleRestoreClick}
				onRestoreFromDriveClick={handleRestoreFromDriveClick}
				onSyncNowClick={handleSyncNowClick}
				onReauthenticate={handleReauthenticate}
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

	<RestoreFromFileDialog
		bind:open={showRestoreDialog}
		{isRestoring}
		{selectedFile}
		bind:restoreMode
		{restorePreview}
		{restoreConflicts}
		onFileSelect={handleFileSelect}
		onRestore={handleRestoreExecute}
	/>

	<RestoreFromDriveDialog
		bind:open={showDriveRestoreDialog}
		{isLoadingBackups}
		{isRestoring}
		{driveBackups}
		selectedBackupId={selectedDriveBackup}
		bind:restoreMode
		{restorePreview}
		{restoreConflicts}
		onBackupSelect={handleDriveBackupSelect}
		onRestore={handleDriveRestoreExecute}
	/>

	<SyncNowDialog
		bind:open={showSyncDialog}
		{isSyncing}
		bind:syncSheets
		bind:syncBackup
		{googleSheetsSyncEnabled}
		{googleDriveBackupEnabled}
		{syncResults}
		onSync={handleSyncExecute}
	/>
</div>
