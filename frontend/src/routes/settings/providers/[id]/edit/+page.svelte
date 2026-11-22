<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { ArrowLeft, CircleAlert, LoaderCircle } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import FormLayout from '#lib/components/common/form-layout.svelte';
	import PageHeader from '#lib/components/common/page-header.svelte';
	import ProviderForm from '#lib/components/settings/storage-provider/form/ProviderForm.svelte';
	import { providerApi } from '#lib/services/provider-api.ts';
	import { settingsStore } from '#lib/stores/settings.svelte.ts';
	import { routes } from '#lib/routes.ts';
	import { userFacingErrorMessage } from '#lib/utils/error-handling.ts';
	import type {
		PhotoCategory,
		CategorySetting,
		StorageConfig,
		UserProviderInfo
	} from '#lib/types/index.ts';

	const DEFAULT_CATEGORY_SETTINGS: Record<PhotoCategory, CategorySetting> = {
		vehicle_photos: { enabled: false, folderPath: 'Vehicle' },
		expense_receipts: { enabled: false, folderPath: 'Receipts' },
		insurance_docs: { enabled: false, folderPath: 'Insurance' },
		odometer_readings: { enabled: false, folderPath: 'Odometer' }
	};

	let providerId = $derived(page.params.id);
	let provider = $state<UserProviderInfo | null>(null);
	let folderSettings = $state<Record<PhotoCategory, CategorySetting> | null>(null);
	let defaultCategories = new SvelteSet<PhotoCategory>();
	let isLoading = $state(true);
	let notFound = $state(false);
	let error = $state<string | null>(null);
	let stateCard = $state<HTMLElement | null>(null);

	async function loadProvider() {
		const id = providerId;
		if (!id) {
			notFound = true;
			isLoading = false;
			return;
		}
		try {
			const [providers, settings] = await Promise.all([
				providerApi.getProviders('storage'),
				settingsStore.ensureLoaded()
			]);
			const found = providers.find(p => p.id === id);
			if (!found) {
				notFound = true;
				return;
			}
			provider = found;
			const storageConfig: StorageConfig = settings.storageConfig ?? {
				defaults: {
					vehicle_photos: null,
					expense_receipts: null,
					insurance_docs: null,
					odometer_readings: null
				},
				providerCategories: {}
			};
			const stored = storageConfig.providerCategories[id];
			folderSettings = stored
				? { ...DEFAULT_CATEGORY_SETTINGS, ...stored }
				: DEFAULT_CATEGORY_SETTINGS;
			defaultCategories.clear();
			for (const [cat, pid] of Object.entries(storageConfig.defaults)) {
				if (pid === id) defaultCategories.add(cat as PhotoCategory);
			}
		} catch (e) {
			error = userFacingErrorMessage(e);
		} finally {
			isLoading = false;
		}
	}

	onMount(() => {
		loadProvider();
	});

	async function retryLoad() {
		isLoading = true;
		error = null;
		await loadProvider();
		await tick();
		stateCard?.querySelector('button')?.focus();
	}

	function backToSettings() {
		goto(resolve(routes.settings));
	}
</script>

<svelte:head>
	<title>{provider?.displayName ?? 'Edit Provider'} - VROOM Car Tracker</title>
	<meta name="description" content="Edit photo storage provider settings" />
</svelte:head>

{#snippet header()}
	<PageHeader title="Edit Provider" description="Update your storage provider configuration">
		{#snippet back()}
			<Button
				variant="ghost"
				size="icon-lg"
				class="shrink-0"
				aria-label="Back to Settings"
				onclick={backToSettings}
			>
				<ArrowLeft class="size-5" />
			</Button>
		{/snippet}
	</PageHeader>
{/snippet}

{#if isLoading || notFound || error}
	<FormLayout>
		<div class="space-y-6">
			{@render header()}
			{#if isLoading}
				<div class="flex items-center justify-center py-12" role="status">
					<LoaderCircle class="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
					<span class="sr-only">Loading provider</span>
				</div>
			{:else}
				<div class="rounded-lg border bg-card p-6" bind:this={stateCard}>
					<div role={notFound ? undefined : 'alert'}>
						<div class="mb-4 flex items-center gap-3 text-destructive">
							<CircleAlert class="h-5 w-5" aria-hidden="true" />
							<p class="font-medium">
								{notFound ? 'Provider not found' : "Couldn't load this provider"}
							</p>
						</div>
						<p class="mb-4 text-sm text-muted-foreground">
							{notFound
								? 'It may have been removed. Go back to Settings to see your storage providers.'
								: error}
						</p>
					</div>
					{#if notFound}
						<Button size="lg" variant="outline" onclick={backToSettings}>Back to Settings</Button>
					{:else}
						<Button size="lg" onclick={retryLoad}>Retry</Button>
					{/if}
				</div>
			{/if}
		</div>
	</FormLayout>
{:else if provider && folderSettings}
	<ProviderForm
		{providerId}
		existingProvider={provider}
		existingFolderSettings={folderSettings}
		{defaultCategories}
	/>
{/if}
