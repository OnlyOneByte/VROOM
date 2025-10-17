<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as RadioGroup from '$lib/components/ui/radio-group';
	import { LoaderCircle } from 'lucide-svelte';

	interface DriveBackup {
		id: string;
		name: string;
		size: string;
		createdTime: string;
		modifiedTime: string;
		webViewLink: string;
	}

	interface Props {
		open: boolean;
		isLoadingBackups: boolean;
		isRestoring: boolean;
		driveBackups: DriveBackup[];
		selectedBackupId: string | null;
		restoreMode: 'preview' | 'replace' | 'merge';
		restorePreview: any;
		restoreConflicts: any[];
		onBackupSelect: (_fileId: string) => void;
		onRestore: () => void;
	}

	let {
		open = $bindable(),
		isLoadingBackups,
		isRestoring,
		driveBackups,
		selectedBackupId,
		restoreMode = $bindable(),
		restorePreview,
		restoreConflicts,
		onBackupSelect,
		onRestore
	}: Props = $props();
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-2xl max-h-[90vh] overflow-y-auto">
		<Dialog.Header>
			<Dialog.Title>Restore from Google Drive Backup</Dialog.Title>
			<Dialog.Description>Select a backup from your Google Drive to restore</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-6 py-4">
			<!-- Backup List -->
			<div class="space-y-2">
				<Label>Available Backups</Label>
				{#if isLoadingBackups}
					<div class="flex items-center gap-2 text-sm text-gray-600 py-4">
						<LoaderCircle class="h-4 w-4 animate-spin" />
						<span>Loading backups...</span>
					</div>
				{:else if driveBackups.length === 0}
					<p class="text-sm text-gray-500 py-4">
						No backups found in Google Drive. Create a backup first by enabling Google Drive backup
						and syncing.
					</p>
				{:else}
					<div class="space-y-2 max-h-64 overflow-y-auto border rounded-lg p-2">
						{#each driveBackups as backup}
							<button
								type="button"
								onclick={() => onBackupSelect(backup.id)}
								class="w-full text-left p-3 rounded border transition-colors {selectedBackupId ===
								backup.id
									? 'border-primary-500 bg-primary-50'
									: 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'}"
							>
								<div class="flex justify-between items-start">
									<div class="flex-1">
										<div class="font-medium text-sm">{backup.name}</div>
										<div class="text-xs text-gray-500 mt-1">
											Created: {new Date(backup.createdTime).toLocaleDateString('en-US', {
												year: 'numeric',
												month: 'short',
												day: 'numeric',
												hour: '2-digit',
												minute: '2-digit'
											})}
										</div>
										<div class="text-xs text-gray-500">
											Size: {(parseInt(backup.size) / 1024).toFixed(2)} KB
										</div>
									</div>
									{#if selectedBackupId === backup.id}
										<div class="text-primary-600 text-sm font-medium">Selected</div>
									{/if}
								</div>
							</button>
						{/each}
					</div>
				{/if}
			</div>

			<!-- Restore Mode (only show after backup is selected and preview loaded) -->
			{#if restorePreview}
				<div class="space-y-3">
					<Label>Restore Mode</Label>
					<RadioGroup.Root bind:value={restoreMode}>
						<div class="flex items-center space-x-2">
							<RadioGroup.Item value="replace" id="drive-mode-replace" />
							<Label for="drive-mode-replace" class="font-normal cursor-pointer">
								<div>
									<div class="font-medium">Replace All</div>
									<div class="text-sm text-gray-500">
										Delete all existing data and import from backup
									</div>
								</div>
							</Label>
						</div>
						<div class="flex items-center space-x-2 opacity-50">
							<RadioGroup.Item value="merge" id="drive-mode-merge" disabled />
							<Label for="drive-mode-merge" class="font-normal cursor-not-allowed">
								<div>
									<div class="font-medium">Merge (Coming Soon)</div>
									<div class="text-sm text-gray-500">
										Merge backup data with existing data - currently unavailable
									</div>
								</div>
							</Label>
						</div>
					</RadioGroup.Root>
				</div>
			{/if}

			<!-- Preview Results -->
			{#if isRestoring && !restorePreview}
				<div class="flex items-center gap-2 text-sm text-primary-600">
					<LoaderCircle class="h-4 w-4 animate-spin" />
					<span>Generating preview...</span>
				</div>
			{/if}

			{#if restorePreview}
				<div class="border rounded-lg p-4 bg-gray-50">
					<h4 class="font-medium mb-3">Import Summary</h4>
					<div class="space-y-2 text-sm">
						<div class="flex justify-between">
							<span>Vehicles:</span>
							<span class="font-medium">{restorePreview.vehicles || 0}</span>
						</div>
						<div class="flex justify-between">
							<span>Expenses:</span>
							<span class="font-medium">{restorePreview.expenses || 0}</span>
						</div>
						<div class="flex justify-between">
							<span>Insurance Policies:</span>
							<span class="font-medium">{restorePreview.insurance || 0}</span>
						</div>
						<div class="flex justify-between">
							<span>Vehicle Financing:</span>
							<span class="font-medium">{restorePreview.financing || 0}</span>
						</div>
						<div class="flex justify-between">
							<span>Financing Payments:</span>
							<span class="font-medium">{restorePreview.financingPayments || 0}</span>
						</div>
					</div>
				</div>
			{/if}

			<!-- Conflicts -->
			{#if restoreConflicts.length > 0}
				<div class="border border-yellow-300 rounded-lg p-4 bg-yellow-50">
					<h4 class="font-medium mb-3 text-yellow-800">Conflicts Detected</h4>
					<p class="text-sm text-yellow-700 mb-3">
						{restoreConflicts.length} conflict(s) found. These records exist in both your current data
						and the backup with different values.
					</p>
					<div class="space-y-2 max-h-48 overflow-y-auto">
						{#each restoreConflicts as conflict}
							<div class="text-sm bg-white p-2 rounded border">
								<div class="font-medium">{conflict.table} - ID: {conflict.id}</div>
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</div>

		<Dialog.Footer class="flex gap-2">
			<Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
			{#if restorePreview}
				<Button
					onclick={onRestore}
					disabled={!selectedBackupId ||
						isRestoring ||
						(restoreMode === 'merge' && restoreConflicts.length > 0)}
				>
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
