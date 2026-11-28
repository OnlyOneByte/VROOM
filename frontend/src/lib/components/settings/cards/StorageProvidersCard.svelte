<script lang="ts">
	import { formatDateWith } from '#lib/utils/formatters.ts';
	import { focusFirstButton } from '#lib/utils/focus.ts';
	import { onMount, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { CircleAlert, Plus, LoaderCircle, Upload, RefreshCw } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import * as Select from '#lib/components/ui/select/index.ts';
	import {
		Card,
		CardAction,
		CardContent,
		CardHeader,
		CardTitle
	} from '#lib/components/ui/card/index.ts';
	import DefaultPhotoSources from '../storage-provider/DefaultPhotoSources.svelte';
	import { Alert, AlertDescription, AlertTitle } from '#lib/components/ui/alert/index.ts';
	import { startGoogleConnect } from '../storage-provider/use-google-oauth.svelte.ts';
	import { providerCatalog } from '#lib/stores/provider-catalog.svelte.ts';
	import ProviderCard from '../storage-provider/ProviderInfoCard.svelte';
	import { photosOnlyOnProvider, providerApi } from '#lib/services/provider-api.ts';
	import { orphanedPhotosApi } from '#lib/services/photo-api.ts';
	import { userFacingErrorMessage } from '#lib/utils/error-handling.ts';
	import ConfirmDialog from '#lib/components/common/ConfirmDialog.svelte';
	import { settingsStore } from '#lib/stores/settings.svelte.ts';
	import { fetchLastSyncTime } from '#lib/utils/sync/sync-manager.ts';
	import { appStore } from '#lib/stores/app.svelte.ts';
	import { routes, paramRoutes } from '#lib/routes.ts';
	import { supportsZipBackup } from '#lib/constants/providers.ts';
	import type {
		PhotoCategory,
		CategorySetting,
		StorageConfig,
		UserProviderInfo,
		BackupConfig
	} from '#lib/types/index.ts';

	interface Props {
		syncInactivityMinutes?: number;
		onBackupNow?: () => void;
		onRestore?: () => void;
		onSyncInactivityChange?: () => void;
	}

	let {
		syncInactivityMinutes = $bindable(5),
		onBackupNow,
		onRestore,
		onSyncInactivityChange
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
	let storageConfig = $derived<StorageConfig>(
		settingsStore.settings?.storageConfig ?? DEFAULT_STORAGE_CONFIG
	);
	let backupConfig = $derived<BackupConfig>(
		settingsStore.settings?.backupConfig ?? { providers: {} }
	);
	let isLoading = $state(true);
	let error = $state<string | null>(null);
	let content = $state<HTMLElement | null>(null);

	async function loadData() {
		try {
			const [providerList] = await Promise.all([
				providerApi.getProviders('storage'),
				settingsStore.ensureLoaded()
			]);
			providers = providerList;
		} catch (e) {
			if (import.meta.env.DEV) console.error('Failed to load storage providers:', e);
			error = userFacingErrorMessage(e);
		} finally {
			isLoading = false;
		}
	}

	let orphanCount = $state(0);
	let orphanConfirmOpen = $state(false);
	const photosNoun = (n: number) => (n === 1 ? '1 photo' : `${n} photos`);
	let orphanConfirmDescription = $derived(
		orphanCount === 1
			? "This photo belongs to a vehicle, expense, odometer reading or insurance record that was deleted. VROOM deletes it and its file in your storage providers. This can't be undone."
			: "These photos belong to vehicles, expenses, odometer readings or insurance records that were deleted. VROOM deletes them and their files in your storage providers. This can't be undone."
	);

	async function loadOrphanCount() {
		try {
			orphanCount = await orphanedPhotosApi.count();
		} catch (e) {
			if (import.meta.env.DEV) console.error('Failed to count orphaned photos:', e);
			orphanCount = 0;
		}
	}

	async function removeOrphanedPhotos() {
		try {
			const { removed, failed } = await orphanedPhotosApi.remove();
			if (removed > 0) appStore.showSuccess(`Removed ${photosNoun(removed)}`);
			if (failed > 0) {
				appStore.showError(
					`Couldn't delete ${photosNoun(failed)} from your storage providers. ${failed === 1 ? 'It stays' : 'They stay'} listed here so you can try again later.`
				);
			}
		} catch (e) {
			appStore.showError(`Couldn't remove the photos. ${userFacingErrorMessage(e)}`);
		} finally {
			await loadOrphanCount();
		}
	}

	async function retryLoad() {
		isLoading = true;
		error = null;
		await loadData();
		await tick();
		focusFirstButton(content);
	}

	onMount(() => {
		loadData();
		loadOrphanCount();
	});

	async function handleConfigUpdate(config: StorageConfig) {
		try {
			await settingsStore.update({ storageConfig: config });
			appStore.showSuccess('Photo storage settings updated');
		} catch (e) {
			appStore.showError(`Couldn't save the photo storage settings. ${userFacingErrorMessage(e)}`);
		}
	}

	async function handleProviderEdit(provider: UserProviderInfo) {
		goto(resolve(paramRoutes.settingsProviderEdit, { id: provider.id }));
	}

	function handleProviderReconnect(provider: UserProviderInfo) {
		const entry = providerCatalog.storage.find(e => e.id === provider.providerType);
		if (entry?.connect !== 'oauth') {
			handleProviderEdit(provider);
			return;
		}
		const email = provider.config['accountEmail'];
		startGoogleConnect({
			isEditMode: true,
			providerId: provider.id,
			...(typeof email === 'string' && { existingEmail: email }),
			displayName: provider.displayName,
			selectedType: provider.providerType
		});
	}

	let deleteConfirmOpen = $state(false);
	let pendingDelete = $state<UserProviderInfo | null>(null);

	function requestProviderDelete(provider: UserProviderInfo) {
		pendingDelete = provider;
		deleteConfirmOpen = true;
	}

	let photoLossConfirmOpen = $state(false);
	let photoLossConfirm = $state<{ provider: UserProviderInfo; message: string } | null>(null);

	async function handleProviderDelete(provider: UserProviderInfo, force = false) {
		try {
			await providerApi.deleteProvider(provider.id, { force });
			appStore.showSuccess(`${provider.displayName} removed`);
			await Promise.all([loadData(), settingsStore.load()]);
		} catch (error) {
			if (photosOnlyOnProvider(error) !== null && error instanceof Error) {
				photoLossConfirm = { provider, message: error.message };
				photoLossConfirmOpen = true;
				return;
			}
			appStore.showError(`Couldn't remove the storage. ${userFacingErrorMessage(error)}`);
		}
	}

	function getCategorySettings(providerId: string): Record<PhotoCategory, CategorySetting> {
		const stored = storageConfig.providerCategories[providerId];
		if (!stored) return DEFAULT_CATEGORY_SETTINGS;
		return { ...DEFAULT_CATEGORY_SETTINGS, ...stored };
	}

	let unhealthyBackupProviders = $derived(
		providers.filter(
			p =>
				(p.status === 'needs_reauth' || p.status === 'error') &&
				(backupConfig.providers[p.id]?.enabled || backupConfig.providers[p.id]?.sheetsSyncEnabled)
		)
	);

	let backupProviderCount = $derived(
		Object.values(backupConfig.providers).filter(p => p.enabled || p.sheetsSyncEnabled).length
	);
	let canBackUpNow = $derived(providers.some(p => supportsZipBackup(p.providerType)));

	let lastBackupText = $derived.by(() => {
		let latest: string | null = null;
		for (const settings of Object.values(backupConfig.providers)) {
			if (settings.lastBackupAt && (!latest || settings.lastBackupAt > latest)) {
				latest = settings.lastBackupAt;
			}
		}
		if (!latest) return 'Never';
		return formatDateWith(new Date(latest), {
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
			await settingsStore.update({ backupConfig: updatedConfig });
			await fetchLastSyncTime();
			appStore.showSuccess(
				enabled ? 'ZIP backup enabled for provider' : 'ZIP backup disabled for provider'
			);
		} catch (e) {
			appStore.showError(`Couldn't save the backup settings. ${userFacingErrorMessage(e)}`);
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
			await settingsStore.update({ backupConfig: updatedConfig });
			await fetchLastSyncTime();
			appStore.showSuccess(
				enabled ? 'Sheets sync enabled for provider' : 'Sheets sync disabled for provider'
			);
		} catch (e) {
			appStore.showError(`Couldn't save the backup settings. ${userFacingErrorMessage(e)}`);
		}
	}
</script>

<div bind:this={content} tabindex="-1" class="outline-none">
	{#if isLoading}
		<div class="flex items-center justify-center py-8" role="status">
			<LoaderCircle class="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
			<span class="sr-only">Loading your storage</span>
		</div>
	{:else if error}
		<div class="rounded-(--r-lg) border bg-card p-4">
			<div class="mb-2 flex items-center gap-2 text-destructive">
				<CircleAlert class="h-5 w-5 shrink-0" aria-hidden="true" />
				<p class="font-medium">Couldn't load your storage providers</p>
			</div>
			<p class="mb-3 text-sm text-muted-foreground">{error}</p>
			<Button onclick={retryLoad}>Retry</Button>
		</div>
	{:else}
		<div class="grid gap-x-12 gap-y-6 lg:grid-cols-2 lg:items-start">
			<div class="space-y-6">
				<Card variant="section" role="region" aria-labelledby="storage-connected">
					<CardHeader>
						<CardTitle level={2} id="storage-connected" class="text-base">Connected</CardTitle>
						<CardAction>
							<Button variant="outline" onclick={() => goto(resolve(routes.settingsProviderNew))}>
								<Plus aria-hidden="true" />
								Add storage
							</Button>
						</CardAction>
					</CardHeader>
					<CardContent class="space-y-3">
						{#if providers.length === 0}
							<p class="text-sm text-muted-foreground">
								No storage connected yet. Add Google Drive, S3 or another provider to keep photos
								and backups in an account you own.
							</p>
						{:else}
							{#each providers as provider (provider.id)}
								<ProviderCard
									{provider}
									categorySettings={getCategorySettings(provider.id)}
									backupEnabled={backupConfig.providers[provider.id]?.enabled ?? false}
									sheetsSyncEnabled={backupConfig.providers[provider.id]?.sheetsSyncEnabled ??
										false}
									lastBackupAt={backupConfig.providers[provider.id]?.lastBackupAt}
									onEdit={handleProviderEdit}
									onReconnect={handleProviderReconnect}
									onDelete={requestProviderDelete}
									onBackupToggle={handleBackupToggle}
									onSheetsSyncToggle={handleSheetsSyncToggle}
									onUpdated={updated =>
										(providers = providers.map(p => (p.id === updated.id ? updated : p)))}
								/>
							{/each}
						{/if}
					</CardContent>
				</Card>

				{#if providers.length > 0 || orphanCount > 0}
					<Card variant="section" role="region" aria-labelledby="storage-photos">
						<CardHeader>
							<CardTitle level={2} id="storage-photos" class="text-base">Photos</CardTitle>
						</CardHeader>
						<CardContent class="space-y-4">
							{#if providers.length > 0}
								<DefaultPhotoSources {storageConfig} {providers} onUpdate={handleConfigUpdate} />
							{/if}
							{#if orphanCount > 0}
								<div class="flex items-center justify-between gap-4">
									<p class="text-sm">
										{photosNoun(orphanCount)}
										{orphanCount === 1 ? 'is' : 'are'} no longer attached to anything.
									</p>
									<Button variant="outline" onclick={() => (orphanConfirmOpen = true)}>
										{orphanCount === 1 ? 'Remove it' : 'Remove them'}
									</Button>
								</div>
							{/if}
						</CardContent>
					</Card>
				{/if}
			</div>

			<Card variant="section" role="region" aria-labelledby="storage-backups">
				<CardHeader>
					<CardTitle level={2} id="storage-backups" class="text-base">
						Back up now and restore
					</CardTitle>
				</CardHeader>
				<CardContent class="divide-y">
					{#if unhealthyBackupProviders.length > 0}
						<Alert role="status" variant="warning" class="mb-3">
							<CircleAlert aria-hidden="true" />
							<AlertTitle class="line-clamp-none">
								{unhealthyBackupProviders.length === 1
									? '1 backup provider needs attention.'
									: `${unhealthyBackupProviders.length} backup providers need attention.`}
							</AlertTitle>
							<AlertDescription class="text-foreground!">
								Your backups may not reach {new Intl.ListFormat('en', {
									type: 'conjunction'
								}).format(unhealthyBackupProviders.map(p => p.displayName))} until you fix {unhealthyBackupProviders.length ===
								1
									? 'it'
									: 'them'} under Connected.
							</AlertDescription>
						</Alert>
					{/if}

					<div class="flex items-center justify-between gap-4 py-3 first:pt-0">
						<div class="min-w-0">
							<p class="font-medium">Back up now</p>
							<p class="text-sm text-muted-foreground">
								{#if backupProviderCount > 0}
									Sends a copy to every provider with backups on. Last backup: {lastBackupText}
								{:else if canBackUpNow}
									No provider has backups on. You can still send one backup to a provider you
									choose.
								{:else if providers.length > 0}
									Turn on backups for a provider under Connected first.
								{:else}
									Add storage first, then turn on its backups.
								{/if}
							</p>
						</div>
						{#if backupProviderCount > 0 || canBackUpNow}
							<Button onclick={() => onBackupNow?.()}>
								<RefreshCw aria-hidden="true" />
								Back up now
							</Button>
						{/if}
					</div>

					{#if backupProviderCount > 0}
						<div class="flex items-center justify-between gap-4 py-3">
							<div class="min-w-0">
								<label for="inactivity-minutes" class="font-medium">Back up automatically</label>
								<p class="text-sm text-muted-foreground">After this long without changes</p>
							</div>
							<Select.Root
								type="single"
								value={syncInactivityMinutes.toString()}
								onValueChange={v => {
									if (!v || parseInt(v) === syncInactivityMinutes) return;
									syncInactivityMinutes = parseInt(v);
									onSyncInactivityChange?.();
								}}
							>
								<Select.Trigger id="inactivity-minutes" class="w-auto shrink-0">
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
					{/if}

					<div class="flex items-center justify-between gap-4 pt-3">
						<div class="min-w-0">
							<p class="font-medium">Restore</p>
							<p class="text-sm text-muted-foreground">Bring your data back from a backup file</p>
						</div>
						<Button variant="outline" onclick={() => onRestore?.()}>
							<Upload aria-hidden="true" />
							Restore…
						</Button>
					</div>
				</CardContent>
			</Card>
		</div>
	{/if}
</div>

<ConfirmDialog
	bind:open={deleteConfirmOpen}
	title="Delete {pendingDelete?.displayName ?? 'storage'}?"
	description="VROOM stops backing up here and removes this storage's settings. Your files stay in the storage itself."
	onConfirm={async () => {
		if (pendingDelete) await handleProviderDelete(pendingDelete);
	}}
/>

<ConfirmDialog
	bind:open={photoLossConfirmOpen}
	title="Delete {photoLossConfirm?.provider.displayName ?? 'storage'}?"
	description={photoLossConfirm?.message ?? ''}
	confirmLabel="Delete anyway"
	onConfirm={async () => {
		if (photoLossConfirm) await handleProviderDelete(photoLossConfirm.provider, true);
	}}
/>

<ConfirmDialog
	bind:open={orphanConfirmOpen}
	title="Remove {photosNoun(orphanCount)}?"
	description={orphanConfirmDescription}
	confirmLabel="Remove"
	onConfirm={removeOrphanedPhotos}
/>
