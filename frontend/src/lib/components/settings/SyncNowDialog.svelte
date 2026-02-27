<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Label } from '$lib/components/ui/label';
	import * as Dialog from '$lib/components/ui/dialog';
	import { LoaderCircle, RefreshCw } from 'lucide-svelte';

	interface Props {
		open: boolean;
		isSyncing: boolean;
		syncSheets: boolean;
		syncBackup: boolean;
		googleSheetsSyncEnabled: boolean;
		googleDriveBackupEnabled: boolean;
		syncResults: any;
		onSync: () => void;
	}

	let {
		open = $bindable(),
		isSyncing,
		syncSheets = $bindable(),
		syncBackup = $bindable(),
		googleSheetsSyncEnabled,
		googleDriveBackupEnabled,
		syncResults,
		onSync
	}: Props = $props();
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-lg">
		<Dialog.Header>
			<Dialog.Title>Sync Now</Dialog.Title>
			<Dialog.Description>Choose which sync operations to perform</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-4 py-4">
			<!-- Sync Type Selection -->
			<div class="space-y-3">
				<Label>Sync Types</Label>
				<div class="space-y-3">
					<div class="flex items-center space-x-2">
						<Checkbox
							id="sync-sheets"
							bind:checked={syncSheets}
							disabled={!googleSheetsSyncEnabled}
						/>
						<Label for="sync-sheets" class="font-normal cursor-pointer">
							<div>
								<div class="font-medium">Google Sheets</div>
								<div class="text-sm text-gray-500">
									{googleSheetsSyncEnabled
										? 'Sync data to Google Sheets'
										: 'Enable Google Sheets sync in settings first'}
								</div>
							</div>
						</Label>
					</div>
					<div class="flex items-center space-x-2">
						<Checkbox
							id="sync-backup"
							bind:checked={syncBackup}
							disabled={!googleDriveBackupEnabled}
						/>
						<Label for="sync-backup" class="font-normal cursor-pointer">
							<div>
								<div class="font-medium">Google Drive Backup</div>
								<div class="text-sm text-gray-500">
									{googleDriveBackupEnabled
										? 'Upload backup to Google Drive'
										: 'Enable Google Drive backup in settings first'}
								</div>
							</div>
						</Label>
					</div>
				</div>
			</div>

			<!-- Sync Results -->
			{#if syncResults?.data?.results}
				<div class="border rounded-lg p-4 bg-gray-50">
					<h4 class="font-medium mb-3">Sync Results</h4>
					<div class="space-y-2 text-sm">
						{#if syncResults.data.results.sheets}
							{@const sheets = syncResults.data.results.sheets}
							<div
								class="flex items-center gap-2 {sheets.success ? 'text-green-600' : 'text-red-600'}"
							>
								<span class="font-medium">{sheets.success ? '✓' : '✗'} Google Sheets:</span>
								<span
									>{sheets.skipped
										? 'No changes to sync'
										: sheets.success
											? 'Synced successfully'
											: sheets.message || 'Failed'}</span
								>
							</div>
						{/if}
						{#if syncResults.data.results.backup}
							{@const backup = syncResults.data.results.backup}
							<div
								class="flex items-center gap-2 {backup.success ? 'text-green-600' : 'text-red-600'}"
							>
								<span class="font-medium">{backup.success ? '✓' : '✗'} Google Drive:</span>
								<span
									>{backup.skipped
										? 'No changes to sync'
										: backup.success
											? 'Backup uploaded'
											: backup.message || 'Failed'}</span
								>
							</div>
							{#if backup.success && backup.deletedOldBackups > 0}
								<div class="text-xs text-gray-500 pl-5">
									Cleaned up {backup.deletedOldBackups} old backup{backup.deletedOldBackups > 1
										? 's'
										: ''}
								</div>
							{/if}
						{/if}
					</div>
				</div>
			{/if}
		</div>

		<Dialog.Footer class="flex gap-2">
			<Button variant="outline" onclick={() => (open = false)}>
				{syncResults?.data?.results ? 'Close' : 'Cancel'}
			</Button>
			{#if !syncResults?.data?.results}
				<Button onclick={onSync} disabled={isSyncing || (!syncSheets && !syncBackup)}>
					{#if isSyncing}
						<LoaderCircle class="mr-2 h-4 w-4 animate-spin" />
						Syncing...
					{:else}
						<RefreshCw class="mr-2 h-4 w-4" />
						Sync Now
					{/if}
				</Button>
			{/if}
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
