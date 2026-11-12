<script lang="ts">
	import { CircleAlert, CircleCheck, FileText, LoaderCircle } from '@lucide/svelte';
	import type { ExpenseImportResult } from '#lib/services/expense-api.ts';

	interface Props {
		isPreviewing: boolean;
		preview: ExpenseImportResult | null;
		errorRows: ExpenseImportResult['rows'];
		needsTargetVehicle: boolean;
		needsManualMapping: boolean;
		hasCsv: boolean;
	}

	let { isPreviewing, preview, errorRows, needsTargetVehicle, needsManualMapping, hasCsv }: Props =
		$props();
</script>

{#if isPreviewing}
	<div class="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
		<LoaderCircle class="h-4 w-4 animate-spin" />
		Checking your file…
	</div>
{:else if preview}
	<div class="rounded-lg border bg-card p-4">
		<div class="flex items-center gap-4 text-sm">
			<span class="flex items-center gap-1.5 font-medium text-foreground">
				<CircleCheck class="h-4 w-4 text-chart-2" />
				{preview.readyCount} ready
			</span>
			{#if preview.errorCount > 0}
				<span class="flex items-center gap-1.5 font-medium text-foreground">
					<CircleAlert class="h-4 w-4 text-destructive" />
					{preview.errorCount}
					{preview.errorCount === 1 ? 'row needs' : 'rows need'} attention
				</span>
			{/if}
		</div>

		{#if errorRows.length > 0}
			<div class="mt-3 max-h-40 space-y-1.5 overflow-y-auto border-t pt-3">
				{#each errorRows as row (row.row)}
					<div class="flex gap-2 text-xs">
						<span class="shrink-0 font-medium text-muted-foreground">Row {row.row}</span>
						<span class="text-foreground">{row.message}</span>
					</div>
				{/each}
			</div>
		{/if}

		{#if preview.errorCount > 0 && preview.readyCount > 0}
			<p class="mt-3 text-xs text-muted-foreground">
				Rows with errors are skipped — only the {preview.readyCount} ready
				{preview.readyCount === 1 ? 'row' : 'rows'} will be imported.
			</p>
		{/if}
	</div>
{:else if needsTargetVehicle}
	<p class="flex items-center gap-2 text-sm text-muted-foreground">
		<FileText class="h-4 w-4" />
		Choose a vehicle above to preview the import.
	</p>
{:else if needsManualMapping}
	<p class="flex items-center gap-2 text-sm text-muted-foreground">
		<FileText class="h-4 w-4" />
		Map Date, Amount, and a vehicle above to preview the import.
	</p>
{:else if hasCsv}
	<p class="flex items-center gap-2 text-sm text-muted-foreground">
		<FileText class="h-4 w-4" />
		Click outside the box to preview.
	</p>
{/if}
