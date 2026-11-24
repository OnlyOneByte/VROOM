<script lang="ts">
	import { goto } from '$app/navigation';
	import PageHeader from '#lib/components/common/page-header.svelte';
	import { resolve } from '$app/paths';
	import { ArrowLeft, Cloud, LoaderCircle, Save, Trash2 } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.ts';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '#lib/components/ui/card/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import ProviderFolderSettings from './PhotoFolderSection.svelte';
	import BackupSection from './BackupSection.svelte';
	import { useGoogleOAuth } from '../use-google-oauth.svelte';
	import { photosOnlyOnProvider, providerApi } from '#lib/services/provider-api.ts';
	import ConfirmDialog from '#lib/components/common/ConfirmDialog.svelte';
	import LoadErrorCard from '#lib/components/common/LoadErrorCard.svelte';
	import { settingsStore } from '#lib/stores/settings.svelte.ts';
	import { appStore } from '#lib/stores/app.svelte.ts';
	import FormLayout from '#lib/components/common/form-layout.svelte';
	import { routes } from '#lib/routes.ts';
	import {
		defaultFolderSettings,
		providerUi,
		supportsSheetsBackup,
		supportsZipBackup,
		type ProviderConnection
	} from '#lib/constants/providers.ts';
	import { providerCatalog } from '#lib/stores/provider-catalog.svelte.ts';
	import ProviderFields, {
		fieldConfig,
		fieldErrorsFrom,
		fieldSecrets,
		fieldsReady,
		initialFieldValues
	} from '../../ProviderFields.svelte';
	import type {
		PhotoCategory,
		CategorySetting,
		StorageConfig,
		UserProviderInfo,
		BackupConfig,
		ProviderBackupSettings
	} from '#lib/types/index.ts';
	import { onMount } from 'svelte';
	import { trackPendingSave } from '#lib/utils/pending-saves.ts';
	import { userFacingErrorMessage } from '#lib/utils/error-handling.ts';
	import { focusFirstProblem } from '#lib/utils/focus.ts';

	let providerTypes = $derived(
		providerCatalog.storage.map(entry => ({
			id: entry.id,
			icon: providerUi(entry.id)?.icon ?? Cloud,
			label: entry.shortLabel,
			description: entry.description
		}))
	);

	let {
		providerId,
		existingProvider,
		existingFolderSettings,
		defaultCategories = new Set<PhotoCategory>()
	}: {
		providerId?: string;
		existingProvider?: UserProviderInfo;
		existingFolderSettings?: Record<PhotoCategory, CategorySetting>;
		defaultCategories?: Set<PhotoCategory>;
	} = $props();

	let isEditMode = $derived(!!providerId && !!existingProvider);

	let selectedType = $state<string | null>(null);
	let selectedForm = $derived(providerUi(selectedType)?.form ?? null);
	let selectedEntry = $derived(providerCatalog.storageEntry(selectedType));
	let usesFields = $derived(!selectedForm && selectedEntry?.connect === 'form');
	let storedConfig = $derived(isEditMode ? existingProvider?.config : undefined);
	let storedSecrets = $derived(isEditMode ? existingProvider?.secretsSet : undefined);
	let fieldValues = $state<Record<string, string>>({});
	let secretValues = $state<Record<string, string>>({});
	let fieldErrors = $state<Record<string, string>>({});
	let connectionCard = $state<HTMLElement | null>(null);

	function resetFields(providerType: string, stored: Record<string, unknown> | undefined) {
		const entry = providerCatalog.storageEntry(providerType);
		fieldValues = entry ? initialFieldValues(entry, stored) : {};
		secretValues = {};
		fieldErrors = {};
	}
	let displayName = $state('');
	let isSaving = $state(false);

	onMount(() => trackPendingSave(() => isSaving));
	let isDeleting = $state(false);

	const oauth = useGoogleOAuth(() => ({
		isEditMode,
		providerId,
		existingEmail: (existingProvider?.config?.['accountEmail'] as string) ?? undefined,
		displayName,
		selectedType
	}));

	const restoredState = oauth.restoreFormState();
	if (restoredState) {
		if (restoredState.selectedType) selectedType = restoredState.selectedType;
		if (restoredState.displayName) displayName = restoredState.displayName;
	}

	let connection = $state<ProviderConnection>({ ready: false, config: {}, credentials: {} });

	let providerRootPath = $state('VROOM');
	let photoRootPath = $state(getDefaultPhotoRootPath('google-drive'));

	let folderSettings = $state<Record<PhotoCategory, CategorySetting>>(
		defaultFolderSettings(restoredState?.selectedType)
	);

	let backupEnabled = $state(false);
	let backupFolderPath = $state('Backups');
	let backupRetentionCount = $state(10);
	let sheetsSyncEnabled = $state(false);
	let sheetsSpreadsheetId = $state('');
	let backupConfig = $state<BackupConfig>({ providers: {} });
	let storageDefaults = $state<Partial<StorageConfig['defaults']>>({});

	let providerRootPrefix = $derived(
		providerRootPath ? `${providerRootPath.replace(/\/+$/, '')}/` : ''
	);

	let folderPathError = $derived.by(() => {
		if (!backupFolderPath.trim()) return 'Folder path is required';
		if (backupFolderPath.length > 255) return 'Folder path must be 255 characters or less';
		if (backupFolderPath.includes('..')) return 'Folder path must not contain ".."';
		return null;
	});
	let retentionCountError = $derived.by(() => {
		if (!Number.isInteger(backupRetentionCount)) return 'Must be a whole number';
		if (backupRetentionCount < 1 || backupRetentionCount > 100) return 'Must be between 1 and 100';
		return null;
	});
	let hasBackupErrors = $derived(!!(folderPathError || retentionCountError));
	let anyBackupEnabled = $derived(backupEnabled || sheetsSyncEnabled);

	let initialized = $state(false);
	$effect(() => {
		if (existingProvider && !initialized) {
			selectedType = existingProvider.providerType;
			displayName = existingProvider.displayName;
			providerRootPath = (existingProvider.config?.['providerRootPath'] as string) || 'VROOM';
			photoRootPath =
				(existingProvider.config?.['photoRootPath'] as string) ||
				getDefaultPhotoRootPath(existingProvider.providerType);
			if (existingFolderSettings) {
				folderSettings = { ...existingFolderSettings };
			}
			resetFields(existingProvider.providerType, existingProvider.config);
			initialized = true;
		}
	});

	async function loadSettings() {
		try {
			const settings = await settingsStore.ensureLoaded();
			backupConfig = settings.backupConfig ?? { providers: {} };
			storageDefaults = settings.storageConfig?.defaults ?? {};
			if (providerId) {
				const providerSettings = backupConfig.providers[providerId];
				if (providerSettings) {
					backupEnabled = providerSettings.enabled;
					backupFolderPath = providerSettings.folderPath || 'Backups';
					backupRetentionCount = providerSettings.retentionCount || 10;
					sheetsSyncEnabled = providerSettings.sheetsSyncEnabled ?? false;
					sheetsSpreadsheetId = providerSettings.sheetsSpreadsheetId ?? '';
				}
			}
		} catch {
			// Backup settings are optional.
		}
	}

	onMount(async () => {
		const [, oauthResult] = await Promise.all([
			loadSettings(),
			oauth.handleOAuthReturn(),
			providerCatalog.load()
		]);
		if (oauthResult.restoredSelectedType) {
			selectedType = oauthResult.restoredSelectedType;
			if (!isEditMode) {
				folderSettings = defaultFolderSettings(selectedType);
				photoRootPath = getDefaultPhotoRootPath(selectedType);
				resetFields(selectedType, undefined);
			}
		}
		if (oauthResult.restoredDisplayName) displayName = oauthResult.restoredDisplayName;
	});

	function handleFolderSettingsUpdate(settings: Record<PhotoCategory, CategorySetting>) {
		folderSettings = settings;
	}

	function getDefaultPhotoRootPath(providerType: string): string {
		return providerCatalog.storageEntry(providerType)?.features.defaultPhotoRootPath ?? 'photos';
	}

	let canSave = $derived.by(() => {
		if (!selectedType || !displayName.trim()) return false;
		if (hasBackupErrors && anyBackupEnabled) return false;
		if (selectedForm) return connection.ready;
		if (usesFields && selectedEntry) {
			return fieldsReady(selectedEntry, fieldValues, secretValues, storedConfig, storedSecrets);
		}
		return true;
	});

	function navigateBack() {
		goto(resolve(routes.settings));
	}

	async function handleSave() {
		if (!selectedType || !displayName.trim()) return;

		isSaving = true;
		try {
			const { credentials, nonce } = selectedForm
				? connection
				: {
						credentials:
							usesFields && selectedEntry ? fieldSecrets(selectedEntry, secretValues) : {},
						nonce: undefined
					};
			const config: Record<string, unknown> = {
				...(existingProvider?.config ?? {}),
				providerRootPath: providerRootPath.trim(),
				photoRootPath: photoRootPath.trim() || getDefaultPhotoRootPath(selectedType),
				...(selectedForm && connection.config),
				...(usesFields && selectedEntry && fieldConfig(selectedEntry, fieldValues))
			};

			let resultId: string;

			if (isEditMode && providerId) {
				const updateData: {
					displayName: string;
					config: Record<string, unknown>;
					credentials?: Record<string, unknown>;
				} = {
					displayName: displayName.trim(),
					config
				};
				if (Object.keys(credentials).length > 0) {
					updateData.credentials = credentials;
				}
				await providerApi.updateProvider(providerId, updateData);
				resultId = providerId;
			} else {
				const created = await providerApi.createProvider({
					domain: 'storage',
					providerType: selectedType,
					displayName: displayName.trim(),
					credentials,
					config,
					...(nonce ? { nonce } : {})
				});
				resultId = created.id;
			}

			const unsaved: string[] = [];

			try {
				await settingsStore.update({
					storageConfig: {
						defaults: storageDefaults as StorageConfig['defaults'],
						providerCategories: {
							[resultId]: folderSettings
						}
					}
				});
			} catch {
				unsaved.push('folder settings');
			}

			if (backupEnabled || sheetsSyncEnabled || backupConfig.providers[resultId]) {
				try {
					const providerBackup: ProviderBackupSettings = {
						enabled: backupEnabled && supportsZipBackup(selectedType),
						folderPath: backupFolderPath.trim() || 'Backups',
						retentionCount: backupRetentionCount,
						...(supportsSheetsBackup(selectedType) && {
							sheetsSyncEnabled,
							sheetsSpreadsheetId: sheetsSpreadsheetId || undefined
						})
					};
					const existing = backupConfig.providers[resultId];
					if (existing?.lastBackupAt) {
						providerBackup.lastBackupAt = existing.lastBackupAt;
					}
					const updatedBackupConfig: BackupConfig = {
						providers: {
							...backupConfig.providers,
							[resultId]: providerBackup
						}
					};
					await settingsStore.update({ backupConfig: updatedBackupConfig });
				} catch {
					unsaved.push('backup settings');
				}
			}

			const name = displayName.trim();
			const verb = isEditMode ? 'updated' : 'added';
			if (unsaved.length > 0) {
				appStore.showWarning(
					`${name} ${verb}, but its ${unsaved.join(' and ')} couldn't be saved. Re-open the provider to try again.`
				);
			} else {
				appStore.showSuccess(`${name} ${verb} successfully`);
			}
			navigateBack();
		} catch (error) {
			if (selectedEntry) fieldErrors = fieldErrorsFrom(error, selectedEntry);
			if (Object.keys(fieldErrors).length > 0) void focusFirstProblem(connectionCard);
			appStore.showError(
				`Couldn't ${isEditMode ? 'update' : 'add'} the provider. ${userFacingErrorMessage(error)}`
			);
		} finally {
			isSaving = false;
		}
	}

	let deleteConfirmOpen = $state(false);
	let photoLossMessage = $state('');
	let photoLossConfirmOpen = $state(false);

	async function handleDelete(force = false) {
		if (!providerId) return;
		isDeleting = true;
		try {
			await providerApi.deleteProvider(providerId, { force });
			appStore.showSuccess(`${displayName.trim()} removed`);
			navigateBack();
		} catch (error) {
			if (photosOnlyOnProvider(error) !== null && error instanceof Error) {
				photoLossMessage = error.message;
				photoLossConfirmOpen = true;
				return;
			}
			appStore.showError(`Couldn't remove the provider. ${userFacingErrorMessage(error)}`);
		} finally {
			isDeleting = false;
		}
	}
