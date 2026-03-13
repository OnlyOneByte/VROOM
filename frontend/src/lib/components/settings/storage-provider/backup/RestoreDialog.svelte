<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Badge } from '$lib/components/ui/badge';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as RadioGroup from '$lib/components/ui/radio-group';
	import { LoaderCircle, Upload, ArrowLeft, Cloud, Database, ChevronDown } from '@lucide/svelte';
	import {
		Collapsible,
		CollapsibleContent,
		CollapsibleTrigger
	} from '$lib/components/ui/collapsible';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { appStore } from '$lib/stores/app.svelte';
	import ProviderPicker from './RestoreProviderPicker.svelte';
	import type { RestoreResult, RestoreProviderInfo, BackupFileInfo } from '$lib/types';

	type FlowType = 'file' | 'provider';

	/**
	 * Steps:
	 * 1 = choose entry point (file upload vs provider)
	 * 2 = file: upload ZIP / provider: pick file from backup list (ZIP) or loading sheets preview
	 * 3 = preview + mode + execute
	 *
	 * Provider sub-steps handled via providerStep:
	 * 'pick-provider' = pick provider + source type (ProviderPicker)
	 * 'pick-file' = pick ZIP file from provider backup list
	 * 'loading-sheets' = loading sheets preview (auto-advances to step 3)
	 */
	type ProviderSubStep = 'pick-provider' | 'pick-file' | 'loading-sheets';

	interface Props {
		open: boolean;
		backupProviders: Array<{ id: string; displayName: string; providerType: string }>;
		sheetsSyncEnabled: boolean;
		onRestore: (_result: RestoreResult) => void;
		onClose: () => void;
	}

	let {
		open = $bindable(),
		backupProviders,
		sheetsSyncEnabled,
		onRestore,
		onClose
	}: Props = $props();

	let step = $state(1);
	let flowType = $state<FlowType | null>(null);
	let providerSubStep = $state<ProviderSubStep>('pick-provider');

	// Provider-based restore state
	let restoreProviders = $state<RestoreProviderInfo[]>([]);
	let isLoadingProviders = $state(false);
	let selectedProviderId = $state<string | null>(null);
	let selectedSourceType = $state<'zip' | 'sheets' | null>(null);

	// ZIP from provider state
	let providerBackups = $state<BackupFileInfo[]>([]);
	let isLoadingBackups = $state(false);
	let selectedBackup = $state<BackupFileInfo | null>(null);

	// File upload state
	let selectedFile = $state<File | null>(null);

	// Preview state
	let restorePreview = $state<Record<string, number> | null>(null);
	let restoreConflicts = $state<Array<{ table: string; id: string }>>([]);
	let restoreMode = $state<'replace' | 'merge'>('replace');
	let isProcessing = $state(false);
	let error = $state<string | null>(null);

	function resetState() {
		step = 1;
		flowType = null;
		providerSubStep = 'pick-provider';
		restoreProviders = [];
		isLoadingProviders = false;
		selectedProviderId = null;
		selectedSourceType = null;
		providerBackups = [];
		isLoadingBackups = false;
		selectedBackup = null;
		selectedFile = null;
		restorePreview = null;
		restoreConflicts = [];
		restoreMode = 'replace';
		isProcessing = false;
		error = null;
	}

	async function handleProviderFlow() {
		flowType = 'provider';
		step = 2;
		providerSubStep = 'pick-provider';
		isLoadingProviders = true;
		error = null;
		try {
			restoreProviders = await settingsStore.loadRestoreProviders();
			// Auto-select: one provider + one source type -> skip picker
			if (restoreProviders.length === 1) {
				const singleProvider = restoreProviders[0];
				if (singleProvider && singleProvider.sourceTypes.length === 1) {
					const singleSourceType = singleProvider.sourceTypes[0];
					if (singleSourceType) {
						await handleProviderSelect(singleProvider.providerId, singleSourceType);
					}
				}
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load restore providers';
		} finally {
			isLoadingProviders = false;
		}
	}

	async function handleProviderSelect(providerId: string, sourceType: 'zip' | 'sheets') {
		selectedProviderId = providerId;
		selectedSourceType = sourceType;
		error = null;

		if (sourceType === 'zip') {
			providerSubStep = 'pick-file';
			isLoadingBackups = true;
			try {
				providerBackups = await settingsStore.listBackupsFromProvider(providerId);
			} catch (err) {
				error = err instanceof Error ? err.message : 'Failed to load backups';
			} finally {
				isLoadingBackups = false;
			}
		} else {
			// Sheets: preview directly
			providerSubStep = 'loading-sheets';
			isProcessing = true;
			try {
				const key = `preview-sheets-${providerId}-${Date.now()}`;
				const result = await settingsStore.restoreFromProvider({
					providerId,
					sourceType: 'sheets',
					mode: 'preview',
					idempotencyKey: key
				});
				restorePreview = result.preview ?? null;
				restoreConflicts = result.conflicts ?? [];
				step = 3;
			} catch (err) {
				error = err instanceof Error ? err.message : 'Failed to preview sheets data';
				providerSubStep = 'pick-provider';
			} finally {
				isProcessing = false;
			}
		}
	}

	async function handleBackupSelect(backup: BackupFileInfo) {
		selectedBackup = backup;
		isProcessing = true;
		error = null;
		try {
			const key = `preview-${backup.fileRef}-${Date.now()}`;
			const result = await settingsStore.restoreFromProvider({
				providerId: backup.providerId,
				sourceType: 'zip',
				mode: 'preview',
				fileRef: backup.fileRef,
				idempotencyKey: key
			});
			restorePreview = result.preview ?? null;
			restoreConflicts = result.conflicts ?? [];
			step = 3;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to preview backup';
		} finally {
			isProcessing = false;
		}
	}

	async function handleFileUpload(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		selectedFile = file;
		isProcessing = true;
		error = null;
		try {
			const result = await settingsStore.uploadBackup(file, 'preview');
			restorePreview = result.preview ?? null;
			restoreConflicts = result.conflicts ?? [];
			step = 3;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to preview file';
		} finally {
			isProcessing = false;
		}
	}

	async function handleRestore() {
		isProcessing = true;
		error = null;
		try {
			let result: RestoreResult;
			if (flowType === 'file' && selectedFile) {
				result = await settingsStore.uploadBackup(selectedFile, restoreMode);
			} else if (
				flowType === 'provider' &&
				selectedSourceType === 'zip' &&
				selectedBackup &&
				selectedProviderId
			) {
				const key = `restore-${selectedProviderId}-${selectedBackup.fileRef}-${Date.now()}`;
				result = await settingsStore.restoreFromProvider({
					providerId: selectedProviderId,
					sourceType: 'zip',
					mode: restoreMode,
					fileRef: selectedBackup.fileRef,
					idempotencyKey: key
				});
			} else if (flowType === 'provider' && selectedSourceType === 'sheets' && selectedProviderId) {
				const key = `restore-sheets-${selectedProviderId}-${Date.now()}`;
				result = await settingsStore.restoreFromProvider({
					providerId: selectedProviderId,
					sourceType: 'sheets',
					mode: restoreMode,
					idempotencyKey: key
				});
			} else {
				throw new Error('Invalid restore configuration');
			}
			onRestore(result);
			open = false;
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'Restore failed';
			// Handle 409 backup-in-progress
			if (msg.includes('BACKUP_IN_PROGRESS') || msg.includes('backup is already in progress')) {
				appStore.showError('A backup is currently in progress. Please try again later.');
			}
			error = msg;
		} finally {
			isProcessing = false;
		}
	}

	function handleBack() {
		error = null;
		if (step === 3) {
			restorePreview = null;
			restoreConflicts = [];
			if (flowType === 'provider' && selectedSourceType === 'zip') {
				selectedBackup = null;
				providerSubStep = 'pick-file';
				step = 2;
			} else if (flowType === 'provider' && selectedSourceType === 'sheets') {
				providerSubStep = 'pick-provider';
				selectedProviderId = null;
				selectedSourceType = null;
				step = 2;
			} else {
				selectedFile = null;
				step = 1;
			}
		} else if (step === 2) {
			if (flowType === 'provider' && providerSubStep === 'pick-file') {
				providerSubStep = 'pick-provider';
				selectedProviderId = null;
				selectedSourceType = null;
				providerBackups = [];
				selectedBackup = null;
			} else {
				flowType = null;
				providerBackups = [];
				selectedBackup = null;
				selectedFile = null;
				step = 1;
			}
		}
	}

	let dialogTitle = $derived.by(() => {
		if (step === 1) return 'Restore Data';
		if (step === 2 && flowType === 'file') return 'Upload Backup File';
		if (step === 2 && flowType === 'provider') {
			if (providerSubStep === 'pick-provider') return 'Select Provider';
			if (providerSubStep === 'pick-file') return 'Select Backup';
			return 'Loading...';
		}
		return 'Preview Import';
	});

	let dialogDescription = $derived.by(() => {
		if (step === 1) return 'Choose where to restore your data from';
		if (step === 2 && flowType === 'file') return 'Select a .zip backup file';
		if (step === 2 && flowType === 'provider') {
			if (providerSubStep === 'pick-provider') return 'Choose a provider and source type';
			if (providerSubStep === 'pick-file') return 'Choose a backup to restore';
			return 'Loading data from provider...';
		}
		return 'Review and confirm the restore';
	});

	let hasProviderOptions = $derived(backupProviders.length > 0 || sheetsSyncEnabled);
</script>

<Dialog.Root
	bind:open
	onOpenChange={isOpen => {
		if (!isOpen) {
			resetState();
			onClose();
		}
	}}
>
	<Dialog.Content class="max-w-2xl max-h-[90vh] overflow-y-auto">
		<Dialog.Header>
			<Dialog.Title>{dialogTitle}</Dialog.Title>
			<Dialog.Description>{dialogDescription}</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-4 py-4">
			{#if error}
				<div
					class="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
				>
					{error}
				</div>
			{/if}

			<!-- Step 1: Source Selection -->
			{#if step === 1}
				<div class="grid gap-3">
					<button
						type="button"
						class="flex items-center gap-3 rounded-lg border border-border p-4 text-left transition-colors hover:bg-muted"
						onclick={() => {
							flowType = 'file';
							step = 2;
							error = null;
						}}
					>
						<div class="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
							<Upload class="h-5 w-5 text-muted-foreground" />
						</div>
						<div>
							<div class="font-medium text-foreground">Upload file</div>
							<div class="text-sm text-muted-foreground">Restore from a .zip backup file</div>
						</div>
					</button>
					{#if hasProviderOptions}
						<button
							type="button"
							class="flex items-center gap-3 rounded-lg border border-border p-4 text-left transition-colors hover:bg-muted"
							onclick={handleProviderFlow}
						>
							<div class="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
								<Cloud class="h-5 w-5 text-muted-foreground" />
							</div>
							<div>
								<div class="font-medium text-foreground">Restore from provider</div>
								<div class="text-sm text-muted-foreground">
									Choose a connected provider and backup source
								</div>
							</div>
						</button>
					{/if}
				</div>
			{/if}

			<!-- Step 2: File Upload -->
			{#if step === 2 && flowType === 'file'}
				<div class="space-y-3">
					<Label for="backup-file">Backup File</Label>
					<Input id="backup-file" type="file" accept=".zip" onchange={handleFileUpload} />
					{#if isProcessing}
						<div class="flex items-center gap-2 text-sm text-muted-foreground">
							<LoaderCircle class="h-4 w-4 animate-spin" /><span>Generating preview...</span>
						</div>
					{/if}
				</div>
			{/if}

			<!-- Step 2: Provider Flow — Pick Provider -->
			{#if step === 2 && flowType === 'provider' && providerSubStep === 'pick-provider'}
				{#if isLoadingProviders}
					<div class="flex items-center gap-2 py-4 text-sm text-muted-foreground">
						<LoaderCircle class="h-4 w-4 animate-spin" /><span>Loading providers...</span>
					</div>
				{:else}
					<ProviderPicker providers={restoreProviders} onSelect={handleProviderSelect} />
				{/if}
			{/if}

			<!-- Step 2: Provider Flow — Pick ZIP File -->
			{#if step === 2 && flowType === 'provider' && providerSubStep === 'pick-file'}
				{#if isLoadingBackups}
					<div class="flex items-center gap-2 py-4 text-sm text-muted-foreground">
						<LoaderCircle class="h-4 w-4 animate-spin" /><span>Loading backups...</span>
					</div>
				{:else if providerBackups.length === 0}
					<p class="py-4 text-sm text-muted-foreground">No backups found. Create a backup first.</p>
				{:else}
					<div class="space-y-2">
						{#each providerBackups as backup (backup.fileRef)}
							<button
								type="button"
								class="flex w-full items-center justify-between rounded-lg border border-border p-3 text-left transition-colors hover:bg-muted disabled:opacity-50"
								disabled={isProcessing}
								onclick={() => handleBackupSelect(backup)}
							>
								<div class="flex items-center gap-3">
									<Database class="h-4 w-4 text-muted-foreground" />
									<div>
										<div class="text-sm font-medium text-foreground">
											{new Date(backup.createdTime).toLocaleDateString('en-US', {
												month: 'short',
												day: 'numeric',
												year: 'numeric',
												hour: '2-digit',
												minute: '2-digit'
											})}
										</div>
										<div class="text-xs text-muted-foreground">
											{backup.size < 1024
												? backup.size + ' B'
												: backup.size < 1048576
													? (backup.size / 1024).toFixed(1) + ' KB'
													: (backup.size / 1048576).toFixed(1) + ' MB'}
										</div>
									</div>
								</div>
								{#if backup.isLatest}<Badge variant="secondary">Latest</Badge>{/if}
							</button>
						{/each}
					</div>
				{/if}
				{#if isProcessing}
					<div class="flex items-center gap-2 text-sm text-muted-foreground">
						<LoaderCircle class="h-4 w-4 animate-spin" /><span>Generating preview...</span>
					</div>
				{/if}
			{/if}

			<!-- Step 2: Provider Flow — Loading Sheets -->
			{#if step === 2 && flowType === 'provider' && providerSubStep === 'loading-sheets'}
				<div class="flex items-center gap-2 py-4 text-sm text-muted-foreground">
					<LoaderCircle class="h-4 w-4 animate-spin" /><span>Loading from Google Sheets...</span>
				</div>
			{/if}

			<!-- Step 3: Preview + Mode + Execute -->
			{#if step === 3 && restorePreview}
				<div class="rounded-lg border border-border bg-muted p-4">
					<h4 class="mb-3 font-medium text-foreground">Import Summary</h4>
					<div class="space-y-2 text-sm">
						<div class="flex justify-between">
							<span class="text-muted-foreground">Vehicles:</span><span
								class="font-medium text-foreground">{restorePreview['vehicles'] || 0}</span
							>
						</div>
						<div class="flex justify-between">
							<span class="text-muted-foreground">Expenses:</span><span
								class="font-medium text-foreground">{restorePreview['expenses'] || 0}</span
							>
						</div>
						<div class="flex justify-between">
							<span class="text-muted-foreground">Insurance:</span><span
								class="font-medium text-foreground">{restorePreview['insurance'] || 0}</span
							>
						</div>
						{#if restorePreview['photos']}<div class="flex justify-between">
								<span class="text-muted-foreground">Photos:</span><span
									class="font-medium text-foreground">{restorePreview['photos']}</span
								>
							</div>{/if}
					</div>
					{#if restorePreview['financing'] || restorePreview['insurancePolicyVehicles']}
						<Collapsible class="mt-3">
							<CollapsibleTrigger
								class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
								><ChevronDown class="h-3 w-3" />Details</CollapsibleTrigger
							>
							<CollapsibleContent class="mt-2 space-y-2 text-sm">
								{#if restorePreview['financing']}<div class="flex justify-between">
										<span class="text-muted-foreground">Financing:</span><span
											class="font-medium text-foreground">{restorePreview['financing']}</span
										>
									</div>{/if}
								{#if restorePreview['insurancePolicyVehicles']}<div class="flex justify-between">
										<span class="text-muted-foreground">Policy-Vehicle Links:</span><span
											class="font-medium text-foreground"
											>{restorePreview['insurancePolicyVehicles']}</span
										>
									</div>{/if}
							</CollapsibleContent>
						</Collapsible>
					{/if}
				</div>

				{#if restoreConflicts.length > 0}
					<div class="rounded-lg border border-chart-5/30 bg-chart-5/5 p-4">
						<h4 class="mb-3 font-medium text-chart-5">Conflicts Detected</h4>
						<p class="mb-3 text-sm text-muted-foreground">
							{restoreConflicts.length} conflict(s) found.
						</p>
						<div class="max-h-48 space-y-2 overflow-y-auto">
							{#each restoreConflicts as conflict, i (i)}
								<div
									class="rounded border border-border bg-background p-2 text-sm font-medium text-foreground"
								>
									{conflict.table} - ID: {conflict.id}
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<div class="space-y-3">
					<Label>Restore Mode</Label>
					<RadioGroup.Root bind:value={restoreMode}>
						<div class="flex items-center space-x-2">
							<RadioGroup.Item value="replace" id="mode-replace" />
							<Label for="mode-replace" class="cursor-pointer font-normal"
								><div>
									<div class="font-medium">Replace All</div>
									<div class="text-sm text-muted-foreground">
										Delete existing data and import from backup
									</div>
								</div></Label
							>
						</div>
						<div class="flex items-center space-x-2 opacity-50">
							<RadioGroup.Item value="merge" id="mode-merge" disabled />
							<Label for="mode-merge" class="cursor-not-allowed font-normal"
								><div>
									<div class="font-medium">Merge (Coming Soon)</div>
									<div class="text-sm text-muted-foreground">Currently unavailable</div>
								</div></Label
							>
						</div>
					</RadioGroup.Root>
				</div>
			{/if}
		</div>

		<Dialog.Footer class="flex gap-2">
			{#if step > 1}
				<Button variant="ghost" onclick={handleBack} disabled={isProcessing}>
					<ArrowLeft class="mr-1 h-4 w-4" />Back
				</Button>
			{/if}
			<div class="flex-1"></div>
			<Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
			{#if step === 3 && restorePreview}
				<Button disabled={isProcessing || restoreMode !== 'replace'} onclick={handleRestore}>
					{#if isProcessing}<LoaderCircle
							class="mr-2 h-4 w-4 animate-spin"
						/>Restoring...{:else}Restore{/if}
				</Button>
			{/if}
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
