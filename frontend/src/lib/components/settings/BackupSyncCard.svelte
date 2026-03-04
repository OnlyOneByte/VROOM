<script lang="ts">
	import { Database, Download, Upload, LoaderCircle, RefreshCw, Info } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import { Switch } from '$lib/components/ui/switch';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import type { UserSettings } from '$lib/types';

	interface Props {
		settings: UserSettings | null;
		isBackingUp: boolean;
		googleDriveBackupEnabled: boolean;
		googleDriveBackupRetentionCount: number;
		googleDriveCustomFolderName: string;
		googleSheetsSyncEnabled: boolean;
		syncInactivityMinutes: number;
		onBackup: () => void;
		onRestoreClick: () => void;
		onRestoreFromDriveClick: () => void;
		onRestoreFromSheetsClick: () => void;
		onBackupNowClick: () => void;
		onReauthenticate: () => void;
	}

	let {
		settings,
		isBackingUp,
		googleDriveBackupEnabled = $bindable(),
		googleDriveBackupRetentionCount = $bindable(),
		googleDriveCustomFolderName = $bindable(),
		googleSheetsSyncEnabled = $bindable(),
		syncInactivityMinutes = $bindable(),
		onBackup,
		onRestoreClick,
		onRestoreFromDriveClick,
		onRestoreFromSheetsClick,
		onBackupNowClick,
		onReauthenticate
	}: Props = $props();

	let lastBackupText = $derived.by(() => {
		const dateStr = settings?.lastBackupDate;
		if (!dateStr) return 'Never';
		return new Date(dateStr).toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	});

	let lastSheetsBackupText = $derived.by(() => {
		const syncDate = settings?.lastSyncDate;
		if (!syncDate) return 'Never';
		return new Date(syncDate).toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	});

	let folderNameError = $derived(
		googleDriveCustomFolderName && /[/\\]/.test(googleDriveCustomFolderName)
			? 'Folder name must not contain / or \\'
			: googleDriveCustomFolderName && googleDriveCustomFolderName.length > 255
				? 'Folder name must be 255 characters or fewer'
				: null
	);

	let anyCloudEnabled = $derived(googleDriveBackupEnabled || googleSheetsSyncEnabled);
</script>

