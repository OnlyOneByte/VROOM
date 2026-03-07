<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { HardDrive, Plus, LoaderCircle } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { Separator } from '$lib/components/ui/separator';
	import DefaultPhotoSources from './DefaultPhotoSources.svelte';
	import ProviderCard from './ProviderCard.svelte';
	import { providerApi } from '$lib/services/provider-api';
	import { settingsApi } from '$lib/services/settings-api';
	import { appStore } from '$lib/stores/app.svelte';
	import { routes, paramRoutes } from '$lib/routes';
	import type { PhotoCategory, CategorySetting, StorageConfig, UserProviderInfo } from '$lib/types';

	const DEFAULT_STORAGE_CONFIG: StorageConfig = {
		defaults: { vehicle_photos: null, expense_receipts: null, insurance_docs: null, odometer_readings: null },
		providerCategories: {}
	};

	const DEFAULT_CATEGORY_SETTINGS: Record<PhotoCategory, CategorySetting> = {
		vehicle_photos: { enabled: false, folderPath: '/Vehicle Photos' },
		expense_receipts: { enabled: false, folderPath: '/Receipts' },
		insurance_docs: { enabled: false, folderPath: '/Insurance' },
		odometer_readings: { enabled: false, folderPath: '/Odometer' }
	};

	let providers = $state<UserProviderInfo[]>([]);
	let storageConfig = $state<StorageConfig>(DEFAULT_STORAGE_CONFIG);
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
						<p class="text-xs text-muted-foreground mt-1">Add a provider to start storing photos and backups</p>
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
								onEdit={handleProviderEdit}
								onDelete={handleProviderDelete}
							/>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</CardContent>
</Card>
