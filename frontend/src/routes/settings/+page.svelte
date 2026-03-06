<script lang="ts">
	import { onMount } from 'svelte';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { appStore } from '$lib/stores/app.svelte';
	import { Settings as SettingsIcon, Save, LoaderCircle } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import UnitPreferencesCard from '$lib/components/settings/UnitPreferencesCard.svelte';
	import ThemeCard from '$lib/components/settings/ThemeCard.svelte';
	import PWAInstallCard from '$lib/components/settings/PWAInstallCard.svelte';
	import BackupSyncCard from '$lib/components/settings/BackupSyncCard.svelte';
	import BackupNowDialog from '$lib/components/settings/BackupNowDialog.svelte';
	import RestoreDialog from '$lib/components/settings/RestoreDialog.svelte';
	import { fetchLastSyncTime } from '$lib/utils/sync-manager';
	import { settingsApi } from '$lib/services/settings-api';
	import { isVroomError } from '$lib/utils/error-handling';

	function extractValidationErrors(error: unknown): string | null {
		if (isVroomError(error) && error.details) {
			const errors = error.details['validationErrors'];
			if (Array.isArray(errors) && errors.length > 0) {
				return (
					errors.slice(0, 5).join(', ') + (errors.length > 5 ? ` (+${errors.length - 5} more)` : '')
				);
			}
		}
		return null;
	}

	// Derive state directly from store
	let settings = $derived(settingsStore.settings);
	let isLoading = $derived(settingsStore.isLoading);

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
	let googleDriveCustomFolderName = $state('');
	let googleSheetsSyncEnabled = $state(false);
	let syncInactivityMinutes = $state(5);

	// Dialog state
	let showRestoreDialog = $state(false);
	let showDriveRestoreDialog = $state(false);
	let showSheetsRestoreDialog = $state(false);
	let showBackupDialog = $state(false);
	let selectedFile = $state<File | null>(null);
	let restoreMode = $state<'preview' | 'replace' | 'merge'>('replace');
	let restorePreview = $state<Record<string, number | undefined> | null>(null);
	let restoreConflicts = $state<Array<{ table?: string; id?: string; field?: string }>>([]);
	let syncSheets = $state(true);
	let syncBackup = $state(true);
	let sheetsRestorePreview = $state<Record<string, number | undefined> | null>(null);
	let sheetsRestoreConflicts = $state<Array<{ table?: string; id?: string; field?: string }>>([]);
	let sheetsRestoreMode = $state<'preview' | 'replace' | 'merge'>('replace');
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
			distanceUnit = settings.unitPreferences.distanceUnit;
			volumeUnit = settings.unitPreferences.volumeUnit;
			chargeUnit = settings.unitPreferences.chargeUnit;
			currencyUnit = settings.currencyUnit;
			autoBackupEnabled = settings.autoBackupEnabled;
			backupFrequency = settings.backupFrequency;
			googleDriveBackupEnabled = settings.googleDriveBackupEnabled;
			googleDriveBackupRetentionCount = settings.googleDriveBackupRetentionCount || 10;
			googleDriveCustomFolderName = settings.googleDriveCustomFolderName || '';
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
				unitPreferences: {
					distanceUnit,
					volumeUnit,
					chargeUnit
				},
				currencyUnit,
				autoBackupEnabled,
				backupFrequency,
				googleDriveBackupRetentionCount,
				googleDriveCustomFolderName: googleDriveCustomFolderName || null
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
				} catch (error) {
					appStore.showError(error instanceof Error ? error.message : 'Failed to preview backup');
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
		} catch (error) {
			appStore.showError(error instanceof Error ? error.message : 'Failed to restore backup');
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
		} catch (error) {
			appStore.showError(error instanceof Error ? error.message : 'Failed to preview backup');
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
		} catch (error) {
			appStore.showError(error instanceof Error ? error.message : 'Failed to restore backup');
		} finally {
			isRestoring = false;
		}
	}

	// --- Sheets restore ---
	function handleRestoreFromSheetsClick() {
		showSheetsRestoreDialog = true;
		sheetsRestorePreview = null;
		sheetsRestoreConflicts = [];
		sheetsRestoreMode = 'replace';
	}

	async function handleSheetsRestorePreview() {
		isRestoring = true;
		try {
			const idempotencyKey = `restore-sheets-preview-${Date.now()}`;
			const result = await settingsApi.restoreFromSheets('preview', idempotencyKey);
			const data = result?.data || result;
			if (data.success && data.preview) sheetsRestorePreview = data.preview;
			if (data.conflicts && data.conflicts.length > 0) sheetsRestoreConflicts = data.conflicts;
		} catch (error) {
			const validationErrors = extractValidationErrors(error);
			if (validationErrors) {
				appStore.showError(`Google Sheets validation failed:\n${validationErrors}`);
			} else {
				appStore.showError(
					error instanceof Error ? error.message : 'Failed to preview Google Sheets data'
				);
			}
		} finally {
			isRestoring = false;
		}
	}

	async function handleSheetsRestoreExecute() {
		isRestoring = true;
		try {
			const idempotencyKey = `restore-sheets-${sheetsRestoreMode}-${Date.now()}`;
			const result = await settingsApi.restoreFromSheets(sheetsRestoreMode, idempotencyKey);
			const data = result?.data || result;
			if (data.success && data.imported) {
				const imported = data.imported as Record<string, number>;
				const total = Object.values(imported).reduce((sum, count) => sum + count, 0);
				appStore.showSuccess(`Successfully restored ${total} records from Google Sheets`);
				showSheetsRestoreDialog = false;
				sheetsRestorePreview = null;
				sheetsRestoreConflicts = [];
			}
		} catch (error) {
			appStore.showError(
				error instanceof Error ? error.message : 'Failed to restore from Google Sheets'
			);
		} finally {
			isRestoring = false;
		}
	}

	// --- Backup now ---
	function handleBackupNowClick() {
		syncSheets = googleSheetsSyncEnabled;
		syncBackup = googleDriveBackupEnabled;
		syncResults = null;
		showBackupDialog = true;
	}

	async function handleBackupExecute() {
		isSyncing = true;
		syncResults = null;
		try {
			const syncTypes: ('sheets' | 'backup')[] = [];
			if (syncSheets) syncTypes.push('sheets');
			if (syncBackup) syncTypes.push('backup');

			if (syncTypes.length === 0) {
				appStore.showError('Please select at least one backup type');
				return;
			}

			const result = await settingsStore.executeSync(syncTypes, true);
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
					successMessages.push(type === 'sheets' ? 'Google Sheets' : 'Google Drive');
				} else if (!typeResult.success) {
					const typeName = type === 'sheets' ? 'Google Sheets' : 'Google Drive';
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
				appStore.showSuccess(`Successfully backed up to ${successMessages.join(' and ')}`);
			}

			await fetchLastSyncTime();
			await settingsStore.load();
			isInitialized = false;
		} catch (error) {
			appStore.showError(error instanceof Error ? error.message : 'Failed to execute backup');
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
			<ThemeCard />

			<UnitPreferencesCard bind:distanceUnit bind:volumeUnit bind:chargeUnit bind:currencyUnit />

			<PWAInstallCard />

			<BackupSyncCard
				{settings}
				{isBackingUp}
				bind:googleDriveBackupEnabled
				bind:googleDriveBackupRetentionCount
				bind:googleDriveCustomFolderName
				bind:googleSheetsSyncEnabled
				bind:syncInactivityMinutes
				onBackup={handleBackup}
				onRestoreClick={handleRestoreClick}
				onRestoreFromDriveClick={handleRestoreFromDriveClick}
				onRestoreFromSheetsClick={handleRestoreFromSheetsClick}
				onBackupNowClick={handleBackupNowClick}
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

	<RestoreDialog
		bind:open={showRestoreDialog}
		source="file"
		{isRestoring}
		bind:restoreMode
		{restorePreview}
		{restoreConflicts}
		{selectedFile}
		onFileSelect={handleFileSelect}
		onRestore={handleRestoreExecute}
	/>

	<RestoreDialog
		bind:open={showDriveRestoreDialog}
		source="drive"
		{isRestoring}
		bind:restoreMode
		{restorePreview}
		{restoreConflicts}
		{isLoadingBackups}
		{driveBackups}
		selectedBackupId={selectedDriveBackup}
		onBackupSelect={handleDriveBackupSelect}
		onRestore={handleDriveRestoreExecute}
	/>

	<BackupNowDialog
		bind:open={showBackupDialog}
		{isSyncing}
		bind:syncSheets
		bind:syncBackup
		{googleSheetsSyncEnabled}
		{googleDriveBackupEnabled}
		{syncResults}
		onSync={handleBackupExecute}
	/>

	<RestoreDialog
		bind:open={showSheetsRestoreDialog}
		source="sheets"
		{isRestoring}
		bind:restoreMode={sheetsRestoreMode}
		restorePreview={sheetsRestorePreview}
		restoreConflicts={sheetsRestoreConflicts}
		onPreview={handleSheetsRestorePreview}
		onRestore={handleSheetsRestoreExecute}
	/>
</div>
