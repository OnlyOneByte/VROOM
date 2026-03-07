<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { LoaderCircle } from '@lucide/svelte';
	import ProviderForm from '$lib/components/settings/ProviderForm.svelte';
	import { providerApi } from '$lib/services/provider-api';
	import { settingsApi } from '$lib/services/settings-api';
	import { routes } from '$lib/routes';
	import type { PhotoCategory, CategorySetting, StorageConfig, UserProviderInfo } from '$lib/types';

	const DEFAULT_CATEGORY_SETTINGS: Record<PhotoCategory, CategorySetting> = {
		vehicle_photos: { enabled: false, folderPath: '/Vehicle Photos' },
		expense_receipts: { enabled: false, folderPath: '/Receipts' },
		insurance_docs: { enabled: false, folderPath: '/Insurance' },
		odometer_readings: { enabled: false, folderPath: '/Odometer' }
	};

	let providerId = $derived(page.params.id);
	let provider = $state<UserProviderInfo | null>(null);
	let folderSettings = $state<Record<PhotoCategory, CategorySetting> | null>(null);
	let defaultCategories = new SvelteSet<PhotoCategory>();
	let isLoading = $state(true);
	let error = $state<string | null>(null);

	async function loadProvider() {
		const id = providerId;
		if (!id) {
			error = 'Provider not found';
			isLoading = false;
			return;
		}
		try {
			const [providers, settings] = await Promise.all([
				providerApi.getProviders('storage'),
				settingsApi.getSettings()
			]);
			const found = providers.find(p => p.id === id);
			if (!found) {
				error = 'Provider not found';
				return;
			}
			provider = found;
			const storageConfig: StorageConfig = settings.storageConfig ?? {
				defaults: { vehicle_photos: null, expense_receipts: null, insurance_docs: null, odometer_readings: null },
				providerCategories: {}
			};
			const stored = storageConfig.providerCategories[id];
			folderSettings = stored ? { ...DEFAULT_CATEGORY_SETTINGS, ...stored } : DEFAULT_CATEGORY_SETTINGS;
			// Compute which categories have this provider as the default
			defaultCategories.clear();
			for (const [cat, pid] of Object.entries(storageConfig.defaults)) {
				if (pid === id) defaultCategories.add(cat as PhotoCategory);
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load provider';
		} finally {
			isLoading = false;
		}
	}

	onMount(() => {
		loadProvider();
	});
</script>

<svelte:head>
	<title>{provider?.displayName ?? 'Edit Provider'} - VROOM Car Tracker</title>
	<meta name="description" content="Edit photo storage provider settings" />
</svelte:head>

{#if isLoading}
	<div class="flex items-center justify-center py-12">
		<LoaderCircle class="h-8 w-8 animate-spin text-primary" />
	</div>
{:else if error}
	<div class="max-w-2xl mx-auto text-center py-12">
		<p class="text-sm text-destructive mb-4">{error}</p>
		<button
			type="button"
			class="text-sm text-muted-foreground hover:text-foreground transition-colors"
			onclick={() => goto(resolve(routes.settings))}
		>
			Back to Settings
		</button>
	</div>
{:else if provider && folderSettings}
	<ProviderForm
		{providerId}
		existingProvider={provider}
		existingFolderSettings={folderSettings}
		{defaultCategories}
	/>
{/if}
