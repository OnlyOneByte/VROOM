<script lang="ts">
	import * as Dialog from '#lib/components/ui/dialog/index.ts';
	import { Button } from '#lib/components/ui/button/index.ts';
	import { LoaderCircle } from '@lucide/svelte';
	import type { Vehicle } from '#lib/types/index.ts';
	import { ImportExpensesForm } from './import-expenses/import-expenses-form.svelte';
	import ImportCsvSource from './import-expenses/ImportCsvSource.svelte';
	import ImportSourceDetection from './import-expenses/ImportSourceDetection.svelte';
	import ManualMappingPanel from './import-expenses/ManualMappingPanel.svelte';
	import ImportPreviewSummary from './import-expenses/ImportPreviewSummary.svelte';
	import CategoryRemapPanel from './import-expenses/CategoryRemapPanel.svelte';

	interface Props {
		open: boolean;
		vehicles: Vehicle[];
		onImported: () => void;
	}

	let { open = $bindable(), vehicles, onImported }: Props = $props();

	const form = new ImportExpensesForm(() => vehicles);

	$effect(() => {
		if (!open) form.reset();
	});

	async function handleCommit() {
		if (await form.commit(onImported)) open = false;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-lg max-h-[90vh] overflow-y-auto">
		<Dialog.Header>
			<Dialog.Title>Import expenses from CSV</Dialog.Title>
			<Dialog.Description>
				Upload a VROOM CSV export, or a fuel log from Fuelly, Fuelio, or Drivvo — we'll detect the
				format automatically. You'll see a preview before anything is saved.
			</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-4">
			<ImportCsvSource
				bind:csvText={form.csvText}
				fileName={form.fileName}
				onFileChange={file => form.loadFile(file)}
				onPasteBlur={() => form.handlePasteBlur()}
			/>

			<ImportSourceDetection
				isDetecting={form.isDetecting}
				preset={form.detectedPreset}
				{vehicles}
				targetVehicleId={form.targetVehicleId}
				onVehicleChange={id => form.changeTargetVehicle(id)}
			/>

			{#if form.manualMapping}
				<ManualMappingPanel {form} {vehicles} />
			{/if}

			<ImportPreviewSummary
				isPreviewing={form.isPreviewing}
				preview={form.preview}
				errorRows={form.errorRows}
				needsTargetVehicle={form.needsTargetVehicle}
				needsManualMapping={form.needsManualMapping}
				hasCsv={!!form.csvText.trim()}
			/>

			<CategoryRemapPanel
				unmappedCategories={form.unmappedCategories}
				categoryRemap={form.categoryRemap}
				onRemap={(word, category) => form.setCategoryRemap(word, category)}
			/>
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)} disabled={form.isImporting}
				>Cancel</Button
			>
			<Button
				onclick={handleCommit}
				disabled={form.isImporting || !form.preview || form.preview.readyCount === 0}
			>
				{#if form.isImporting}
					<LoaderCircle class="mr-2 h-4 w-4 animate-spin" />
					Importing…
				{:else}
					Import {form.preview?.readyCount ?? 0}
					{(form.preview?.readyCount ?? 0) === 1 ? 'row' : 'rows'}
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
