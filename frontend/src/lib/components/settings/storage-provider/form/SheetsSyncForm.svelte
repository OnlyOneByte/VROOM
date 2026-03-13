<script lang="ts">
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import { Input } from '$lib/components/ui/input';

	let {
		enabled = false,
		spreadsheetId = '',
		onEnabledChange,
		onSpreadsheetIdChange
	}: {
		enabled?: boolean;
		spreadsheetId?: string;
		onEnabledChange: (_enabled: boolean) => void;
		onSpreadsheetIdChange: (_id: string) => void;
	} = $props();
</script>

<div class="border-t border-border pt-4 space-y-4">
	<div class="flex items-center justify-between">
		<div class="space-y-0.5">
			<Label for="sheets-sync" class="text-sm">Google Sheets sync</Label>
			<p class="text-xs text-muted-foreground">Sync data to a Google Spreadsheet</p>
		</div>
		<Switch
			id="sheets-sync"
			checked={enabled}
			onCheckedChange={checked => onEnabledChange(checked === true)}
		/>
	</div>

	{#if enabled}
		<div class="space-y-2">
			<Label for="sheets-spreadsheet-id" class="text-sm">Spreadsheet ID</Label>
			<Input
				id="sheets-spreadsheet-id"
				value={spreadsheetId}
				oninput={e => onSpreadsheetIdChange(e.currentTarget.value)}
				placeholder="Enter spreadsheet ID or leave blank to auto-create"
				class="h-9 font-mono text-sm"
			/>
			<p class="text-xs text-muted-foreground">
				The ID from the spreadsheet URL. Leave blank to create a new one on first sync.
			</p>
		</div>
	{:else if spreadsheetId}
		<div class="space-y-1">
			<Label class="text-xs text-muted-foreground">Spreadsheet ID</Label>
			<p class="text-sm font-mono text-foreground break-all rounded-md bg-muted px-3 py-2">
				{spreadsheetId}
			</p>
		</div>
	{/if}
</div>
