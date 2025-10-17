<script lang="ts">
	import { onMount } from 'svelte';
	import { settingsStore } from '$lib/stores/settings.js';
	import { appStore } from '$lib/stores/app.js';
	import {
		Settings as SettingsIcon,
		Globe,
		Fuel,
		DollarSign,
		Database,
		Download,
		Upload,
		Save,
		LoaderCircle,
		RefreshCw
	} from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import { Switch } from '$lib/components/ui/switch';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import SyncNowDialog from '$lib/components/settings/SyncNowDialog.svelte';
	import RestoreFromFileDialog from '$lib/components/settings/RestoreFromFileDialog.svelte';
	import RestoreFromDriveDialog from '$lib/components/settings/RestoreFromDriveDialog.svelte';

	// Derive state directly from store
	let settings = $derived($settingsStore.settings);
	let isLoading = $derived($settingsStore.isLoading);

	let isSaving = $state(false);
	let isBackingUp = $state(false);
	let isRestoring = $state(false);
	let isSyncing = $state(false);
	let showRestoreDialog = $state(false);
	let selectedFile = $state<File | null>(null);
	let restoreMode = $state<'preview' | 'replace' | 'merge'>('preview');
	let restorePreview = $state<any>(null);
	let restoreConflicts = $state<any[]>([]);
	let showSyncDialog = $state(false);
	let syncSheets = $state(true);
	let syncBackup = $state(true);
	let syncResults = $state<any>(null);

	// Form state - derive from settings
	let distanceUnit = $state<'miles' | 'kilometers'>('miles');
	let volumeUnit = $state<'gallons_us' | 'gallons_uk' | 'liters'>('gallons_us');
	let chargeUnit = $state<'kwh'>('kwh');
	let currencyUnit = $state('USD');
	let autoBackupEnabled = $state(false);
	let backupFrequency = $state<'daily' | 'weekly' | 'monthly'>('weekly');
	let googleDriveBackupEnabled = $state(false);
	let googleDriveBackupRetentionCount = $state(10);
	let googleSheetsSyncEnabled = $state(false);
	let syncInactivityMinutes = $state(5);
	let isInitialized = $state(false);
	let showDriveRestoreDialog = $state(false);
	let driveBackups = $state<any[]>([]);
	let isLoadingBackups = $state(false);
	let selectedDriveBackup = $state<string | null>(null);

	onMount(() => {
		settingsStore.load();
	});

	// Update form state when settings load - only on initial load
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
		}
	});

	async function handleSave() {
		isSaving = true;
		try {
			// Update sync-specific settings via the new endpoint first
			await settingsStore.configureSyncSettings({
				googleSheetsSyncEnabled,
				googleDriveBackupEnabled,
				syncInactivityMinutes
			});

			// Update general settings
			await settingsStore.update({
				distanceUnit,
				volumeUnit,
				chargeUnit,
				currencyUnit,
				autoBackupEnabled,
				backupFrequency,
				googleDriveBackupRetentionCount
			});

			// Reset initialization flag to allow settings to update from server
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
			// Automatically generate preview when file is selected
			if (selectedFile) {
				await handleRestorePreview();
			}
		} else {
			selectedFile = null;
			restorePreview = null;
			restoreConflicts = [];
		}
	}

	async function handleRestorePreview() {
		if (!selectedFile) {
			appStore.showError('Please select a backup file');
			return;
		}

		isRestoring = true;
		try {
			const result = await settingsStore.uploadBackup(selectedFile, 'preview');

			if (result.success && result.preview) {
				restorePreview = result.preview;
			}

			if (result.conflicts && result.conflicts.length > 0) {
				restoreConflicts = result.conflicts;
			}
		} catch {
			appStore.showError('Failed to preview backup');
		} finally {
			isRestoring = false;
		}
	}

	async function handleRestoreExecute() {
		if (!selectedFile) {
			appStore.showError('Please select a backup file');
			return;
		}

		if (restoreMode === 'merge' && restoreConflicts.length > 0) {
			appStore.showError('Please resolve conflicts before merging');
			return;
		}

		isRestoring = true;
		try {
			const result = await settingsStore.uploadBackup(selectedFile, restoreMode);

			if (result.success) {
				if (result.imported) {
					const total = Object.values(result.imported).reduce(
						(sum: number, count) => sum + (count as number),
						0
					);
					appStore.showSuccess(`Successfully restored ${total} records`);
				}
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

	function handleSyncNowClick() {
		// Set defaults based on enabled settings
		syncSheets = googleSheetsSyncEnabled;
		syncBackup = googleDriveBackupEnabled;
		syncResults = null;
		showSyncDialog = true;
	}

	async function handleRestoreFromDriveClick() {
		showDriveRestoreDialog = true;
		selectedDriveBackup = null;
		restorePreview = null;
		restoreConflicts = [];
		await loadDriveBackups();
	}

	async function loadDriveBackups() {
		isLoadingBackups = true;
		try {
			const result = await settingsStore.listBackups();
			if (result.success) {
				driveBackups = result.backups || [];
			}
		} catch {
			appStore.showError('Failed to load backups from Google Drive');
		} finally {
			isLoadingBackups = false;
		}
	}

	async function handleDriveBackupSelect(fileId: string) {
		selectedDriveBackup = fileId;
		restorePreview = null;
		restoreConflicts = [];

		// Automatically generate preview
		isRestoring = true;
		try {
			const result = await settingsStore.restoreFromDriveBackup(fileId, 'preview');

			if (result.success && result.preview) {
				restorePreview = result.preview;
			}

			if (result.conflicts && result.conflicts.length > 0) {
				restoreConflicts = result.conflicts;
			}
		} catch {
			appStore.showError('Failed to preview backup');
		} finally {
			isRestoring = false;
		}
	}

	async function handleDriveRestoreExecute() {
		if (!selectedDriveBackup) {
			appStore.showError('Please select a backup');
			return;
		}

		if (restoreMode === 'merge' && restoreConflicts.length > 0) {
			appStore.showError('Please resolve conflicts before merging');
			return;
		}

		isRestoring = true;
		try {
			const result = await settingsStore.restoreFromDriveBackup(selectedDriveBackup, restoreMode);

			if (result.success) {
				if (result.imported) {
					const total = Object.values(result.imported).reduce(
						(sum: number, count) => sum + (count as number),
						0
					);
					appStore.showSuccess(`Successfully restored ${total} records`);
				}
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

			// Check for errors in results
			const hasErrors = result.results?.errors && Object.keys(result.results.errors).length > 0;

			if (hasErrors) {
				// Check if any error is AUTH_INVALID
				const hasAuthError = Object.values(result.results.errors).some(error =>
					String(error).includes('re-authenticate')
				);

				// Show individual error toasts for each sync type that failed
				Object.entries(result.results.errors).forEach(([type, error]) => {
					const typeName = type === 'sheets' ? 'Google Sheets' : 'Google Drive backup';
					appStore.showError(`${typeName}: ${String(error)}`);
				});

				// If auth error, show additional message
				if (hasAuthError) {
					appStore.showError(
						'Google Drive access expired. Click "Re-authenticate with Google" below to continue syncing.'
					);
				}
			}

			// Show success messages for successful syncs
			const messages: string[] = [];
			if (result.results?.sheets && !result.results?.errors?.sheets) {
				messages.push('Google Sheets');
			}
			if (result.results?.backup && !result.results?.errors?.backup) {
				messages.push('Google Drive backup');
			}

			if (messages.length > 0) {
				appStore.showSuccess(`Successfully synced to ${messages.join(' and ')}`);
			}
		} catch (error) {
			// Handle network or other errors
			const errorMessage = error instanceof Error ? error.message : 'Failed to execute sync';
			appStore.showError(errorMessage);
		} finally {
			isSyncing = false;
		}
	}

	function handleReauthenticate() {
		// Redirect to re-authentication endpoint
		window.location.href = '/api/auth/reauth/google';
	}

	let lastBackupText = $derived(
		settings?.lastBackupDate
			? new Date(settings.lastBackupDate).toLocaleDateString('en-US', {
					year: 'numeric',
					month: 'short',
					day: 'numeric',
					hour: '2-digit',
					minute: '2-digit'
				})
			: 'Never'
	);

	// Helper functions for display labels
	function getDistanceLabel(unit: 'miles' | 'kilometers'): string {
		return unit === 'miles' ? 'Miles' : 'Kilometers';
	}

	function getVolumeLabel(unit: 'gallons_us' | 'gallons_uk' | 'liters'): string {
		const labels = {
			gallons_us: 'Gallons (US)',
			gallons_uk: 'Gallons (UK)',
			liters: 'Liters'
		};
		return labels[unit];
	}

	function getChargeLabel(): string {
		return 'kWh';
	}

	function getCurrencyLabel(currency: string): string {
		const labels: Record<string, string> = {
			USD: 'USD ($)',
			EUR: 'EUR (€)',
			GBP: 'GBP (£)',
			CAD: 'CAD ($)',
			AUD: 'AUD ($)'
		};
		return labels[currency] || currency;
	}
</script>

<div class="max-w-4xl mx-auto">
	<div class="mb-6">
		<h1 class="text-3xl font-bold text-gray-900 flex items-center gap-3">
			<SettingsIcon class="h-8 w-8 text-primary-600" />
			Settings
		</h1>
		<p class="text-gray-600 mt-2">Manage your preferences and data</p>
	</div>

	{#if isLoading}
		<div class="flex items-center justify-center py-12">
			<LoaderCircle class="h-8 w-8 animate-spin text-primary-600" />
		</div>
	{:else}
		<div class="space-y-6 pb-32 sm:pb-24">
			<!-- Unit Preferences -->
			<Card>
				<CardHeader>
					<CardTitle>Unit Preferences</CardTitle>
					<CardDescription>Choose your preferred units for measurements</CardDescription>
				</CardHeader>
				<CardContent class="space-y-6">
					<!-- Distance Unit -->
					<div class="space-y-2">
						<Label for="distance-unit" class="flex items-center gap-2">
							<Globe class="h-4 w-4" />
							Distance Unit
						</Label>
						<Select.Root
							type="single"
							value={distanceUnit}
							onValueChange={v => {
								if (v) {
									distanceUnit = v as 'miles' | 'kilometers';
								}
							}}
						>
							<Select.Trigger id="distance-unit" class="w-full">
								{getDistanceLabel(distanceUnit)}
							</Select.Trigger>
							<Select.Content>
								<Select.Item value="miles" label="Miles">Miles</Select.Item>
								<Select.Item value="kilometers" label="Kilometers">Kilometers</Select.Item>
							</Select.Content>
						</Select.Root>
					</div>

					<!-- Volume Unit (Fuel) -->
					<div class="space-y-2">
						<Label for="volume-unit" class="flex items-center gap-2">
							<Fuel class="h-4 w-4" />
							Fuel Volume Unit
						</Label>
						<p class="text-xs text-gray-500">For gas and diesel vehicles</p>
						<Select.Root
							type="single"
							value={volumeUnit}
							onValueChange={v => {
								if (v) {
									volumeUnit = v as 'gallons_us' | 'gallons_uk' | 'liters';
								}
							}}
						>
							<Select.Trigger id="volume-unit" class="w-full">
								{getVolumeLabel(volumeUnit)}
							</Select.Trigger>
							<Select.Content>
								<Select.Item value="gallons_us" label="Gallons (US)">Gallons (US)</Select.Item>
								<Select.Item value="gallons_uk" label="Gallons (UK)">Gallons (UK)</Select.Item>
								<Select.Item value="liters" label="Liters">Liters</Select.Item>
							</Select.Content>
						</Select.Root>
					</div>

					<!-- Charge Unit (Electric) -->
					<div class="space-y-2">
						<Label for="charge-unit" class="flex items-center gap-2">
							<Fuel class="h-4 w-4" />
							Electric Charge Unit
						</Label>
						<p class="text-xs text-gray-500">For electric and hybrid vehicles</p>
						<Select.Root
							type="single"
							value={chargeUnit}
							onValueChange={v => {
								if (v) {
									chargeUnit = v as 'kwh';
								}
							}}
						>
							<Select.Trigger id="charge-unit" class="w-full">
								{getChargeLabel()}
							</Select.Trigger>
							<Select.Content>
								<Select.Item value="kwh" label="kWh">kWh</Select.Item>
							</Select.Content>
						</Select.Root>
					</div>

					<!-- Currency -->
					<div class="space-y-2">
						<Label for="currency" class="flex items-center gap-2">
							<DollarSign class="h-4 w-4" />
							Currency
						</Label>
						<Select.Root
							type="single"
							value={currencyUnit}
							onValueChange={v => {
								if (v) {
									currencyUnit = v;
								}
							}}
						>
							<Select.Trigger id="currency" class="w-full">
								{getCurrencyLabel(currencyUnit)}
							</Select.Trigger>
							<Select.Content>
								<Select.Item value="USD" label="USD ($)">USD ($)</Select.Item>
								<Select.Item value="EUR" label="EUR (€)">EUR (€)</Select.Item>
								<Select.Item value="GBP" label="GBP (£)">GBP (£)</Select.Item>
								<Select.Item value="CAD" label="CAD ($)">CAD ($)</Select.Item>
								<Select.Item value="AUD" label="AUD ($)">AUD ($)</Select.Item>
							</Select.Content>
						</Select.Root>
					</div>
				</CardContent>
			</Card>

			<!-- Data Backups & Sync -->
			<Card>
				<CardHeader>
					<CardTitle>Data Backups & Sync</CardTitle>
					<CardDescription>
						Manage manual backups and automatic sync to Google Drive
					</CardDescription>
				</CardHeader>
				<CardContent class="space-y-6">
					<!-- Manual Backup Actions -->
					<div class="space-y-3">
						<Label class="flex items-center gap-2">
							<Database class="h-4 w-4" />
							Manual Backup
						</Label>
						<p class="text-sm text-gray-500">Download or upload ZIP files for offline storage</p>
						<div class="flex gap-3">
							<Button
								variant="outline"
								onclick={handleBackup}
								disabled={isBackingUp}
								class="flex-1"
							>
								{#if isBackingUp}
									<LoaderCircle class="mr-2 h-4 w-4 animate-spin" />
									Creating...
								{:else}
									<Download class="mr-2 h-4 w-4" />
									Download Backup
								{/if}
							</Button>
							<Button variant="outline" onclick={handleRestoreClick} class="flex-1">
								<Upload class="mr-2 h-4 w-4" />
								Upload Backup
							</Button>
						</div>
					</div>

					<div class="border-t pt-6 space-y-6">
						<!-- Google Drive Backup -->
						<div class="flex items-center justify-between">
							<div class="space-y-0.5">
								<Label for="google-drive-backup">Google Drive Backup</Label>
								<p class="text-sm text-gray-500">
									Auto-backup files to Google Drive after inactivity
								</p>
							</div>
							<Switch id="google-drive-backup" bind:checked={googleDriveBackupEnabled} />
						</div>

						{#if googleDriveBackupEnabled}
							{#if settings?.lastBackupDate}
								<div class="pl-6">
									<p class="text-sm text-gray-600">
										Last backup: <span class="font-medium">{lastBackupText}</span>
									</p>
								</div>
							{/if}

							<!-- Retention Count -->
							<div class="space-y-2 pl-6">
								<Label for="retention-count">Number of backups to keep</Label>
								<Select.Root
									type="single"
									value={googleDriveBackupRetentionCount.toString()}
									onValueChange={v => {
										if (v) {
											googleDriveBackupRetentionCount = parseInt(v);
										}
									}}
								>
									<Select.Trigger id="retention-count" class="w-full">
										{googleDriveBackupRetentionCount}
										{googleDriveBackupRetentionCount === 1 ? 'backup' : 'backups'}
									</Select.Trigger>
									<Select.Content>
										<Select.Item value="5" label="5 backups">5 backups</Select.Item>
										<Select.Item value="10" label="10 backups">10 backups</Select.Item>
										<Select.Item value="15" label="15 backups">15 backups</Select.Item>
										<Select.Item value="20" label="20 backups">20 backups</Select.Item>
										<Select.Item value="30" label="30 backups">30 backups</Select.Item>
										<Select.Item value="50" label="50 backups">50 backups</Select.Item>
									</Select.Content>
								</Select.Root>
								<p class="text-xs text-gray-500">Older backups will be automatically deleted</p>
							</div>

							<!-- Restore from Drive Button -->
							<div class="pl-6">
								<Button variant="outline" onclick={handleRestoreFromDriveClick} class="w-full">
									<Upload class="mr-2 h-4 w-4" />
									Restore from Drive Backup
								</Button>
							</div>
						{/if}

						<!-- Google Sheets Sync -->
						<div class="flex items-center justify-between">
							<div class="space-y-0.5">
								<Label for="sheets-sync">Google Sheets Sync</Label>
								<p class="text-sm text-gray-500">
									Auto-sync data to Google Sheets after inactivity
								</p>
							</div>
							<Switch id="sheets-sync" bind:checked={googleSheetsSyncEnabled} />
						</div>

						{#if googleSheetsSyncEnabled && settings?.lastSyncDate}
							<div class="pl-6">
								<p class="text-sm text-gray-600">
									Last sync: <span class="font-medium">
										{new Date(settings.lastSyncDate).toLocaleDateString('en-US', {
											year: 'numeric',
											month: 'short',
											day: 'numeric',
											hour: '2-digit',
											minute: '2-digit'
										})}
									</span>
								</p>
							</div>
						{/if}

						<!-- Inactivity Timeout (shown if either sync is enabled) -->
						{#if googleDriveBackupEnabled || googleSheetsSyncEnabled}
							<div class="space-y-2 pl-6">
								<Label for="inactivity-minutes">Auto-sync after inactivity</Label>
								<Select.Root
									type="single"
									value={syncInactivityMinutes.toString()}
									onValueChange={v => {
										if (v) {
											syncInactivityMinutes = parseInt(v);
										}
									}}
								>
									<Select.Trigger id="inactivity-minutes" class="w-full">
										{syncInactivityMinutes}
										{syncInactivityMinutes === 1 ? 'minute' : 'minutes'}
									</Select.Trigger>
									<Select.Content>
										<Select.Item value="1" label="1 minute">1 minute</Select.Item>
										<Select.Item value="2" label="2 minutes">2 minutes</Select.Item>
										<Select.Item value="5" label="5 minutes">5 minutes</Select.Item>
										<Select.Item value="10" label="10 minutes">10 minutes</Select.Item>
										<Select.Item value="15" label="15 minutes">15 minutes</Select.Item>
										<Select.Item value="30" label="30 minutes">30 minutes</Select.Item>
									</Select.Content>
								</Select.Root>
							</div>

							<!-- Sync Now Button -->
							<div class="pl-6 space-y-2">
								<Button variant="outline" onclick={handleSyncNowClick} class="w-full">
									<RefreshCw class="mr-2 h-4 w-4" />
									Sync Now
								</Button>
								<Button variant="outline" onclick={handleReauthenticate} class="w-full">
									<RefreshCw class="mr-2 h-4 w-4" />
									Re-authenticate with Google
								</Button>
							</div>
						{/if}
					</div>
				</CardContent>
			</Card>
		</div>
	{/if}

	<!-- Floating Action Button -->
	<Button
		onclick={handleSave}
		disabled={isSaving}
		class="fixed sm:bottom-8 sm:right-8 bottom-4 left-4 right-4 sm:left-auto sm:w-auto w-auto sm:rounded-full rounded-full group !bg-gradient-to-r !from-primary-600 !to-primary-700 hover:!from-primary-700 hover:!to-primary-800 !text-white shadow-2xl hover:shadow-primary-500/50 transition-all duration-300 sm:hover:scale-110 !z-50 h-16 sm:h-16 !pl-6 !pr-10 !border-0 !justify-center disabled:opacity-50 disabled:cursor-not-allowed"
	>
		{#if isSaving}
			<LoaderCircle class="h-6 w-6 animate-spin transition-transform duration-300" />
			<span class="font-bold text-lg">Saving...</span>
		{:else}
			<Save class="h-6 w-6 transition-transform duration-300 group-hover:scale-110" />
			<span class="font-bold text-lg">Save Settings</span>
		{/if}
	</Button>

	<!-- Dialogs -->
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
