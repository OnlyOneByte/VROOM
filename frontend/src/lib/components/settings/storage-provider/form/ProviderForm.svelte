<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import {
		ArrowLeft,
		LoaderCircle,
		Cloud,
		Database,
		Monitor,
		Inbox,
		Save,
		Trash2
	} from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Badge } from '$lib/components/ui/badge';
	import S3ProviderForm from './S3Form.svelte';
	import GoogleDriveProviderForm from './GoogleDriveForm.svelte';
	import ProviderFolderSettings from './PhotoFolderSection.svelte';
	import BackupSection from './BackupSection.svelte';
	import { useGoogleOAuth } from '../use-google-oauth.svelte';
	import { providerApi } from '$lib/services/provider-api';
	import { settingsApi } from '$lib/services/settings-api';
	import { appStore } from '$lib/stores/app.svelte';
	import FormLayout from '$lib/components/common/form-layout.svelte';
	import { routes } from '$lib/routes';
	import { DEFAULT_FOLDER_SETTINGS, type ProviderTypeOption } from '$lib/constants/providers';
	import type {
		PhotoCategory,
		CategorySetting,
		StorageConfig,
		UserProviderInfo,
		BackupConfig,
		ProviderBackupSettings
	} from '$lib/types';
	import { onMount } from 'svelte';

	const PROVIDER_TYPES: ProviderTypeOption[] = [
		{
			id: 'google-drive',
			label: 'Google Drive',
			description: 'Store photos in Google Drive',
			icon: Cloud,
			disabled: false
		},
		{
			id: 's3',
			label: 'S3 / B2 / R2',
			description: 'S3-compatible storage',
			icon: Database,
			disabled: false
		},
		{
			id: 'onedrive',
			label: 'OneDrive',
			description: 'Microsoft OneDrive',
			icon: Monitor,
			disabled: true
		},
		{
			id: 'dropbox',
			label: 'Dropbox',
			description: 'Dropbox cloud storage',
			icon: Inbox,
			disabled: true
		}
	];

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
	let displayName = $state('');
	let isSaving = $state(false);
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

	let googleEmail = $derived.by(() => {
		if (selectedType !== 'google-drive') return '';
		if (isEditMode) return (existingProvider?.config?.['accountEmail'] as string) ?? '';
		return oauth.pendingEmail;
	});

	let s3Config = $state({ endpoint: '', bucket: '', region: '' });
	let s3Credentials = $state({ accessKeyId: '', secretAccessKey: '' });

	let providerRootPath = $state('VROOM');
	let photoRootPath = $state(getDefaultPhotoRootPath('google-drive'));

	let folderSettings = $state<Record<PhotoCategory, CategorySetting>>({
		...DEFAULT_FOLDER_SETTINGS
	});

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
			if (existingProvider.providerType === 's3') {
				s3Config = {
					endpoint: (existingProvider.config?.['endpoint'] as string) ?? '',
					bucket: (existingProvider.config?.['bucket'] as string) ?? '',
					region: (existingProvider.config?.['region'] as string) ?? ''
				};
			}
			if (existingFolderSettings) {
				folderSettings = { ...existingFolderSettings };
			}
			initialized = true;
		}
	});

	async function loadSettings() {
		try {
			const settings = await settingsApi.getSettings();
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
		const [, oauthResult] = await Promise.all([loadSettings(), oauth.handleOAuthReturn()]);
		if (oauthResult.restoredSelectedType) selectedType = oauthResult.restoredSelectedType;
		if (oauthResult.restoredDisplayName) displayName = oauthResult.restoredDisplayName;
	});

	function handleFolderSettingsUpdate(settings: Record<PhotoCategory, CategorySetting>) {
		folderSettings = settings;
	}

	function getDefaultPhotoRootPath(providerType: string): string {
		switch (providerType) {
			case 'google-drive':
				return 'Photos';
			case 's3':
				return 'vroom/photos';
			default:
				return 'photos';
		}
	}

	let canSave = $derived.by(() => {
		if (!selectedType || !displayName.trim()) return false;
		if (hasBackupErrors && anyBackupEnabled) return false;
		if (selectedType === 's3') {
			if (isEditMode) {
				return !!(s3Config.endpoint && s3Config.bucket);
			}
			return !!(
				s3Config.endpoint &&
				s3Config.bucket &&
				s3Credentials.accessKeyId &&
				s3Credentials.secretAccessKey
			);
		}
		if (selectedType === 'google-drive') {
			return isEditMode || !!oauth.pendingEmail;
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
			let credentials: Record<string, unknown> = {};
			let config: Record<string, unknown> = {
				...(existingProvider?.config ?? {}),
				providerRootPath: providerRootPath.trim(),
				photoRootPath: photoRootPath.trim() || getDefaultPhotoRootPath(selectedType)
			};

			if (selectedType === 's3') {
				if (s3Credentials.accessKeyId && s3Credentials.secretAccessKey) {
					credentials = {
						accessKeyId: s3Credentials.accessKeyId,
						secretAccessKey: s3Credentials.secretAccessKey
					};
				}
				config = {
					...config,
					endpoint: s3Config.endpoint,
					bucket: s3Config.bucket,
					region: s3Config.region
				};
			}

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
					...(selectedType === 'google-drive' && oauth.oauthNonce
						? { nonce: oauth.oauthNonce }
						: {})
				});
				resultId = created.id;
			}

			const unsaved: string[] = [];

			try {
				await settingsApi.updateSettings({
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
						enabled: backupEnabled,
						folderPath: backupFolderPath.trim() || 'Backups',
						retentionCount: backupRetentionCount,
						...(selectedType === 'google-drive' && {
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
					await settingsApi.updateSettings({ backupConfig: updatedBackupConfig });
				} catch {
					unsaved.push('backup settings');
				}
			}

			const name = displayName.trim();
			const verb = isEditMode ? 'updated' : 'added';
			if (unsaved.length > 0) {
				appStore.showWarning(
					`${name} ${verb}, but its ${unsaved.join(' and ')} could not be saved. Re-open the provider to try again.`
				);
			} else {
				appStore.showSuccess(`${name} ${verb} successfully`);
			}
			navigateBack();
		} catch {
			appStore.showError(isEditMode ? 'Failed to update provider' : 'Failed to add provider');
		} finally {
			isSaving = false;
		}
	}

	async function handleDelete() {
		if (!providerId) return;
		isDeleting = true;
		try {
			await providerApi.deleteProvider(providerId);
			appStore.showSuccess(`${displayName.trim()} removed`);
			navigateBack();
		} catch {
			appStore.showError('Failed to delete provider');
		} finally {
			isDeleting = false;
		}
	}
</script>

<FormLayout>
	<div class="mb-6">
		<button
			type="button"
			class="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
			onclick={navigateBack}
		>
			<ArrowLeft class="h-4 w-4" />
			Back to Settings
		</button>
		<h1 class="text-2xl font-bold tracking-tight">
			{isEditMode ? 'Edit Provider' : 'Add Storage Provider'}
		</h1>
		<p class="text-muted-foreground">
			{isEditMode
				? 'Update your storage provider configuration'
				: 'Connect a new storage provider for your photos and backups'}
		</p>
	</div>

	<div class="space-y-6 pb-32 sm:pb-24">
		{#if isEditMode}
			{@const pt = PROVIDER_TYPES.find(p => p.id === selectedType)}
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
					<div class="grid grid-cols-2 gap-2">
						{#each PROVIDER_TYPES as pt (pt.id)}
							{@const Icon = pt.icon}
							<button
								type="button"
								disabled={pt.disabled}
								class="relative flex flex-col items-center gap-2 rounded-lg border p-3 text-center transition-colors
									{selectedType === pt.id
									? 'border-primary bg-primary/5'
									: pt.disabled
										? 'border-border bg-muted opacity-50 cursor-not-allowed'
										: 'border-border hover:border-primary/50 hover:bg-muted/50 cursor-pointer'}"
								onclick={() => {
									if (pt.disabled) return;
									selectedType = pt.id;
									photoRootPath = getDefaultPhotoRootPath(pt.id);
								}}
							>
								<Icon
									class="h-6 w-6 {selectedType === pt.id
										? 'text-primary'
										: 'text-muted-foreground'}"
								/>
								<span class="text-sm font-medium">{pt.label}</span>
								{#if pt.disabled}
									<Badge variant="secondary" class="text-xs absolute top-1 right-1">Soon</Badge>
								{/if}
							</button>
						{/each}
					</div>
				</CardContent>
			</Card>
		{/if}

		{#if selectedType}
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
							placeholder="My {PROVIDER_TYPES.find(p => p.id === selectedType)?.label ??
								'Provider'}"
						/>
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle class="text-base">Connection Settings</CardTitle>
					<CardDescription>
						{#if selectedType === 's3'}
							S3-compatible storage credentials and endpoint
						{:else if selectedType === 'google-drive'}
							Google Drive connection
						{:else}
							Provider configuration
						{/if}
					</CardDescription>
				</CardHeader>
				<CardContent class="space-y-4">
					{#if selectedType === 's3'}
						<S3ProviderForm
							config={{ ...s3Config, photoRootPath }}
							credentials={s3Credentials}
							onConfigChange={(c: { endpoint: string; bucket: string; region: string }) =>
								(s3Config = { endpoint: c.endpoint, bucket: c.bucket, region: c.region })}
							onCredentialsChange={(c: { accessKeyId: string; secretAccessKey: string }) =>
								(s3Credentials = c)}
						/>
						{#if isEditMode}
							<p class="text-xs text-muted-foreground mt-3">
								Leave credentials blank to keep existing values.
							</p>
						{/if}
					{:else if selectedType === 'google-drive'}
						<GoogleDriveProviderForm
							connectedEmail={googleEmail}
							onStartOAuth={oauth.startGoogleOAuth}
						/>
						{#if !isEditMode && !googleEmail}
							<p class="text-sm text-muted-foreground mt-3">
								Connect your Google account first, then return here to add the provider.
							</p>
						{/if}
					{/if}

					<div class="space-y-2 border-t border-border pt-4">
						<Label for="provider-root-path" class="text-sm">Provider root path</Label>
						<Input
							id="provider-root-path"
							bind:value={providerRootPath}
							placeholder="VROOM"
							class="h-9"
						/>
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

			{#if isEditMode}
				<Card class="border-destructive/50">
					<CardHeader>
						<CardTitle class="text-base text-destructive">Danger Zone</CardTitle>
						<CardDescription>Permanently remove this provider</CardDescription>
					</CardHeader>
					<CardContent>
						<Button variant="destructive" onclick={handleDelete} disabled={isDeleting}>
							{#if isDeleting}
								<LoaderCircle class="h-4 w-4 animate-spin mr-1" />
								Deleting...
							{:else}
								<Trash2 class="h-4 w-4 mr-1" />
								Delete Provider
							{/if}
						</Button>
					</CardContent>
				</Card>
			{/if}
		{/if}
	</div>

	{#if selectedType}
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
