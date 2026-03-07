<script lang="ts">
	import { LoaderCircle, Cloud, Database, Monitor, Inbox } from '@lucide/svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Badge } from '$lib/components/ui/badge';
	import { Separator } from '$lib/components/ui/separator';
	import S3ProviderForm from './S3ProviderForm.svelte';
	import GoogleDriveProviderForm from './GoogleDriveProviderForm.svelte';
	import ProviderFolderSettings from './ProviderFolderSettings.svelte';
	import { providerApi } from '$lib/services/provider-api';
	import { settingsApi } from '$lib/services/settings-api';
	import { appStore } from '$lib/stores/app.svelte';
	import { DEFAULT_FOLDER_SETTINGS, type ProviderTypeOption } from '$lib/constants/providers';
	import type { PhotoCategory, CategorySetting, StorageConfig, UserProviderInfo } from '$lib/types';

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
		open = $bindable(false),
		onCreated
	}: {
		open: boolean;
		onCreated: () => void;
	} = $props();

	let selectedType = $state<string | null>(null);
	let displayName = $state('');
	let isSaving = $state(false);

	// S3 form state
	let s3Config = $state({ endpoint: '', bucket: '', region: '', rootPath: '/vroom' });
	let s3Credentials = $state({ accessKeyId: '', secretAccessKey: '' });

	// Folder settings state
	let folderSettings = $state<Record<PhotoCategory, CategorySetting>>({
		...DEFAULT_FOLDER_SETTINGS
	});

	const CREATED_AT_PLACEHOLDER = new Date().toISOString();

	let tempProvider = $derived.by(
		() =>
			({
				id: 'new',
				domain: 'storage',
				providerType: selectedType ?? 'google-drive',
				displayName: displayName || 'New Provider',
				status: 'active' as const,
				config: {
					rootPath:
						selectedType === 's3'
							? s3Config.rootPath
							: getDefaultRootPath(selectedType ?? 'google-drive')
				},
				createdAt: CREATED_AT_PLACEHOLDER
			}) satisfies UserProviderInfo
	);

	function handleFolderSettingsUpdate(settings: Record<PhotoCategory, CategorySetting>) {
		folderSettings = settings;
	}

	function resetForm() {
		selectedType = null;
		displayName = '';
		isSaving = false;
		s3Config = { endpoint: '', bucket: '', region: '', rootPath: '/vroom' };
		s3Credentials = { accessKeyId: '', secretAccessKey: '' };
		folderSettings = { ...DEFAULT_FOLDER_SETTINGS };
	}

	$effect(() => {
		if (!open) {
			resetForm();
		}
	});

	function getDefaultRootPath(providerType: string): string {
		switch (providerType) {
			case 'google-drive':
				return '/VROOM';
			case 's3':
				return '/vroom';
			default:
				return '/vroom';
		}
	}

	let canSave = $derived.by(() => {
		if (!selectedType || !displayName.trim()) return false;
		if (selectedType === 's3') {
			return !!(
				s3Config.endpoint &&
				s3Config.bucket &&
				s3Credentials.accessKeyId &&
				s3Credentials.secretAccessKey
			);
		}
		// Google Drive requires OAuth connection first — block save with empty credentials
		if (selectedType === 'google-drive') {
			return false;
		}
		return true;
	});

	async function handleSave() {
		if (!selectedType || !displayName.trim()) return;

		isSaving = true;
		try {
			let credentials: Record<string, unknown> = {};
			let config: Record<string, unknown> = {
				rootPath: selectedType === 's3' ? s3Config.rootPath : getDefaultRootPath(selectedType)
			};

			if (selectedType === 's3') {
				credentials = {
					accessKeyId: s3Credentials.accessKeyId,
					secretAccessKey: s3Credentials.secretAccessKey
				};
				config = {
					...config,
					endpoint: s3Config.endpoint,
					bucket: s3Config.bucket,
					region: s3Config.region
				};
			}

			const created = await providerApi.createProvider({
				domain: 'storage',
				providerType: selectedType,
				displayName: displayName.trim(),
				credentials,
				config
			});

			// Persist user's folder settings — send only the new provider's entry.
			// The backend merges providerCategories, so we don't need to read-modify-write.
			try {
				await settingsApi.updateSettings({
					storageConfig: {
						defaults: {} as StorageConfig['defaults'],
						providerCategories: {
							[created.id]: folderSettings
						}
					}
				});
			} catch {
				// Non-critical — backend auto-populated defaults
			}

			appStore.showSuccess(`${displayName.trim()} added successfully`);
			onCreated();
		} catch {
			appStore.showError('Failed to add provider');
		} finally {
			isSaving = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>Add Image Provider</Dialog.Title>
			<Dialog.Description>Connect a new storage provider for your photos</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-6 py-4">
			<!-- Step 1: Provider Type -->
			<div class="space-y-3">
				<Label class="text-sm font-medium">Provider Type</Label>
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
								if (!pt.disabled) selectedType = pt.id;
							}}
						>
							<Icon
								class="h-6 w-6 {selectedType === pt.id ? 'text-primary' : 'text-muted-foreground'}"
							/>
							<span class="text-sm font-medium">{pt.label}</span>
							{#if pt.disabled}
								<Badge variant="secondary" class="text-xs absolute top-1 right-1">Soon</Badge>
							{/if}
						</button>
					{/each}
				</div>
			</div>

			{#if selectedType}
				<Separator />

				<!-- Step 2: Display Name -->
				<div class="space-y-2">
					<Label for="provider-name">Display Name</Label>
					<Input
						id="provider-name"
						bind:value={displayName}
						placeholder="My {PROVIDER_TYPES.find(p => p.id === selectedType)?.label ?? 'Provider'}"
					/>
				</div>

				<Separator />

				<!-- Step 3: Provider-specific form -->
				{#if selectedType === 's3'}
					<S3ProviderForm
						config={s3Config}
						credentials={s3Credentials}
						onConfigChange={c => (s3Config = c)}
						onCredentialsChange={c => (s3Credentials = c)}
					/>
				{:else if selectedType === 'google-drive'}
					<GoogleDriveProviderForm />
					<p class="text-sm text-muted-foreground">
						Connect your Google account first, then return here to add the provider.
					</p>
				{/if}

				<Separator />

				<!-- Step 4: Folder Settings -->
				<ProviderFolderSettings
					provider={tempProvider}
					categorySettings={folderSettings}
					onUpdate={handleFolderSettingsUpdate}
				/>

				<!-- Test Connection — available after saving -->
				<div class="flex items-center gap-2">
					<Button variant="outline" size="sm" disabled>Test Connection</Button>
					<span class="text-xs text-muted-foreground">Available after saving</span>
				</div>
			{/if}
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
			<Button onclick={handleSave} disabled={!canSave || isSaving}>
				{#if isSaving}
					<LoaderCircle class="h-4 w-4 animate-spin mr-1" />
					Saving...
				{:else}
					Save
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
