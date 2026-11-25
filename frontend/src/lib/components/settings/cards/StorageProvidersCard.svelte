<script lang="ts">
	import { formatDateWith } from '#lib/utils/formatters.ts';
	import { focusFirstButton } from '#lib/utils/focus.ts';
	import { onMount, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import {
		CircleAlert,
		HardDrive,
		Plus,
		LoaderCircle,
		Download,
		Upload,
		RefreshCw
	} from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import * as Select from '#lib/components/ui/select/index.ts';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '#lib/components/ui/card/index.ts';
	import { Separator } from '#lib/components/ui/separator/index.ts';
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
	import type {
		PhotoCategory,
		CategorySetting,
		StorageConfig,
		UserProviderInfo,
		BackupConfig
	} from '#lib/types/index.ts';

	interface Props {
		isBackingUp?: boolean;
		syncInactivityMinutes?: number;
		onBackupNow?: () => void;
		onRestore?: () => void;
		onDownloadBackup?: () => void;
		onSyncInactivityChange?: () => void;
	}

	let {
		isBackingUp = false,
		syncInactivityMinutes = $bindable(5),
		onBackupNow,
		onRestore,
		onDownloadBackup,
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
			appStore.showError(`Couldn't remove the provider. ${userFacingErrorMessage(error)}`);
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

<Card id="storage-providers">
	<CardHeader>
		<div class="flex items-center gap-2">
			<HardDrive class="h-5 w-5 text-muted-foreground" />
			<CardTitle level={3}>Storage Providers</CardTitle>
		</div>
		<CardDescription>Configure storage providers for photos and backups</CardDescription>
	</CardHeader>
	<CardContent bind:ref={content} tabindex={-1}>
		{#if isLoading}
			<div class="flex items-center justify-center py-8">
				<LoaderCircle class="h-8 w-8 animate-spin text-muted-foreground" />
			</div>
		{:else if error}
			<div class="rounded-lg border bg-card p-4">
				<div class="mb-2 flex items-center gap-2 text-destructive">
					<CircleAlert class="h-5 w-5 shrink-0" />
					<p class="font-medium">Couldn't load your storage providers</p>
				</div>
				<p class="mb-3 text-sm text-muted-foreground">{error}</p>
				<Button class="h-10 sm:h-9" onclick={retryLoad}>Retry</Button>
			</div>
		{:else}
			<div class="space-y-4">
				<p class="text-sm font-medium">Data Backups</p>

				{#if unhealthyBackupProviders.length > 0}
					<Alert role="status" variant="warning">
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
								: 'them'} below.
						</AlertDescription>
					</Alert>
				{/if}

				{#if backupProviderCount > 0}
					<div class="text-xs text-muted-foreground">Last backup: {lastBackupText}</div>

					<div class="space-y-2">
						<Label for="inactivity-minutes" class="text-sm">Auto-backup after inactivity</Label>
						<Select.Root
							type="single"
							value={syncInactivityMinutes.toString()}
							onValueChange={v => {
								if (!v || parseInt(v) === syncInactivityMinutes) return;
								syncInactivityMinutes = parseInt(v);
								onSyncInactivityChange?.();
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
				{:else if providers.length > 0}
					<p class="text-sm text-muted-foreground">
						Enable backup on a provider below to sync your data to the cloud.
					</p>
				{/if}

				<div class="flex flex-col sm:flex-row gap-2">
					{#if backupProviderCount > 0}
						<Button variant="outline" onclick={() => onBackupNow?.()} class="h-10 sm:h-9 sm:flex-1">
							<RefreshCw class="mr-2 h-4 w-4" />
							Back Up Now
						</Button>
					{/if}
					<Button
						variant="outline"
						onclick={() => onDownloadBackup?.()}
						disabled={isBackingUp}
						class="h-10 sm:h-9 sm:flex-1"
					>
						{#if isBackingUp}
							<LoaderCircle class="mr-2 h-4 w-4 animate-spin" />
							Downloading...
						{:else}
							<Download class="mr-2 h-4 w-4" />
							Download Backup
						{/if}
					</Button>
					<Button variant="outline" onclick={() => onRestore?.()} class="h-10 sm:h-9 sm:flex-1">
						<Upload class="mr-2 h-4 w-4" />
						Restore
					</Button>
				</div>
			</div>

			{#if providers.length > 0}
				<Separator class="my-6" />

				<DefaultPhotoSources {storageConfig} {providers} onUpdate={handleConfigUpdate} />
			{/if}

			{#if orphanCount > 0}
				<div
					class="mt-4 flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
				>
					<p class="text-sm">
						{photosNoun(orphanCount)}
						{orphanCount === 1 ? 'is' : 'are'} no longer attached to anything.
					</p>
					<Button
						variant="outline"
						class="h-10 shrink-0 sm:h-9"
						onclick={() => (orphanConfirmOpen = true)}
					>
						{orphanCount === 1 ? 'Remove it' : 'Remove them'}
					</Button>
				</div>
			{/if}

			<Separator class="my-6" />

			<div class="space-y-3">
				<div class="flex flex-wrap items-center justify-between gap-2">
					{#if providers.length === 0}
						<p class="text-sm text-muted-foreground">No storage provider connected</p>
					{:else}
						<p class="text-sm font-medium">Providers</p>
					{/if}
					<Button
						variant="outline"
						size="sm"
						class="h-10 sm:h-8"
						onclick={() => goto(resolve(routes.settingsProviderNew))}
					>
						<Plus class="h-4 w-4 mr-1" />
						Add Storage Provider
					</Button>
				</div>

				{#if providers.length > 0}
					<div class="space-y-3">
						{#each providers as provider (provider.id)}
							<ProviderCard
								{provider}
								categorySettings={getCategorySettings(provider.id)}
								backupEnabled={backupConfig.providers[provider.id]?.enabled ?? false}
								sheetsSyncEnabled={backupConfig.providers[provider.id]?.sheetsSyncEnabled ?? false}
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
					</div>
				{/if}
			</div>
		{/if}
	</CardContent>
</Card>

<ConfirmDialog
	bind:open={deleteConfirmOpen}
	title="Delete {pendingDelete?.displayName ?? 'provider'}?"
	description="Backups to this provider stop and its settings are removed from VROOM. Your files stay in the provider itself."
	onConfirm={async () => {
		if (pendingDelete) await handleProviderDelete(pendingDelete);
	}}
/>

<ConfirmDialog
	bind:open={photoLossConfirmOpen}
	title="Delete {photoLossConfirm?.provider.displayName ?? 'provider'}?"
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
