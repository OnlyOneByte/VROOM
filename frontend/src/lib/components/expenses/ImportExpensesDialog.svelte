<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Upload, LoaderCircle, CircleCheck, CircleAlert, FileText } from '@lucide/svelte';
	import { expenseApi, type ExpenseImportResult } from '$lib/services/expense-api';
	import { appStore } from '$lib/stores/app.svelte';
	import { handleErrorWithNotification } from '$lib/utils/error-handling';

	interface Props {
		open: boolean;
		/** Called after a successful commit so the parent can refetch the list. */
		onImported: () => void;
	}

	let { open = $bindable(), onImported }: Props = $props();

	// Workflow: pick/paste CSV → auto preview (dryRun) → review → commit (dryRun:false).
	let csvText = $state('');
	let fileName = $state<string | null>(null);
	let preview = $state<ExpenseImportResult | null>(null);
	let isPreviewing = $state(false);
	let isImporting = $state(false);

	// Only the rows that errored — surfaced so the user can fix + re-import just those.
	let errorRows = $derived(preview?.rows.filter((r) => r.status === 'error') ?? []);

	/** Reset everything when the dialog closes so a re-open starts clean. */
	$effect(() => {
		if (!open) {
			csvText = '';
			fileName = null;
			preview = null;
			isPreviewing = false;
			isImporting = false;
		}
	});

	async function runPreview() {
		if (!csvText.trim()) {
			preview = null;
			return;
		}
		isPreviewing = true;
		preview = null;
		try {
			preview = await expenseApi.importExpensesCsv(csvText, true);
		} catch (err) {
			handleErrorWithNotification(err, 'Could not read that CSV');
		} finally {
			isPreviewing = false;
		}
	}

	async function handleFileChange(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		fileName = file.name;
		csvText = await file.text();
		await runPreview();
	}

	async function handleCommit() {
		if (!preview || preview.readyCount === 0) return;
		isImporting = true;
		try {
			const result = await expenseApi.importExpensesCsv(csvText, false);
			appStore.addNotification({
				type: 'success',
				message: `Imported ${result.imported} expense${result.imported === 1 ? '' : 's'}`
			});
			onImported();
			open = false;
		} catch (err) {
			handleErrorWithNotification(err, 'Failed to import expenses');
		} finally {
			isImporting = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-lg max-h-[90vh] overflow-y-auto">
		<Dialog.Header>
			<Dialog.Title>Import expenses from CSV</Dialog.Title>
			<Dialog.Description>
				Upload a VROOM CSV export (or paste its contents). Each row's vehicle is matched by name
				to one in your garage. You'll see a preview before anything is saved.
			</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-4">
			<!-- File picker -->
			<div class="space-y-2">
				<label
					for="import-csv-file"
					class="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-border bg-muted/30 px-4 py-6 text-sm text-muted-foreground transition-colors hover:bg-muted/50"
				>
					<Upload class="h-5 w-5" />
					<span>{fileName ?? 'Choose a .csv file'}</span>
				</label>
				<input
					id="import-csv-file"
					type="file"
					accept=".csv,text/csv"
					class="sr-only"
					onchange={handleFileChange}
				/>
			</div>

			<!-- Paste fallback -->
			<div class="space-y-2">
				<label for="import-csv-text" class="text-sm font-medium">Or paste CSV</label>
				<textarea
					id="import-csv-text"
					bind:value={csvText}
					onblur={runPreview}
					rows="4"
					placeholder="date,vehicle,category,amount,..."
					class="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				></textarea>
			</div>

			<!-- Preview -->
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
			{:else if csvText.trim()}
				<p class="flex items-center gap-2 text-sm text-muted-foreground">
					<FileText class="h-4 w-4" />
					Click outside the box to preview.
				</p>
			{/if}
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)} disabled={isImporting}>Cancel</Button>
			<Button onclick={handleCommit} disabled={isImporting || !preview || preview.readyCount === 0}>
				{#if isImporting}
					<LoaderCircle class="mr-2 h-4 w-4 animate-spin" />
					Importing…
				{:else}
					Import {preview?.readyCount ?? 0}
					{(preview?.readyCount ?? 0) === 1 ? 'row' : 'rows'}
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
