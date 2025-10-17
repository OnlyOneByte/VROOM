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
	import * as Dialog from '$lib/components/ui/dialog';
	import * as RadioGroup from '$lib/components/ui/radio-group';
	import { Input } from '$lib/components/ui/input';
	import { Checkbox } from '$lib/components/ui/checkbox';

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
	let googleSheetsSyncEnabled = $state(false);
	let syncInactivityMinutes = $state(5);
	let isInitialized = $state(false);

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
				backupFrequency
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

			const messages: string[] = [];
			if (result.results?.sheets) {
				messages.push('Google Sheets');
			}
			if (result.results?.backup) {
				messages.push('Google Drive backup');
			}

			if (messages.length > 0) {
				appStore.showSuccess(`Successfully synced to ${messages.join(' and ')}`);
			}

			if (result.errors && Object.keys(result.errors).length > 0) {
				const errorMessages = Object.entries(result.errors)
					.map(([type, error]) => `${type}: ${error}`)
					.join(', ');
				appStore.showError(`Sync errors: ${errorMessages}`);
			}
		} catch {
			appStore.showError('Failed to execute sync');
		} finally {
			isSyncing = false;
		}
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
									Auto-sync backup files to Google Drive after inactivity
								</p>
							</div>
							<Switch id="google-drive-backup" bind:checked={googleDriveBackupEnabled} />
						</div>

						{#if googleDriveBackupEnabled && settings?.lastBackupDate}
							<div class="pl-6">
								<p class="text-sm text-gray-600">
									Last backup: <span class="font-medium">{lastBackupText}</span>
								</p>
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
							<div class="pl-6">
								<Button variant="outline" onclick={handleSyncNowClick} class="w-full">
									<RefreshCw class="mr-2 h-4 w-4" />
									Sync Now
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

	<!-- Restore Dialog -->
	<Dialog.Root bind:open={showRestoreDialog}>
		<Dialog.Content class="max-w-2xl max-h-[90vh] overflow-y-auto">
			<Dialog.Header>
				<Dialog.Title>Restore from Backup</Dialog.Title>
				<Dialog.Description>
					Upload a backup file and choose how to restore your data
				</Dialog.Description>
			</Dialog.Header>

			<div class="space-y-6 py-4">
				<!-- File Upload -->
				<div class="space-y-2">
					<Label for="backup-file">Backup File</Label>
					<Input id="backup-file" type="file" accept=".zip" onchange={handleFileSelect} />
					{#if selectedFile}
						<p class="text-sm text-gray-600">
							Selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(2)} KB)
						</p>
					{/if}
					{#if isRestoring && !restorePreview}
						<div class="flex items-center gap-2 text-sm text-primary-600">
							<LoaderCircle class="h-4 w-4 animate-spin" />
							<span>Generating preview...</span>
						</div>
					{/if}
				</div>

				<!-- Restore Mode (only show after preview is loaded) -->
				{#if restorePreview}
					<div class="space-y-3">
						<Label>Restore Mode</Label>
						<RadioGroup.Root bind:value={restoreMode}>
							<div class="flex items-center space-x-2">
								<RadioGroup.Item value="replace" id="mode-replace" />
								<Label for="mode-replace" class="font-normal cursor-pointer">
									<div>
										<div class="font-medium">Replace All</div>
										<div class="text-sm text-gray-500">
											Delete all existing data and import from backup
										</div>
									</div>
								</Label>
							</div>
							<div class="flex items-center space-x-2 opacity-50">
								<RadioGroup.Item value="merge" id="mode-merge" disabled />
								<Label for="mode-merge" class="font-normal cursor-not-allowed">
									<div>
										<div class="font-medium">Merge (Coming Soon)</div>
										<div class="text-sm text-gray-500">
											Merge backup data with existing data - currently unavailable
										</div>
									</div>
								</Label>
							</div>
						</RadioGroup.Root>
					</div>
				{/if}

				<!-- Preview Results -->
				{#if restorePreview}
					<div class="border rounded-lg p-4 bg-gray-50">
						<h4 class="font-medium mb-3">Import Summary</h4>
						<div class="space-y-2 text-sm">
							<div class="flex justify-between">
								<span>Vehicles:</span>
								<span class="font-medium">{restorePreview.vehicles || 0}</span>
							</div>
							<div class="flex justify-between">
								<span>Expenses:</span>
								<span class="font-medium">{restorePreview.expenses || 0}</span>
							</div>
							<div class="flex justify-between">
								<span>Insurance Policies:</span>
								<span class="font-medium">{restorePreview.insurance || 0}</span>
							</div>
							<div class="flex justify-between">
								<span>Vehicle Financing:</span>
								<span class="font-medium">{restorePreview.financing || 0}</span>
							</div>
							<div class="flex justify-between">
								<span>Financing Payments:</span>
								<span class="font-medium">{restorePreview.financingPayments || 0}</span>
							</div>
						</div>
					</div>
				{/if}

				<!-- Conflicts -->
				{#if restoreConflicts.length > 0}
					<div class="border border-yellow-300 rounded-lg p-4 bg-yellow-50">
						<h4 class="font-medium mb-3 text-yellow-800">Conflicts Detected</h4>
						<p class="text-sm text-yellow-700 mb-3">
							{restoreConflicts.length} conflict(s) found. These records exist in both your current data
							and the backup with different values.
						</p>
						<div class="space-y-2 max-h-48 overflow-y-auto">
							{#each restoreConflicts as conflict}
								<div class="text-sm bg-white p-2 rounded border">
									<div class="font-medium">{conflict.table} - ID: {conflict.id}</div>
								</div>
							{/each}
						</div>
					</div>
				{/if}
			</div>

			<Dialog.Footer class="flex gap-2">
				<Button variant="outline" onclick={() => (showRestoreDialog = false)}>Cancel</Button>
				{#if restorePreview}
					<Button
						onclick={handleRestoreExecute}
						disabled={!selectedFile ||
							isRestoring ||
							(restoreMode === 'merge' && restoreConflicts.length > 0)}
					>
						{#if isRestoring}
							<LoaderCircle class="mr-2 h-4 w-4 animate-spin" />
							Restoring...
						{:else}
							Restore
						{/if}
					</Button>
				{/if}
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>

	<!-- Sync Now Dialog -->
	<Dialog.Root bind:open={showSyncDialog}>
		<Dialog.Content class="max-w-lg">
			<Dialog.Header>
				<Dialog.Title>Sync Now</Dialog.Title>
				<Dialog.Description>Choose which sync operations to perform</Dialog.Description>
			</Dialog.Header>

			<div class="space-y-4 py-4">
				<!-- Sync Type Selection -->
				<div class="space-y-3">
					<Label>Sync Types</Label>
					<div class="space-y-3">
						<div class="flex items-center space-x-2">
							<Checkbox
								id="sync-sheets"
								bind:checked={syncSheets}
								disabled={!googleSheetsSyncEnabled}
							/>
							<Label for="sync-sheets" class="font-normal cursor-pointer">
								<div>
									<div class="font-medium">Google Sheets</div>
									<div class="text-sm text-gray-500">
										{googleSheetsSyncEnabled
											? 'Sync data to Google Sheets'
											: 'Enable Google Sheets sync in settings first'}
									</div>
								</div>
							</Label>
						</div>
						<div class="flex items-center space-x-2">
							<Checkbox
								id="sync-backup"
								bind:checked={syncBackup}
								disabled={!googleDriveBackupEnabled}
							/>
							<Label for="sync-backup" class="font-normal cursor-pointer">
								<div>
									<div class="font-medium">Google Drive Backup</div>
									<div class="text-sm text-gray-500">
										{googleDriveBackupEnabled
											? 'Upload backup to Google Drive'
											: 'Enable Google Drive backup in settings first'}
									</div>
								</div>
							</Label>
						</div>
					</div>
				</div>

				<!-- Sync Results -->
				{#if syncResults}
					<div class="border rounded-lg p-4 bg-gray-50">
						<h4 class="font-medium mb-3">Sync Results</h4>
						<div class="space-y-2 text-sm">
							{#if syncResults.results?.sheets}
								<div class="flex items-center gap-2 text-green-600">
									<span class="font-medium">✓ Google Sheets:</span>
									<span>Synced successfully</span>
								</div>
							{/if}
							{#if syncResults.results?.backup}
								<div class="flex items-center gap-2 text-green-600">
									<span class="font-medium">✓ Google Drive:</span>
									<span>Backup uploaded</span>
								</div>
							{/if}
							{#if syncResults.errors}
								{#each Object.entries(syncResults.errors) as [type, error]}
									<div class="flex items-center gap-2 text-red-600">
										<span class="font-medium">✗ {type}:</span>
										<span>{error}</span>
									</div>
								{/each}
							{/if}
						</div>
					</div>
				{/if}
			</div>

			<Dialog.Footer class="flex gap-2">
				<Button variant="outline" onclick={() => (showSyncDialog = false)}>
					{syncResults ? 'Close' : 'Cancel'}
				</Button>
				{#if !syncResults}
					<Button onclick={handleSyncExecute} disabled={isSyncing || (!syncSheets && !syncBackup)}>
						{#if isSyncing}
							<LoaderCircle class="mr-2 h-4 w-4 animate-spin" />
							Syncing...
						{:else}
							<RefreshCw class="mr-2 h-4 w-4" />
							Sync Now
						{/if}
					</Button>
				{/if}
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>
</div>
