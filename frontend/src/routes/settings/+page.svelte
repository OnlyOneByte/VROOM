<script lang="ts">
	import { onMount } from 'svelte';
	import { settingsStore } from '$lib/stores/settings.js';
	import { appStore } from '$lib/stores/app.js';
	import type { UserSettings } from '$lib/types/index.js';
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

	let settings = $state<UserSettings | null>(null);
	let isLoading = $state(false);
	let isSaving = $state(false);
	let isBackingUp = $state(false);
	let isRestoring = $state(false);
	let isSyncing = $state(false);

	// Form state
	let distanceUnit = $state<'miles' | 'kilometers'>('miles');
	let volumeUnit = $state<'gallons_us' | 'gallons_uk' | 'liters'>('gallons_us');
	let chargeUnit = $state<'kwh'>('kwh');
	let currencyUnit = $state('USD');
	let autoBackupEnabled = $state(false);
	let backupFrequency = $state<'daily' | 'weekly' | 'monthly'>('weekly');
	let googleDriveBackupEnabled = $state(false);
	let googleSheetsSyncEnabled = $state(false);
	let syncOnInactivity = $state(true);
	let syncInactivityMinutes = $state(5);

	// Use automatic store subscription
	let settingsState = $derived($settingsStore);

	onMount(() => {
		isLoading = true;
		settingsStore.load();
	});

	// Update local state when settings change
	$effect(() => {
		settings = settingsState.settings;
		isLoading = settingsState.isLoading;

		if (settings) {
			distanceUnit = settings.distanceUnit;
			volumeUnit = settings.volumeUnit;
			chargeUnit = settings.chargeUnit;
			currencyUnit = settings.currencyUnit;
			autoBackupEnabled = settings.autoBackupEnabled;
			backupFrequency = settings.backupFrequency;
			googleDriveBackupEnabled = settings.googleDriveBackupEnabled;
			googleSheetsSyncEnabled = settings.googleSheetsSyncEnabled || false;
			syncOnInactivity = settings.syncOnInactivity ?? true;
			syncInactivityMinutes = settings.syncInactivityMinutes || 5;
		}
	});

	async function handleSave() {
		isSaving = true;
		try {
			await settingsStore.update({
				distanceUnit,
				volumeUnit,
				chargeUnit,
				currencyUnit,
				autoBackupEnabled,
				backupFrequency,
				googleDriveBackupEnabled,
				googleSheetsSyncEnabled,
				syncOnInactivity,
				syncInactivityMinutes
			});
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
			if (googleDriveBackupEnabled) {
				await settingsStore.uploadBackupToDrive('zip');
				appStore.showSuccess('Backup uploaded to Google Drive successfully');
			} else {
				await settingsStore.downloadBackup('zip');
				appStore.showSuccess('Backup downloaded successfully');
			}
		} catch {
			appStore.showError('Failed to create backup');
		} finally {
			isBackingUp = false;
		}
	}

	async function handleRestore() {
		appStore.showError('Restore from backup is not yet implemented');
		// TODO: Implement file upload and restore functionality
	}

	async function handleSyncNow() {
		isSyncing = true;
		try {
			await settingsStore.syncToSheets();
			appStore.showSuccess('Data synced to Google Sheets successfully');
		} catch {
			appStore.showError('Failed to sync to Google Sheets');
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

	function getChargeLabel(unit: 'kwh'): string {
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

	function getFrequencyLabel(freq: 'daily' | 'weekly' | 'monthly'): string {
		return freq.charAt(0).toUpperCase() + freq.slice(1);
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
								{getChargeLabel(chargeUnit)}
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

			<!-- Data Backups -->
			<Card>
				<CardHeader>
					<CardTitle>Data Backups</CardTitle>
					<CardDescription>
						Download or upload data dumps (ZIP/JSON files) for offline storage
					</CardDescription>
				</CardHeader>
				<CardContent class="space-y-6">
					<!-- Auto Backup -->
					<div class="flex items-center justify-between">
						<div class="space-y-0.5">
							<Label for="auto-backup" class="flex items-center gap-2">
								<Database class="h-4 w-4" />
								Automatic Backups
							</Label>
							<p class="text-sm text-gray-500">Automatically create backup files</p>
						</div>
						<Switch id="auto-backup" bind:checked={autoBackupEnabled} />
					</div>

					<!-- Backup Frequency -->
					{#if autoBackupEnabled}
						<div class="space-y-2 pl-6">
							<Label for="backup-frequency">Backup Frequency</Label>
							<Select.Root
								type="single"
								value={backupFrequency}
								onValueChange={v => {
									if (v) {
										backupFrequency = v as 'daily' | 'weekly' | 'monthly';
									}
								}}
							>
								<Select.Trigger id="backup-frequency" class="w-full">
									{getFrequencyLabel(backupFrequency)}
								</Select.Trigger>
								<Select.Content>
									<Select.Item value="daily" label="Daily">Daily</Select.Item>
									<Select.Item value="weekly" label="Weekly">Weekly</Select.Item>
									<Select.Item value="monthly" label="Monthly">Monthly</Select.Item>
								</Select.Content>
							</Select.Root>
						</div>
					{/if}

					<!-- Google Drive Backup -->
					<div class="flex items-center justify-between">
						<div class="space-y-0.5">
							<Label for="google-drive-backup">Google Drive Storage</Label>
							<p class="text-sm text-gray-500">
								Store backup files in Google Drive/vroom/Backups folder
							</p>
						</div>
						<Switch id="google-drive-backup" bind:checked={googleDriveBackupEnabled} />
					</div>

					<!-- Last Backup -->
					<div class="pt-4 border-t">
						<p class="text-sm text-gray-600">
							Last backup: <span class="font-medium">{lastBackupText}</span>
						</p>
					</div>

					<!-- Backup Actions -->
					<div class="flex gap-3 pt-2">
						<Button variant="outline" onclick={handleBackup} disabled={isBackingUp} class="flex-1">
							{#if isBackingUp}
								<LoaderCircle class="mr-2 h-4 w-4 animate-spin" />
								Creating...
							{:else}
								<Download class="mr-2 h-4 w-4" />
								Download Backup
							{/if}
						</Button>
						<Button variant="outline" onclick={handleRestore} disabled={isRestoring} class="flex-1">
							{#if isRestoring}
								<LoaderCircle class="mr-2 h-4 w-4 animate-spin" />
								Uploading...
							{:else}
								<Upload class="mr-2 h-4 w-4" />
								Upload Backup
							{/if}
						</Button>
					</div>
				</CardContent>
			</Card>

			<!-- Google Sheets Sync -->
			<Card>
				<CardHeader>
					<CardTitle>Google Sheets Sync</CardTitle>
					<CardDescription>
						Sync your data to Google Sheets for visual access and editing
					</CardDescription>
				</CardHeader>
				<CardContent class="space-y-6">
					<!-- Enable Sync -->
					<div class="flex items-center justify-between">
						<div class="space-y-0.5">
							<Label for="sheets-sync">Enable Sheets Sync</Label>
							<p class="text-sm text-gray-500">
								Mirror your database to a Google Sheet in the vroom folder
							</p>
						</div>
						<Switch id="sheets-sync" bind:checked={googleSheetsSyncEnabled} />
					</div>

					{#if googleSheetsSyncEnabled}
						<!-- Sync on Inactivity -->
						<div class="flex items-center justify-between pl-6">
							<div class="space-y-0.5">
								<Label for="sync-inactivity">Auto-sync on Inactivity</Label>
								<p class="text-sm text-gray-500">Sync after period of no activity</p>
							</div>
							<Switch id="sync-inactivity" bind:checked={syncOnInactivity} />
						</div>

						<!-- Inactivity Duration -->
						{#if syncOnInactivity}
							<div class="space-y-2 pl-12">
								<Label for="inactivity-minutes">Inactivity Duration (minutes)</Label>
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
										{syncInactivityMinutes} minutes
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
						{/if}

						<!-- Last Sync -->
						<div class="pt-4 border-t pl-6">
							<p class="text-sm text-gray-600">
								Last sync: <span class="font-medium">
									{settings?.lastSyncDate
										? new Date(settings.lastSyncDate).toLocaleDateString('en-US', {
												year: 'numeric',
												month: 'short',
												day: 'numeric',
												hour: '2-digit',
												minute: '2-digit'
											})
										: 'Never'}
								</span>
							</p>
						</div>

						<!-- Sync Now Button -->
						<div class="pt-2 pl-6">
							<Button variant="outline" onclick={handleSyncNow} disabled={isSyncing} class="w-full">
								{#if isSyncing}
									<LoaderCircle class="mr-2 h-4 w-4 animate-spin" />
									Syncing...
								{:else}
									<RefreshCw class="mr-2 h-4 w-4" />
									Sync Now
								{/if}
							</Button>
						</div>
					{/if}
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
</div>
