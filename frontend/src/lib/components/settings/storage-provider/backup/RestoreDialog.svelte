<script lang="ts">
	import { tick } from 'svelte';
	import { formatBytes, formatDateWith } from '#lib/utils/formatters.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { Input } from '#lib/components/ui/input/index.ts';
	import { Label } from '#lib/components/ui/label/index.ts';
	import { Badge } from '#lib/components/ui/badge/index.ts';
	import { Alert, AlertDescription } from '#lib/components/ui/alert/index.ts';
	import * as Dialog from '#lib/components/ui/dialog/index.ts';
	import * as RadioGroup from '#lib/components/ui/radio-group/index.ts';
	import {
		LoaderCircle,
		Upload,
		ArrowLeft,
		Cloud,
		Database,
		ChevronDown,
		CircleAlert
	} from '@lucide/svelte';
	import {
		Collapsible,
		CollapsibleContent,
		CollapsibleTrigger
	} from '#lib/components/ui/collapsible/index.ts';
	import { settingsStore } from '#lib/stores/settings.svelte.ts';
	import { vehicleApi } from '#lib/services/vehicle-api.ts';
	import { getVehicleDisplayName } from '#lib/utils/vehicle-helpers.ts';
	import { ApiError, userFacingErrorMessage } from '#lib/utils/error-handling.ts';
	import ProviderPicker from './RestoreProviderPicker.svelte';
	import type {
		RestoreResult,
		RestoreProviderInfo,
		BackupFileInfo,
		RestoreDroppedReason
	} from '#lib/types/index.ts';

	type FlowType = 'file' | 'provider';

	type ProviderSubStep = 'pick-provider' | 'pick-file' | 'loading-sheets';

	type DroppedGrant = NonNullable<RestoreResult['grants']>['dropped'][number];

	const DROPPED_REASONS: Record<RestoreDroppedReason, string> = {
		vehicle_not_restored: "the car isn't in this backup",
		no_accepted_share: 'the person no longer has this car shared with them',
		member_not_active: "the member isn't active on this car",
		granted_by_non_member: 'whoever set it no longer has this car shared with them',
		role_not_assignable: "that role isn't available any more",
		permission_not_grantable: "that permission can't be given on a car"
	};

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

	let restoreProviders = $state<RestoreProviderInfo[]>([]);
	let isLoadingProviders = $state(false);
	let selectedProviderId = $state<string | null>(null);
	let selectedSourceType = $state<'zip' | 'sheets' | null>(null);

	let providerBackups = $state<BackupFileInfo[]>([]);
	let isLoadingBackups = $state(false);
	let selectedBackup = $state<BackupFileInfo | null>(null);

	let selectedFile = $state<File | null>(null);

	let restorePreview = $state<Record<string, number> | null>(null);
	let skippedPhotos = $state(0);
	let mergePreview = $state<RestoreResult['merge'] | null>(null);
	let mergeInstead = $state(false);
	let restoreMode = $state<'replace' | 'merge'>('merge');
	let isProcessing = $state(false);
	let error = $state<string | null>(null);
	let droppedGrants = $state<DroppedGrant[]>([]);
	let carNames = $state<Record<string, string>>({});
	let carNamesRequest = 0;
	let doneButton = $state<HTMLButtonElement | null>(null);

	function resetState() {
		droppedGrants = [];
		carNames = {};
		carNamesRequest++;
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
		skippedPhotos = 0;
		mergePreview = null;
		mergeInstead = false;
		restoreMode = 'merge';
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
			error = `Couldn't load your storage. ${userFacingErrorMessage(err)}`;
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
				error = `Couldn't load the backups. ${userFacingErrorMessage(err)}`;
			} finally {
				isLoadingBackups = false;
			}
		} else {
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
				skippedPhotos = result.skipped?.photos ?? 0;
				mergePreview = result.merge ?? null;
				step = 3;
			} catch (err) {
				error = `Couldn't preview the Sheets data. ${userFacingErrorMessage(err)}`;
				providerSubStep = 'pick-provider';
				void settingsStore.load();
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
			skippedPhotos = result.skipped?.photos ?? 0;
			mergePreview = result.merge ?? null;
			step = 3;
		} catch (err) {
			error = `Couldn't preview the backup. ${userFacingErrorMessage(err)}`;
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
			skippedPhotos = result.skipped?.photos ?? 0;
			mergePreview = result.merge ?? null;
			step = 3;
		} catch (err) {
			error = `Couldn't preview the file. ${userFacingErrorMessage(err)}`;
		} finally {
			isProcessing = false;
		}
	}

	async function handleRestore() {
		isProcessing = true;
		error = null;
		mergeInstead = false;
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
			const dropped = result.grants?.dropped ?? [];
			if (dropped.length === 0) {
				close();
				return;
			}
			droppedGrants = dropped;
			step = 4;
			void loadCarNames();
			await tick();
			doneButton?.focus();
		} catch (err) {
			error = `Couldn't restore. ${userFacingErrorMessage(err)}`;
			mergeInstead = restoreMode === 'replace' && err instanceof ApiError && err.statusCode === 409;
			if (selectedSourceType === 'sheets') void settingsStore.load();
		} finally {
			isProcessing = false;
		}
	}

	function close() {
		open = false;
		resetState();
		onClose();
	}

	async function loadCarNames() {
		const request = ++carNamesRequest;
		let names: Record<string, string>;
		try {
			const cars = await vehicleApi.getVehicles();
			names = Object.fromEntries(cars.map(car => [car.id, getVehicleDisplayName(car)]));
		} catch {
			names = {};
		}
		if (request === carNamesRequest) carNames = names;
	}

	let droppedCars = $derived.by(() => {
		const cars: Record<string, { car: string; reasons: Record<string, number> }> = {};
		for (const grant of droppedGrants) {
			const entry = (cars[grant.vehicleId] ??= {
				car:
					grant.reason === 'vehicle_not_restored'
						? 'A car not in this backup'
						: (carNames[grant.vehicleId] ?? 'One of your cars'),
				reasons: {}
			});
			const reason = DROPPED_REASONS[grant.reason] ?? 'it no longer applies';
			entry.reasons[reason] = (entry.reasons[reason] ?? 0) + 1;
		}
		return Object.entries(cars);
	});

	function mergeInsteadOfReplace() {
		restoreMode = 'merge';
		void handleRestore();
	}

	const total = (counts: Record<string, number> | undefined) =>
		Object.values(counts ?? {}).reduce((sum, count) => sum + count, 0);
	const records = (count: number) => (count === 1 ? '1 record' : `${count} records`);

	function handleBack() {
		error = null;
		mergeInstead = false;
		if (step === 3) {
			restorePreview = null;
			skippedPhotos = 0;
			mergePreview = null;
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
		if (step === 1) return 'Restore data';
		if (step === 2 && flowType === 'file') return 'Upload backup file';
		if (step === 2 && flowType === 'provider') {
			if (providerSubStep === 'pick-provider') return 'Select storage';
			if (providerSubStep === 'pick-file') return 'Select backup';
			return 'Loading...';
		}
		if (step === 4) return 'Restore finished';
		return 'Preview import';
	});

	let dialogDescription = $derived.by(() => {
		if (step === 1) return 'Choose where to restore your data from';
		if (step === 2 && flowType === 'file') return 'Select a .zip backup file';
		if (step === 2 && flowType === 'provider') {
			if (providerSubStep === 'pick-provider') return 'Choose storage and a source type';
			if (providerSubStep === 'pick-file') return 'Choose a backup to restore';
			return 'Loading data from storage...';
		}
		if (step === 4) return 'Your data is back. A few sharing settings were not brought back.';
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
				<Alert variant="destructive" role="alert">
					<CircleAlert aria-hidden="true" />
					<AlertDescription>
						<p>{error}</p>
						{#if mergeInstead}
							<Button
								variant="outline"
								size="sm"
								class="mt-2"
								disabled={isProcessing}
								onclick={mergeInsteadOfReplace}
							>
								Merge instead
							</Button>
						{/if}
					</AlertDescription>
				</Alert>
			{/if}

			{#if step === 1}
				<div class="grid gap-3">
					<button
						type="button"
						class="flex items-center gap-3 rounded-(--r-lg) border bg-surface p-4 text-left outline-none transition-colors hover:bg-sunk focus-visible:ring-[3px] focus-visible:ring-ring/50"
						onclick={() => {
							flowType = 'file';
							step = 2;
							error = null;
						}}
					>
						<div
							class="flex size-11 shrink-0 items-center justify-center rounded-(--r-md) bg-sunk"
							aria-hidden="true"
						>
							<Upload class="size-5 text-foreground" />
						</div>
						<div>
							<div class="font-medium text-foreground">Upload file</div>
							<div class="text-sm text-muted-foreground">Restore from a .zip backup file</div>
						</div>
					</button>
					{#if hasProviderOptions}
						<button
							type="button"
							class="flex items-center gap-3 rounded-(--r-lg) border bg-surface p-4 text-left outline-none transition-colors hover:bg-sunk focus-visible:ring-[3px] focus-visible:ring-ring/50"
							onclick={handleProviderFlow}
						>
							<div
								class="flex size-11 shrink-0 items-center justify-center rounded-(--r-md) bg-sunk"
								aria-hidden="true"
							>
								<Cloud class="size-5 text-foreground" />
							</div>
							<div>
								<div class="font-medium text-foreground">Restore from storage</div>
								<div class="text-sm text-muted-foreground">
									Choose connected storage and a backup source
								</div>
							</div>
						</button>
					{/if}
				</div>
			{/if}

			{#if step === 2 && flowType === 'file'}
				<div class="space-y-3">
					<Label for="backup-file">Backup file</Label>
					<Input id="backup-file" type="file" accept=".zip" onchange={handleFileUpload} />
					{#if isProcessing}
						<div class="flex items-center gap-2 text-sm text-muted-foreground">
							<LoaderCircle class="h-4 w-4 animate-spin" /><span>Generating preview...</span>
						</div>
					{/if}
				</div>
			{/if}

			{#if step === 2 && flowType === 'provider' && providerSubStep === 'pick-provider'}
				{#if isLoadingProviders}
					<div class="flex items-center gap-2 py-4 text-sm text-muted-foreground">
						<LoaderCircle class="h-4 w-4 animate-spin" /><span>Loading storage...</span>
					</div>
				{:else}
					<ProviderPicker providers={restoreProviders} onSelect={handleProviderSelect} />
				{/if}
			{/if}

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
											{formatDateWith(new Date(backup.createdTime), {
												month: 'short',
												day: 'numeric',
												year: 'numeric',
												hour: '2-digit',
												minute: '2-digit'
											})}
										</div>
										<div class="text-xs text-muted-foreground">
											{formatBytes(backup.size)}
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

			{#if step === 2 && flowType === 'provider' && providerSubStep === 'loading-sheets'}
				<div class="flex items-center gap-2 py-4 text-sm text-muted-foreground">
					<LoaderCircle class="h-4 w-4 animate-spin" /><span>Loading from Google Sheets...</span>
				</div>
			{/if}

			{#if step === 3 && restorePreview}
				<div class="rounded-lg border border-border bg-muted p-4">
					<h4 class="mb-3 font-medium text-foreground">In this backup</h4>
					<div class="space-y-2 text-sm">
						<div class="flex justify-between">
							<span class="text-muted-foreground">Vehicles:</span><span
								class="font-medium text-foreground"
							>
								{restorePreview['vehicles'] || 0}
							</span>
						</div>
						<div class="flex justify-between">
							<span class="text-muted-foreground">Expenses:</span><span
								class="font-medium text-foreground"
							>
								{restorePreview['expenses'] || 0}
							</span>
						</div>
						<div class="flex justify-between">
							<span class="text-muted-foreground">Insurance:</span><span
								class="font-medium text-foreground"
							>
								{restorePreview['insurance'] || 0}
							</span>
						</div>
						{#if restorePreview['photos']}<div class="flex justify-between">
								<span class="text-muted-foreground">Photos:</span><span
									class="font-medium text-foreground"
								>
									{restorePreview['photos']}
								</span>
							</div>{/if}
					</div>
					{#if restorePreview['financing'] || restorePreview['insurancePolicyVehicles']}
						<Collapsible class="mt-3">
							<CollapsibleTrigger
								class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
							>
								<ChevronDown class="h-3 w-3" />Details
							</CollapsibleTrigger>
							<CollapsibleContent class="mt-2 space-y-2 text-sm">
								{#if restorePreview['financing']}<div class="flex justify-between">
										<span class="text-muted-foreground">Financing:</span><span
											class="font-medium text-foreground"
										>
											{restorePreview['financing']}
										</span>
									</div>{/if}
								{#if restorePreview['insurancePolicyVehicles']}<div class="flex justify-between">
										<span class="text-muted-foreground">Policy-Vehicle Links:</span><span
											class="font-medium text-foreground"
										>
											{restorePreview['insurancePolicyVehicles']}
										</span>
									</div>{/if}
							</CollapsibleContent>
						</Collapsible>
					{/if}
				</div>

				{#if skippedPhotos > 0}
					<Alert role="status" data-testid="restore-skipped-photos">
						<AlertDescription>
							{skippedPhotos === 1
								? "1 photo won't be restored because the trip, expense or other item it belonged to was deleted before this backup was made. Everything else in the backup will still be restored."
								: `${skippedPhotos} photos won't be restored because the trips, expenses or other items they belonged to were deleted before this backup was made. Everything else in the backup will still be restored.`}
						</AlertDescription>
					</Alert>
				{/if}

				<div class="space-y-3">
					<p id="restore-mode-label" class="font-medium">How to restore</p>
					<RadioGroup.Root bind:value={restoreMode} aria-labelledby="restore-mode-label">
						<div class="flex items-center gap-2">
							<RadioGroup.Item value="merge" id="mode-merge" />
							<Label for="mode-merge" class="cursor-pointer font-normal">
								<div>
									<div class="font-medium">Merge with what's here</div>
									<div class="text-sm text-muted-foreground">
										Keeps anything you added since the backup. Records already here stay as they
										are.
									</div>
									{#if mergePreview}
										<div class="text-sm text-foreground" data-testid="restore-merge-counts">
											{total(mergePreview.imported) === 0
												? 'Nothing new to add from this backup.'
												: `${records(total(mergePreview.imported))} to add, ${total(mergePreview.kept)} already here or skipped.`}
										</div>
									{/if}
								</div>
							</Label>
						</div>
						<div class="flex items-center gap-2">
							<RadioGroup.Item value="replace" id="mode-replace" />
							<Label for="mode-replace" class="cursor-pointer font-normal">
								<div>
									<div class="font-medium">Replace everything</div>
									<div class="text-sm text-muted-foreground">
										Deletes what's here and brings in the backup
									</div>
								</div>
							</Label>
						</div>
					</RadioGroup.Root>
				</div>
			{/if}

			{#if step === 4}
				<div class="space-y-3" data-testid="restore-dropped-grants">
					<p class="text-sm text-foreground">
						Access someone had on a car comes back only while it still fits that car. These didn't:
					</p>
					<ul class="space-y-2">
						{#each droppedCars as [vehicleId, entry] (vehicleId)}
							<li class="rounded-(--r-md) border bg-surface p-3 text-sm">
								<div class="font-medium text-foreground">{entry.car}</div>
								{#each Object.entries(entry.reasons) as [reason, count] (reason)}
									<div class="text-muted-foreground">
										{count === 1 ? '1 sharing setting' : `${count} sharing settings`}: {reason}.
									</div>
								{/each}
							</li>
						{/each}
					</ul>
					<p class="text-sm text-muted-foreground">
						To give someone access again, use the sharing settings on that car.
					</p>
				</div>
			{/if}
		</div>

		<Dialog.Footer class="flex gap-2">
			{#if step > 1 && step < 4}
				<Button variant="ghost" onclick={handleBack} disabled={isProcessing}>
					<ArrowLeft aria-hidden="true" />Back
				</Button>
			{/if}
			<div class="flex-1"></div>
			{#if step === 4}
				<Button bind:ref={doneButton} onclick={close}>Done</Button>
			{:else}
				<Button variant="outline" onclick={close}>Cancel</Button>
			{/if}
			{#if step === 3 && restorePreview}
				<Button disabled={isProcessing} onclick={handleRestore}>
					{#if isProcessing}
						<LoaderCircle class="animate-spin" aria-hidden="true" />Restoring…
					{:else if restoreMode === 'merge'}
						Merge
					{:else}
						Replace everything
					{/if}
				</Button>
			{/if}
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