</script>

<FormLayout>
	<div class="mb-6">
		<PageHeader
			title={isEditMode ? 'Edit Provider' : 'Add Storage Provider'}
			description={isEditMode
				? 'Update your storage provider configuration'
				: 'Connect a new storage provider for your photos and backups'}
		>
			{#snippet back()}
				<Button
					variant="ghost"
					size="icon-lg"
					class="shrink-0"
					aria-label="Back to Settings"
					onclick={navigateBack}
				>
					<ArrowLeft class="size-5" />
				</Button>
			{/snippet}
		</PageHeader>
	</div>

	<div class="space-y-6 pb-32 sm:pb-24">
		{#if isEditMode}
			{@const pt = providerTypes.find(p => p.id === selectedType)}
			{#if pt}
				{@const Icon = pt.icon}
				<div class="flex items-center gap-3 rounded-lg border border-border p-3">
					<div class="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
						<Icon class="h-5 w-5 text-muted-foreground" />
					</div>
					<div>
						<p class="text-sm font-medium">{pt.label}</p>
						<p class="text-xs text-muted-foreground">{pt.description}</p>
					</div>
				</div>
			{/if}
		{:else}
			<Card>
				<CardHeader>
					<CardTitle class="text-base">Provider Type</CardTitle>
					<CardDescription>Choose your storage provider</CardDescription>
				</CardHeader>
				<CardContent>
					{#if providerCatalog.error && !providerCatalog.loaded}
						<LoadErrorCard
							compact
							title="Couldn't load the provider types"
							message={providerCatalog.error}
							onRetry={() => providerCatalog.load()}
						/>
					{:else if !providerCatalog.loaded}
						<div class="flex justify-center py-6" role="status">
							<LoaderCircle class="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
							<span class="sr-only">Loading provider types</span>
						</div>
					{/if}
					<div class="grid grid-cols-2 gap-2">
						{#each providerTypes as pt (pt.id)}
							{@const Icon = pt.icon}
							<button
								type="button"
								class="relative flex flex-col items-center gap-2 rounded-lg border p-3 text-center transition-colors
									{selectedType === pt.id
									? 'border-primary bg-primary/5'
									: 'border-border hover:border-primary/50 hover:bg-muted/50 cursor-pointer'}"
								onclick={() => {
									selectedType = pt.id;
									photoRootPath = getDefaultPhotoRootPath(pt.id);
									folderSettings = defaultFolderSettings(pt.id);
									resetFields(pt.id, undefined);
								}}
							>
								<Icon
									class="h-6 w-6 {selectedType === pt.id
										? 'text-primary'
										: 'text-muted-foreground'}"
								/>
								<span class="text-sm font-medium">{pt.label}</span>
							</button>
						{/each}
					</div>
				</CardContent>
			</Card>
		{/if}

		{#if selectedType && providerCatalog.loaded}
			<Card>
				<CardHeader>
					<CardTitle class="text-base">Display Name</CardTitle>
					<CardDescription>A friendly name for this provider</CardDescription>
				</CardHeader>
				<CardContent>
					<div class="space-y-2">
						<Label for="provider-name">Name</Label>
						<Input
							id="provider-name"
							bind:value={displayName}
							placeholder="My {providerTypes.find(p => p.id === selectedType)?.label ?? 'Provider'}"
						/>
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle class="text-base">Connection Settings</CardTitle>
					<CardDescription>
						{selectedForm?.description ?? selectedEntry?.description ?? 'Provider configuration'}
					</CardDescription>
				</CardHeader>
				<CardContent class="space-y-4" bind:ref={connectionCard}>
					{#if selectedForm}
						{@const ConnectionForm = selectedForm.component}
						<ConnectionForm
							existingConfig={existingProvider?.config}
							{isEditMode}
							{oauth}
							bind:connection
						/>
					{:else if usesFields && selectedEntry}
						<ProviderFields
							idPrefix="provider-{selectedEntry.id}"
							spec={selectedEntry}
							stored={storedConfig}
							savedSecrets={storedSecrets}
							bind:values={fieldValues}
							bind:secretValues
							errors={fieldErrors}
						/>
					{/if}

					<div class="space-y-2 border-t border-border pt-4">
						<Label for="provider-root-path" class="text-sm">Provider root path</Label>
						<Input id="provider-root-path" bind:value={providerRootPath} placeholder="VROOM" />
						<p class="text-xs text-muted-foreground">
							Top-level folder on the provider. All other paths are relative to this.
						</p>
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle class="text-base">Photo Folder Settings</CardTitle>
					<CardDescription>Configure where each photo category is stored</CardDescription>
				</CardHeader>
				<CardContent>
					<ProviderFolderSettings
						bind:photoRootPath
						categorySettings={folderSettings}
						{defaultCategories}
						{providerRootPath}
						onUpdate={handleFolderSettingsUpdate}
					/>
				</CardContent>
			</Card>

			{#if supportsZipBackup(selectedType)}
				<Card>
					<CardHeader>
						<CardTitle class="text-base">Backup Settings</CardTitle>
						<CardDescription>Configure backup storage for this provider</CardDescription>
					</CardHeader>
					<CardContent>
						<BackupSection
							{providerRootPrefix}
							{selectedType}
							bind:backupFolderPath
							bind:backupEnabled
							bind:backupRetentionCount
							bind:sheetsSyncEnabled
							bind:sheetsSpreadsheetId
						/>
					</CardContent>
				</Card>
			{/if}

			{#if isEditMode}
				<Card class="border-destructive/50">
					<CardHeader>
						<CardTitle class="text-base text-destructive">Danger Zone</CardTitle>
						<CardDescription>Permanently remove this provider</CardDescription>
					</CardHeader>
					<CardContent>
						<Button
							variant="outline"
							onclick={() => (deleteConfirmOpen = true)}
							disabled={isDeleting}
						>
							{#if isDeleting}
								<LoaderCircle class="h-4 w-4 animate-spin mr-1" />
								Deleting...
							{:else}
								<Trash2 class="h-4 w-4 mr-1 text-destructive" />
								Delete Provider
							{/if}
						</Button>
					</CardContent>
				</Card>
			{/if}
		{/if}
	</div>

	{#if selectedType && providerCatalog.loaded}
		<Button
			onclick={handleSave}
			disabled={!canSave || isSaving}
			class="fixed sm:bottom-8 sm:right-8 bottom-4 left-4 right-4 sm:left-auto sm:w-auto w-auto sm:rounded-full rounded-full group bg-foreground hover:bg-foreground/90 text-background shadow-2xl transition-all duration-300 sm:hover:scale-110 z-50 h-16 sm:h-16 pl-6 pr-10 border-0 justify-center disabled:opacity-50 disabled:cursor-not-allowed"
		>
			{#if isSaving}
				<LoaderCircle class="h-6 w-6 animate-spin transition-transform duration-300" />
				<span class="font-bold text-lg">Saving...</span>
			{:else}
				<Save class="h-6 w-6 transition-transform duration-300 group-hover:scale-110" />
				<span class="font-bold text-lg">{isEditMode ? 'Update Provider' : 'Save Provider'}</span>
			{/if}
		</Button>
	{/if}
</FormLayout>

<ConfirmDialog
	bind:open={deleteConfirmOpen}
	title="Delete {displayName.trim() || 'provider'}?"
	description="Backups to this provider stop and its settings are removed from VROOM. Your files stay in the provider itself."
	onConfirm={() => handleDelete()}
/>

<ConfirmDialog
	bind:open={photoLossConfirmOpen}
	title="Delete {displayName.trim() || 'provider'}?"
	description={photoLossMessage}
	confirmLabel="Delete anyway"
	onConfirm={() => handleDelete(true)}
/>
