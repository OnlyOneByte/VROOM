<script lang="ts">
	import { FileSpreadsheet } from '@lucide/svelte';
	import { Label } from '$lib/components/ui/label';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Select from '$lib/components/ui/select';

	let {
		providerRootPrefix = '',
		selectedType,
		backupFolderPath = $bindable('Backups'),
		backupEnabled = $bindable(false),
		backupRetentionCount = $bindable(10),
		sheetsSyncEnabled = $bindable(false),
		sheetsSpreadsheetId = $bindable('')
	}: {
		providerRootPrefix?: string;
		selectedType: string;
		backupFolderPath: string;
		backupEnabled: boolean;
		backupRetentionCount: number;
		sheetsSyncEnabled: boolean;
		sheetsSpreadsheetId: string;
	} = $props();

	let folderPathError = $derived.by(() => {
		if (!backupFolderPath.trim()) return 'Folder path is required';
		if (backupFolderPath.length > 255) return 'Folder path must be 255 characters or less';
		if (backupFolderPath.includes('..')) return 'Folder path must not contain ".."';
		return null;
	});
</script>

<div class="space-y-5">
	<!-- Backup folder path — always visible, shared by ZIP and Sheets -->
	<div class="space-y-2">
		<Label for="backup-folder-path" class="text-sm">Backup folder path</Label>
		<div
			class="flex items-center h-9 rounded-md border {folderPathError
				? 'border-destructive'
				: 'border-input'} bg-background text-sm ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2"
		>
			{#if providerRootPrefix}
				<span class="pl-3 text-muted-foreground select-none shrink-0">{providerRootPrefix}</span>
			{/if}
			<input
				id="backup-folder-path"
				bind:value={backupFolderPath}
				placeholder="Backups"
				class="flex-1 bg-transparent px-3 py-1 outline-none placeholder:text-muted-foreground {providerRootPrefix
					? 'pl-0'
					: ''}"
			/>
		</div>
		{#if folderPathError}
			<p class="text-xs text-destructive">{folderPathError}</p>
		{:else}
			<p class="text-xs text-muted-foreground">All backups are stored under this path</p>
		{/if}
	</div>

	<!-- ZIP backup checkbox -->
	<div class="space-y-3">
		<div class="flex items-start gap-3">
			<Checkbox
				id="backup-zip"
				checked={backupEnabled}
				onCheckedChange={checked => (backupEnabled = checked === true)}
				class="mt-0.5"
			/>
			<div class="space-y-0.5">
				<Label for="backup-zip" class="text-sm cursor-pointer">ZIP backup</Label>
				<p class="text-xs text-muted-foreground">Store compressed backup archives</p>
			</div>
		</div>

		{#if backupEnabled}
			<div class="pl-7 space-y-2">
				<Label for="backup-retention" class="text-sm">Backups to keep</Label>
				<Select.Root
					type="single"
					value={backupRetentionCount.toString()}
					onValueChange={v => {
						if (v) backupRetentionCount = parseInt(v);
					}}
				>
					<Select.Trigger id="backup-retention" class="w-full">
						{backupRetentionCount}
						{backupRetentionCount === 1 ? 'backup' : 'backups'}
					</Select.Trigger>
					<Select.Content>
						<Select.Item value="5" label="5 backups">5 backups</Select.Item>
						<Select.Item value="10" label="10 backups">10 backups</Select.Item>
						<Select.Item value="15" label="15 backups">15 backups</Select.Item>
						<Select.Item value="20" label="20 backups">20 backups</Select.Item>
						<Select.Item value="30" label="30 backups">30 backups</Select.Item>
						<Select.Item value="50" label="50 backups">50 backups</Select.Item>
						<Select.Item value="100" label="100 backups">100 backups</Select.Item>
					</Select.Content>
				</Select.Root>
				<p class="text-xs text-muted-foreground">Older backups are automatically deleted</p>
			</div>
		{/if}
	</div>

	<!-- Google Sheets sync checkbox (Google Drive only) -->
	{#if selectedType === 'google-drive'}
		<div class="space-y-3">
			<div class="flex items-start gap-3">
				<Checkbox
					id="backup-sheets"
					checked={sheetsSyncEnabled}
					onCheckedChange={checked => (sheetsSyncEnabled = checked === true)}
					class="mt-0.5"
				/>
				<div class="space-y-0.5">
					<Label for="backup-sheets" class="text-sm cursor-pointer">Google Sheets sync</Label>
					<p class="text-xs text-muted-foreground">Sync data to a live Google Spreadsheet</p>
				</div>
			</div>

			{#if sheetsSyncEnabled}
				<div class="pl-7">
					{#if sheetsSpreadsheetId}
						<div class="flex items-center gap-2 text-sm">
							<FileSpreadsheet class="h-4 w-4 text-muted-foreground shrink-0" />
							<span class="text-foreground truncate">VROOM Data</span>
							<a
								href="https://docs.google.com/spreadsheets/d/{sheetsSpreadsheetId}"
								target="_blank"
								rel="noopener noreferrer"
								class="text-xs text-primary hover:underline shrink-0"
							>
								Open ↗
							</a>
						</div>
						<p class="text-xs text-muted-foreground mt-1">
							You can rename this spreadsheet in Google Drive.
						</p>
					{:else}
						<p class="text-xs text-muted-foreground">
							A spreadsheet will be created in your backup folder on the first sync. You can rename
							it freely in Google Drive.
						</p>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</div>
