<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as RadioGroup from '$lib/components/ui/radio-group';
	import * as Select from '$lib/components/ui/select';
	import { LoaderCircle, ChevronDown } from '@lucide/svelte';
	import {
		Collapsible,
		CollapsibleContent,
		CollapsibleTrigger
	} from '$lib/components/ui/collapsible';

	interface DriveBackup {
		fileId: string;
		fileName: string;
		size: string;
		createdTime: string;
		modifiedTime: string;
	}

	interface Props {
		open: boolean;
		source: 'file' | 'drive' | 'sheets';
		isRestoring: boolean;
		restoreMode: 'preview' | 'replace' | 'merge';
		restorePreview: Record<string, number | undefined> | null;
		restoreConflicts: Array<{ table?: string; id?: string; field?: string }>;
		onRestore: () => void;
		// File source
		selectedFile?: File | null;
		onFileSelect?: (_event: Event) => void;
		// Drive source
		isLoadingBackups?: boolean;
		driveBackups?: DriveBackup[];
		selectedBackupId?: string | null;
		onBackupSelect?: (_fileId: string) => void;
		// Sheets source
		onPreview?: () => void;
	}

	let {
		open = $bindable(),
		source,
		isRestoring,
		restoreMode = $bindable(),
		restorePreview,
		restoreConflicts,
		onRestore,
		selectedFile = null,
		onFileSelect,
		isLoadingBackups = false,
		driveBackups = [],
		selectedBackupId = null,
		onBackupSelect,
		onPreview
	}: Props = $props();

	let dialogTitle = $derived(
		source === 'file'
			? 'Restore from Backup'
			: source === 'drive'
				? 'Restore from Google Drive Backup'
				: 'Restore from Google Sheets'
	);

	let dialogDescription = $derived(
		source === 'file'
			? 'Upload a backup file and choose how to restore your data'
			: source === 'drive'
				? 'Select a backup from your Google Drive to restore'
				: 'Import your data back from Google Sheets into the app'
	);

	let canRestore = $derived.by(() => {
		if (isRestoring) return false;
		if (!restorePreview) return false;
		if (restoreMode === 'merge' && restoreConflicts.length > 0) return false;
		if (source === 'file' && !selectedFile) return false;
		if (source === 'drive' && !selectedBackupId) return false;
		return true;
	});

	function formatBackupLabel(backup: DriveBackup): string {
		const date = new Date(backup.createdTime).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
		const size = backup.size ? ` · ${(parseInt(backup.size) / 1024).toFixed(0)} KB` : '';
		return `${date}${size}`;
	}

	let selectedBackupLabel = $derived.by(() => {
		if (!selectedBackupId || driveBackups.length === 0) return 'Select a backup';
		const found = driveBackups.find(b => b.fileId === selectedBackupId);
		return found ? formatBackupLabel(found) : 'Select a backup';
	});
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-2xl max-h-[90vh] overflow-y-auto">
		<Dialog.Header>
			<Dialog.Title>{dialogTitle}</Dialog.Title>
			<Dialog.Description>{dialogDescription}</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-6 py-4">
			<!-- Source-specific header -->
			{#if source === 'file'}
				<div class="space-y-2">
					<Label for="backup-file">Backup File</Label>
					<Input id="backup-file" type="file" accept=".zip" onchange={onFileSelect} />
					{#if selectedFile}
						<p class="text-sm text-muted-foreground">
							Selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(2)} KB)
						</p>
					{/if}
				</div>
			{:else if source === 'drive'}
				<div class="space-y-2">
					<Label>Available Backups</Label>
					{#if isLoadingBackups}
						<div class="flex items-center gap-2 text-sm text-muted-foreground py-2">
							<LoaderCircle class="h-4 w-4 animate-spin" />
							<span>Loading backups...</span>
						</div>
					{:else if driveBackups.length === 0}
						<p class="text-sm text-muted-foreground py-2">
							No backups found in Google Drive. Create a backup first by enabling Google Drive
							backup and syncing.
						</p>
					{:else}
						<Select.Root
							type="single"
							value={selectedBackupId ?? undefined}
							onValueChange={v => {
								if (v) onBackupSelect?.(v);
							}}
						>
							<Select.Trigger class="w-full">
								{selectedBackupLabel}
							</Select.Trigger>
							<Select.Content>
								{#each driveBackups as backup (backup.fileId)}
									<Select.Item value={backup.fileId} label={formatBackupLabel(backup)}>
										{formatBackupLabel(backup)}
									</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					{/if}
				</div>
			{:else if source === 'sheets'}
				{#if !restorePreview && !isRestoring}
					<div class="space-y-2">
						<p class="text-sm text-muted-foreground">
							This will read your data from the Google Sheets spreadsheet that was created during
							backup. Click "Preview" to see what will be imported before restoring.
						</p>
						<Button variant="outline" onclick={onPreview} class="w-full">Preview Import</Button>
					</div>
				{/if}
			{/if}

			<!-- Loading indicator -->
			{#if isRestoring && !restorePreview}
				<div class="flex items-center gap-2 text-sm text-primary">
					<LoaderCircle class="h-4 w-4 animate-spin" />
					<span>Generating preview...</span>
				</div>
			{/if}

			<!-- Restore Mode -->
			{#if restorePreview}
				<div class="space-y-3">
					<Label>Restore Mode</Label>
					<RadioGroup.Root bind:value={restoreMode}>
						<div class="flex items-center space-x-2">
							<RadioGroup.Item value="replace" id="mode-replace" />
							<Label for="mode-replace" class="font-normal cursor-pointer">
								<div>
									<div class="font-medium">Replace All</div>
									<div class="text-sm text-muted-foreground">
										Delete all existing data and import from backup
									</div>
								</div>
							</Label>
						</div>
						<div class="flex items-center space-x-2 opacity-50">
							<RadioGroup.Item value="merge" id="mode-merge" disabled />
							<Label for="mode-merge" class="font-normal cursor-not-allowed">
								<div>
									<div class="font-medium">Merge (Coming Soon)</div>
									<div class="text-sm text-muted-foreground">
										Merge backup data with existing data — currently unavailable
									</div>
								</div>
							</Label>
						</div>
					</RadioGroup.Root>
				</div>
			{/if}

			<!-- Import Summary -->
			{#if restorePreview}
				<div class="border rounded-lg p-4 bg-muted">
					<h4 class="font-medium mb-3">Import Summary</h4>
					<div class="space-y-2 text-sm">
						<div class="flex justify-between">
							<span>Vehicles:</span>
							<span class="font-medium">{restorePreview['vehicles'] || 0}</span>
						</div>
						<div class="flex justify-between">
							<span>Expenses:</span>
							<span class="font-medium">{restorePreview['expenses'] || 0}</span>
						</div>
						<div class="flex justify-between">
							<span>Insurance Policies:</span>
							<span class="font-medium">{restorePreview['insurance'] || 0}</span>
						</div>
						{#if restorePreview['photos']}
							<div class="flex justify-between">
								<span>Photos:</span>
								<span class="font-medium">{restorePreview['photos']}</span>
							</div>
						{/if}
					</div>

					{#if restorePreview['financing'] || restorePreview['insurancePolicyVehicles'] || restorePreview['expenseGroups']}
						<Collapsible class="mt-3">
							<CollapsibleTrigger
								class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
							>
								<ChevronDown class="h-3 w-3" />
								Details
							</CollapsibleTrigger>
							<CollapsibleContent class="mt-2 space-y-2 text-sm">
								{#if restorePreview['financing']}
									<div class="flex justify-between">
										<span>Vehicle Financing:</span>
										<span class="font-medium">{restorePreview['financing']}</span>
									</div>
								{/if}
								{#if restorePreview['insurancePolicyVehicles']}
									<div class="flex justify-between">
										<span>Policy-Vehicle Links:</span>
										<span class="font-medium">{restorePreview['insurancePolicyVehicles']}</span>
									</div>
								{/if}
								{#if restorePreview['expenseGroups']}
									<div class="flex justify-between">
										<span>Expense Groups:</span>
										<span class="font-medium">{restorePreview['expenseGroups']}</span>
									</div>
								{/if}
							</CollapsibleContent>
						</Collapsible>
					{/if}
				</div>
			{/if}

			<!-- Conflicts -->
			{#if restoreConflicts.length > 0}
				<div class="border border-chart-5/30 rounded-lg p-4 bg-chart-5/5">
					<h4 class="font-medium mb-3 text-chart-5">Conflicts Detected</h4>
					<p class="text-sm text-muted-foreground mb-3">
						{restoreConflicts.length} conflict(s) found. These records exist in both your current data
						and the backup with different values.
					</p>
					<div class="space-y-2 max-h-48 overflow-y-auto">
						{#each restoreConflicts as conflict, i (i)}
							<div class="text-sm bg-background p-2 rounded border">
								<div class="font-medium">
									{conflict.table ?? conflict.field ?? 'Unknown'} - ID: {conflict.id ?? '-'}
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</div>

		<Dialog.Footer class="flex gap-2">
			<Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
			{#if restorePreview}
				<Button onclick={onRestore} disabled={!canRestore}>
					{#if isRestoring}
						<LoaderCircle class="mr-2 h-4 w-4 animate-spin" />
						Restoring...
					{:else}
						Restore
					{/if}
				</Button>
			{/if}
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
