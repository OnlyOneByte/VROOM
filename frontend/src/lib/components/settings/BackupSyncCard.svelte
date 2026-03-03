<script lang="ts">
	import { Database, Download, Upload, LoaderCircle, RefreshCw } from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import { Switch } from '$lib/components/ui/switch';
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
</script>

<Card>
	<CardHeader>
		<CardTitle>Data Backups</CardTitle>
		<CardDescription
			>Manage manual backups and automatic backups to Google Drive & Sheets</CardDescription
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

		<div class="border-t pt-6 space-y-6">
			<!-- Google Drive Backup -->
			<div class="flex items-center justify-between">
				<div class="space-y-0.5">
					<Label for="google-drive-backup">Google Drive Backup</Label>
					<p class="text-sm text-muted-foreground">
						Auto-backup files to Google Drive after inactivity
					</p>
				</div>
				<Switch id="google-drive-backup" bind:checked={googleDriveBackupEnabled} />
			</div>

			{#if googleDriveBackupEnabled}
				{#if settings?.lastBackupDate || settings?.lastSyncDate}
					<div class="pl-6">
						<p class="text-sm text-muted-foreground">
							Last backup: <span class="font-medium">{lastBackupText}</span>
						</p>
					</div>
				{/if}

				<div class="space-y-2 pl-6">
					<Label for="retention-count">Number of backups to keep</Label>
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
					<p class="text-xs text-muted-foreground">Older backups will be automatically deleted</p>
				</div>

				<div class="pl-6">
					<Button variant="outline" onclick={onRestoreFromDriveClick} class="w-full">
						<Upload class="mr-2 h-4 w-4" />
						Restore from Drive Backup
					</Button>
				</div>
			{/if}

			<!-- Backup to Google Sheets -->
			<div class="flex items-center justify-between">
				<div class="space-y-0.5">
					<Label for="sheets-sync">Backup to Google Sheets</Label>
					<p class="text-sm text-muted-foreground">
						Auto-backup data to Google Sheets after inactivity
					</p>
				</div>
				<Switch id="sheets-sync" bind:checked={googleSheetsSyncEnabled} />
			</div>

			{#if googleSheetsSyncEnabled}
				{#if settings?.lastSyncDate}
					<div class="pl-6">
						<p class="text-sm text-muted-foreground">
							Last backup: <span class="font-medium">{lastSheetsBackupText}</span>
						</p>
					</div>
				{/if}

				<div class="pl-6">
					<Button variant="outline" onclick={onRestoreFromSheetsClick} class="w-full">
						<Upload class="mr-2 h-4 w-4" />
						Restore from Google Sheets
					</Button>
				</div>
			{/if}

			<!-- Auto-Backup Settings -->
			{#if googleDriveBackupEnabled || googleSheetsSyncEnabled}
				<div class="border-t pt-6 space-y-4">
					<div class="space-y-1">
						<Label for="inactivity-minutes" class="text-base font-semibold">
							Automatic Backup Settings
						</Label>
						<p class="text-sm text-muted-foreground">
							Automatically backup your data after a period of inactivity.
						</p>
					</div>

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
						<p class="text-xs text-muted-foreground">
							Backup will trigger automatically after this period of no activity
						</p>
					</div>

					<div class="space-y-2">
						<Label class="text-sm">Manual Actions</Label>
						<div class="space-y-2">
							<Button variant="outline" onclick={onBackupNowClick} class="w-full">
								<RefreshCw class="mr-2 h-4 w-4" />
								Backup Now
							</Button>
							<Button variant="outline" onclick={onReauthenticate} class="w-full">
								<RefreshCw class="mr-2 h-4 w-4" />
								Re-authenticate with Google
							</Button>
						</div>
					</div>
				</div>
			{/if}
		</div>
	</CardContent>
</Card>