<Card>
	<CardHeader>
		<CardTitle>Data Backups</CardTitle>
		<CardDescription
			>Manual backups and automatic cloud sync to Google Drive & Sheets</CardDescription
		>
	</CardHeader>
	<CardContent class="space-y-6">
		<!-- Manual Backup Actions -->
		<div class="space-y-3">
			<Label class="flex items-center gap-2">
				<Database class="h-4 w-4" />
				Manual Backup
			</Label>
			<p class="text-sm text-muted-foreground">Download or upload ZIP files for offline storage</p>
			<div class="flex flex-col sm:flex-row gap-3">
				<Button variant="outline" onclick={onBackup} disabled={isBackingUp} class="flex-1">
					{#if isBackingUp}
						<LoaderCircle class="mr-2 h-4 w-4 animate-spin" />
						Creating...
					{:else}
						<Download class="mr-2 h-4 w-4" />
						Download Backup
					{/if}
				</Button>
				<Button variant="outline" onclick={onRestoreClick} class="flex-1">
					<Upload class="mr-2 h-4 w-4" />
					Upload Backup
				</Button>
			</div>
			<div class="flex items-center justify-between opacity-50">
				<div class="space-y-0.5">
					<Label for="backup-photos">Include photos in ZIP backup</Label>
					<p class="text-sm text-muted-foreground">
						Embed photo files in the backup archive (coming soon)
					</p>
				</div>
				<Switch id="backup-photos" checked={false} disabled />
			</div>
		</div>

		<!-- Storage Provider Options -->
		<div class="border-t pt-6 space-y-5">
			<Label class="text-base font-semibold">Storage Provider Options</Label>

			<!-- Folder Name (top-level, powers all Drive features) -->
			<div class="space-y-2">
				<div class="flex items-center gap-1.5">
					<Label for="folder-name">Google Drive folder name</Label>
					<Tooltip.Provider>
						<Tooltip.Root>
							<Tooltip.Trigger>
								<Info class="h-3.5 w-3.5 text-muted-foreground" />
							</Tooltip.Trigger>
							<Tooltip.Content>
								<p class="max-w-56">
									Base folder in Google Drive where backups, photos, and sheets are stored
								</p>
							</Tooltip.Content>
						</Tooltip.Root>
					</Tooltip.Provider>
				</div>
				<Input
					id="folder-name"
					bind:value={googleDriveCustomFolderName}
					placeholder="VROOM Car Tracker - Your Name"
					class={folderNameError ? 'border-destructive' : ''}
				/>
				{#if folderNameError}
					<p class="text-xs text-destructive">{folderNameError}</p>
				{:else}
					<p class="text-xs text-muted-foreground">Leave empty to use the default name</p>
				{/if}
			</div>

			<!-- Backups sub-section -->
			<div class="space-y-4">
				<Label class="text-sm font-medium">Backups</Label>

				<!-- Google Drive Backup toggle + inline restore -->
				<div class="flex items-center justify-between gap-3">
					<div class="flex-1 space-y-0.5">
						<div class="flex items-center gap-2">
							<Label for="google-drive-backup" class="text-sm">Google Drive</Label>
							{#if googleDriveBackupEnabled}
								<Button
									variant="ghost"
									size="sm"
									class="h-auto px-2 py-0.5 text-xs text-muted-foreground"
									onclick={onRestoreFromDriveClick}
								>
									<Upload class="mr-1 h-3 w-3" />
									Restore
								</Button>
							{/if}
						</div>
						{#if googleDriveBackupEnabled && (settings?.lastBackupDate || settings?.lastSyncDate)}
							<p class="text-xs text-muted-foreground">Last: {lastBackupText}</p>
						{:else}
							<p class="text-xs text-muted-foreground">Auto-backup ZIP files after inactivity</p>
						{/if}
					</div>
					<Switch id="google-drive-backup" bind:checked={googleDriveBackupEnabled} />
				</div>

				{#if googleDriveBackupEnabled}
					<div class="space-y-2 pl-6">
						<Label for="retention-count" class="text-xs">Backups to keep</Label>
						<Select.Root
							type="single"
							value={googleDriveBackupRetentionCount.toString()}
							onValueChange={v => {
								if (v) googleDriveBackupRetentionCount = parseInt(v);
							}}
						>
							<Select.Trigger id="retention-count" class="w-full">
								{googleDriveBackupRetentionCount}
								{googleDriveBackupRetentionCount === 1 ? 'backup' : 'backups'}
							</Select.Trigger>
							<Select.Content>
								<Select.Item value="5" label="5 backups">5 backups</Select.Item>
								<Select.Item value="10" label="10 backups">10 backups</Select.Item>
								<Select.Item value="15" label="15 backups">15 backups</Select.Item>
								<Select.Item value="20" label="20 backups">20 backups</Select.Item>
								<Select.Item value="30" label="30 backups">30 backups</Select.Item>
								<Select.Item value="50" label="50 backups">50 backups</Select.Item>
							</Select.Content>
						</Select.Root>
						<p class="text-xs text-muted-foreground">Older backups are automatically deleted</p>
					</div>
				{/if}

				<!-- Google Sheets toggle + inline restore -->
				<div class="flex items-center justify-between gap-3">
					<div class="flex-1 space-y-0.5">
						<div class="flex items-center gap-2">
							<Label for="sheets-sync" class="text-sm">Google Sheets</Label>
							{#if googleSheetsSyncEnabled}
								<Button
									variant="ghost"
									size="sm"
									class="h-auto px-2 py-0.5 text-xs text-muted-foreground"
									onclick={onRestoreFromSheetsClick}
								>
									<Upload class="mr-1 h-3 w-3" />
									Restore
								</Button>
							{/if}
						</div>
						{#if googleSheetsSyncEnabled && settings?.lastSyncDate}
							<p class="text-xs text-muted-foreground">Last: {lastSheetsBackupText}</p>
						{:else}
							<p class="text-xs text-muted-foreground">
								Mirror data to a Google Sheets spreadsheet
							</p>
						{/if}
					</div>
					<Switch id="sheets-sync" bind:checked={googleSheetsSyncEnabled} />
				</div>
			</div>

			<!-- Auto-Backup Settings (shown when any cloud option is on) -->
			{#if anyCloudEnabled}
				<div class="border-t pt-5 space-y-4">
					<div class="space-y-2">
						<Label for="inactivity-minutes" class="text-sm">Trigger backup after inactivity</Label>
						<Select.Root
							type="single"
							value={syncInactivityMinutes.toString()}
							onValueChange={v => {
								if (v) syncInactivityMinutes = parseInt(v);
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

					<div class="flex flex-col sm:flex-row gap-2">
						<Button variant="outline" onclick={onBackupNowClick} class="flex-1">
							<RefreshCw class="mr-2 h-4 w-4" />
							Backup Now
						</Button>
						<Button variant="outline" onclick={onReauthenticate} class="flex-1">
							<RefreshCw class="mr-2 h-4 w-4" />
							Re-authenticate
						</Button>
					</div>
				</div>
			{/if}
		</div>
	</CardContent>
</Card>
