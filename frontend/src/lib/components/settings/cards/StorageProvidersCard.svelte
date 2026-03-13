<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { HardDrive, Plus, LoaderCircle, Download, Upload, RefreshCw } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { Separator } from '$lib/components/ui/separator';
	import DefaultPhotoSources from '../storage-provider/DefaultPhotoSources.svelte';
	import ProviderCard from '../storage-provider/ProviderInfoCard.svelte';
	import { providerApi } from '$lib/services/provider-api';
	import { settingsApi } from '$lib/services/settings-api';
	import { appStore } from '$lib/stores/app.svelte';
	import { routes, paramRoutes } from '$lib/routes';
	import type {
		PhotoCategory,
		CategorySetting,
		StorageConfig,
		UserProviderInfo,
		BackupConfig
	} from '$lib/types';

	interface Props {
		isBackingUp?: boolean;
		syncInactivityMinutes?: number;
		onBackupNow?: () => void;
		onRestore?: () => void;
		onDownloadBackup?: () => void;
	}

	let {
		isBackingUp = false,
		syncInactivityMinutes = $bindable(5),
		onBackupNow,
		onRestore,
		onDownloadBackup
	}: Props = $props();

	const DEFAULT_STORAGE_CONFIG: StorageConfig = {
		defaults: {
			vehicle_photos: null,
			expense_receipts: null,
			insurance_docs: null,
			odometer_readings: null
		},
		providerCategories: {}
	};

	const DEFAULT_CATEGORY_SETTINGS: Record<PhotoCategory, CategorySetting> = {
		vehicle_photos: { enabled: false, folderPath: 'Vehicle' },
		expense_receipts: { enabled: false, folderPath: 'Receipts' },
		insurance_docs: { enabled: false, folderPath: 'Insurance' },
		odometer_readings: { enabled: false, folderPath: 'Odometer' }
	};

	let providers = $state<UserProviderInfo[]>([]);
	let storageConfig = $state<StorageConfig>(DEFAULT_STORAGE_CONFIG);
	let backupConfig = $state<BackupConfig>({ providers: {} });
	let isLoading = $state(true);
	let error = $state<string | null>(null);

	async function loadData() {
		try {
			const [providerList, settings] = await Promise.all([
				providerApi.getProviders('storage'),
				settingsApi.getSettings()
			]);
			providers = providerList;
			storageConfig = settings.storageConfig ?? DEFAULT_STORAGE_CONFIG;
			backupConfig = settings.backupConfig ?? { providers: {} };
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load photo storage settings';
		} finally {
			isLoading = false;
		}
	}

	onMount(() => {
		loadData();
	});

	async function handleConfigUpdate(config: StorageConfig) {
		try {
			await settingsApi.updateSettings({ storageConfig: config });
			storageConfig = config;
			appStore.showSuccess('Photo storage settings updated');
		} catch {
			appStore.showError('Failed to update photo storage settings');
		}
	}

	async function handleProviderEdit(provider: UserProviderInfo) {
		goto(resolve(paramRoutes.settingsProviderEdit, { id: provider.id }));
	}

	async function handleProviderDelete(provider: UserProviderInfo) {
		try {
			await providerApi.deleteProvider(provider.id);
			appStore.showSuccess(`${provider.displayName} removed`);
			await loadData();
		} catch {
			appStore.showError('Failed to delete provider');
		}
	}

	function getCategorySettings(providerId: string): Record<PhotoCategory, CategorySetting> {
		const stored = storageConfig.providerCategories[providerId];
		if (!stored) return DEFAULT_CATEGORY_SETTINGS;
		// Merge with defaults so newly added categories get a default value
		return { ...DEFAULT_CATEGORY_SETTINGS, ...stored };
	}

	let backupProviderCount = $derived(
		Object.values(backupConfig.providers).filter(p => p.enabled || p.sheetsSyncEnabled).length
	);

	let lastBackupText = $derived.by(() => {
		let latest: string | null = null;
		for (const settings of Object.values(backupConfig.providers)) {
			if (settings.lastBackupAt && (!latest || settings.lastBackupAt > latest)) {
				latest = settings.lastBackupAt;
			}
		}
		if (!latest) return 'Never';
		return new Date(latest).toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	});

	async function handleBackupToggle(providerId: string, enabled: boolean) {
		const existing = backupConfig.providers[providerId] ?? {
			enabled: false,
			folderPath: 'Backups',
			retentionCount: 10
		};
		const updatedConfig: BackupConfig = {
			providers: {
				...backupConfig.providers,
				[providerId]: {
					...existing,
					enabled
				}
			}
		};
		try {
			await settingsApi.updateSettings({ backupConfig: updatedConfig });
			backupConfig = updatedConfig;
			appStore.showSuccess(
				enabled ? 'ZIP backup enabled for provider' : 'ZIP backup disabled for provider'
			);
		} catch {
			appStore.showError('Failed to update backup settings');
		}
	}

	async function handleSheetsSyncToggle(providerId: string, enabled: boolean) {
		const existing = backupConfig.providers[providerId] ?? {
			enabled: false,
			folderPath: 'Backups',
			retentionCount: 10
		};
		const updatedConfig: BackupConfig = {
			providers: {
				...backupConfig.providers,
				[providerId]: {
					...existing,
					sheetsSyncEnabled: enabled
				}
			}
		};
		try {
			await settingsApi.updateSettings({ backupConfig: updatedConfig });
			backupConfig = updatedConfig;
			appStore.showSuccess(
				enabled ? 'Sheets sync enabled for provider' : 'Sheets sync disabled for provider'
			);
		} catch {
			appStore.showError('Failed to update backup settings');
		}
	}
</script>

<Card>
	<CardHeader>
		<div class="flex items-center gap-2">
			<HardDrive class="h-5 w-5 text-muted-foreground" />
			<CardTitle>Storage Providers</CardTitle>
		</div>
		<CardDescription>Configure storage providers for photos and backups</CardDescription>
	</CardHeader>
	<CardContent>
		{#if isLoading}
			<div class="flex items-center justify-center py-8">
				<LoaderCircle class="h-8 w-8 animate-spin text-muted-foreground" />
			</div>
		{:else if error}
			<p class="text-sm text-destructive">{error}</p>
		{:else}
			<!-- Backup & Restore -->
			<div class="space-y-4">
				<p class="text-sm font-medium">Data Backups</p>

				{#if backupProviderCount > 0}
					<div class="text-xs text-muted-foreground">Last backup: {lastBackupText}</div>

					<div class="space-y-2">
						<Label for="inactivity-minutes" class="text-sm">Auto-backup after inactivity</Label>
						<Select.Root
							type="single"
							value={syncInactivityMinutes.toString()}
							onValueChange={v => {
								if (v) syncInactivityMinutes = parseInt(v);
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
				{:else}
					<p class="text-sm text-muted-foreground">
						Enable backup on a provider below to sync your data to the cloud.
					</p>
				{/if}

				<div class="flex flex-col sm:flex-row gap-2">
					{#if backupProviderCount > 0}
						<Button variant="outline" onclick={() => onBackupNow?.()} class="flex-1">
							<RefreshCw class="mr-2 h-4 w-4" />
							Backup to Cloud
						</Button>
					{/if}
					<Button
						variant="outline"
						onclick={() => onDownloadBackup?.()}
						disabled={isBackingUp}
						class="flex-1"
					>
						{#if isBackingUp}
							<LoaderCircle class="mr-2 h-4 w-4 animate-spin" />
							Downloading...
						{:else}
							<Download class="mr-2 h-4 w-4" />
							Download Backup
						{/if}
					</Button>
					<Button variant="outline" onclick={() => onRestore?.()} class="flex-1">
						<Upload class="mr-2 h-4 w-4" />
						Restore
					</Button>
				</div>
			</div>

			<Separator class="my-6" />

			<!-- Default Photo Sources -->
			<DefaultPhotoSources {storageConfig} {providers} onUpdate={handleConfigUpdate} />

			<Separator class="my-6" />

			<!-- Providers -->
			<div class="space-y-3">
				<div class="flex items-center justify-between">
					<p class="text-sm font-medium">Providers</p>
					<Button
						variant="outline"
						size="sm"
						onclick={() => goto(resolve(routes.settingsProviderNew))}
					>
						<Plus class="h-4 w-4 mr-1" />
						Add Provider
					</Button>
				</div>

				{#if providers.length === 0}
					<div class="text-center py-6">
						<HardDrive class="h-10 w-10 text-muted-foreground mx-auto mb-2" />
						<p class="text-sm font-medium">No storage providers configured</p>
						<p class="text-xs text-muted-foreground mt-1">
							Add a provider to start storing photos and backups
						</p>
						<Button
							variant="outline"
							size="sm"
							class="mt-3"
							onclick={() => goto(resolve(routes.settingsProviderNew))}
						>
							<Plus class="h-4 w-4 mr-1" />
							Add Provider
						</Button>
					</div>
				{:else}
					<div class="space-y-3">
						{#each providers as provider (provider.id)}
							<ProviderCard
								{provider}
								categorySettings={getCategorySettings(provider.id)}
								backupEnabled={backupConfig.providers[provider.id]?.enabled ?? false}
								sheetsSyncEnabled={backupConfig.providers[provider.id]?.sheetsSyncEnabled ?? false}
								lastBackupAt={backupConfig.providers[provider.id]?.lastBackupAt}
								onEdit={handleProviderEdit}
								onDelete={handleProviderDelete}
								onBackupToggle={handleBackupToggle}
								onSheetsSyncToggle={handleSheetsSyncToggle}
							/>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</CardContent>
</Card>
