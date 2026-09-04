<script lang="ts">
	/**
	 * Migrate data from another tracker (data-migration spec) — a DEDICATED settings surface, distinct
	 * from the expenses page's own-format CSV re-import. v1 implements the Fuelio standard: the user
	 * picks a target vehicle, uploads the tracker's export file, previews (dryRun), and
	 * commits. A Fuelio export is a multi-section file, so this sends `source:'fuelio'` — the backend
	 * routes it to the Fuelio adapter (splits sections, converts units, maps costs) and then runs the
	 * same validate/idempotent-commit pipeline as every import.
	 *
	 * Mirrors the PushNotificationsCard shell (Card + four-states) with an inline migration Dialog.
	 */
	import { onMount } from 'svelte';
	import { DatabaseZap, Upload, LoaderCircle, CircleCheck, CircleAlert } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Select from '$lib/components/ui/select';
	import * as Dialog from '$lib/components/ui/dialog';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { vehicleApi } from '$lib/services/vehicle-api';
	import { expenseApi, type ExpenseImportResult } from '$lib/services/expense-api';
	import { appStore } from '$lib/stores/app.svelte';
	import { getVehicleDisplayName } from '$lib/utils/vehicle-helpers';
	import { handleErrorWithNotification } from '$lib/utils/error-handling';
	import type { ImportColumnMapping, Vehicle } from '$lib/types';

	// v1 migrates from Fuelio. A second tracker is an additive follow-on: it reuses this whole
	// preview/commit flow, and only then is a source picker worth showing.
	const TRACKER_LABEL = 'Fuelio';

	let vehicles = $state<Vehicle[]>([]);
	let isLoading = $state(true);
	let loadError = $state<string | null>(null);

	let dialogOpen = $state(false);
	let targetVehicleId = $state('');
	let fileName = $state<string | null>(null);
	let csvText = $state('');
	let preview = $state<ExpenseImportResult | null>(null);
	let isPreviewing = $state(false);
	let isImporting = $state(false);
	// Monotonic token: only the newest preview request may write `preview`. Changing the vehicle while
	// an earlier request is still in flight would otherwise paint counts for the wrong vehicle.
	let previewSeq = 0;

	let targetVehicle = $derived(vehicles.find((v) => v.id === targetVehicleId));
	let errorRows = $derived(preview?.rows.filter((r) => r.status === 'error') ?? []);
	let unmappedCategories = $derived(preview?.unmappedCategories ?? []);

	async function loadVehicles() {
		isLoading = true;
		loadError = null;
		try {
			vehicles = await vehicleApi.getVehicles();
			if (vehicles.length === 1 && vehicles[0]) targetVehicleId = vehicles[0].id;
		} catch (e) {
			loadError = e instanceof Error ? e.message : 'Failed to load vehicles';
		} finally {
			isLoading = false;
		}
	}

	onMount(loadVehicles);

	/** The mapping sent to the import endpoint. The Fuelio adapter owns the parsing, so we only pass
	 *  the source tag + target vehicle (columns/dateFormat are placeholders the adapter ignores). */
	function buildMapping(): ImportColumnMapping | null {
		if (!targetVehicle) return null;
		return {
			source: 'fuelio',
			columns: {},
			dateFormat: 'iso',
			targetVehicle: getVehicleDisplayName(targetVehicle)
		};
	}

	async function runPreview() {
		const mapping = buildMapping();
		if (!csvText.trim() || !mapping) {
			preview = null;
			return;
		}
		const seq = ++previewSeq;
		isPreviewing = true;
		preview = null;
		try {
			const result = await expenseApi.importExpensesCsv(csvText, true, mapping);
			if (seq === previewSeq) preview = result;
		} catch (err) {
			if (seq === previewSeq) {
				handleErrorWithNotification(err, `Could not read that ${TRACKER_LABEL} file`);
			}
		} finally {
			if (seq === previewSeq) isPreviewing = false;
		}
	}

	async function handleFileChange(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		fileName = file.name;
		csvText = await file.text();
		// Clear the input so re-picking the SAME file after a cancel still fires a change event.
		input.value = '';
		await runPreview();
	}

	function onVehicleChange(id: string) {
		targetVehicleId = id;
		void runPreview();
	}

	async function handleCommit() {
		const mapping = buildMapping();
		if (!preview || preview.readyCount === 0 || !mapping) return;
		isImporting = true;
		try {
			const result = await expenseApi.importExpensesCsv(csvText, false, mapping);
			appStore.showSuccess(
				`Migrated ${result.imported} ${result.imported === 1 ? 'entry' : 'entries'} from ${TRACKER_LABEL}`
			);
			dialogOpen = false;
		} catch (err) {
			handleErrorWithNotification(err, `Failed to migrate from ${TRACKER_LABEL}`);
		} finally {
			isImporting = false;
		}
	}

	/** Start every migration from a clean slate. Bumping the token abandons any request still in
	 *  flight from a previous open, so its response cannot land in this one. */
	function openDialog() {
		fileName = null;
		csvText = '';
		preview = null;
		isPreviewing = false;
		isImporting = false;
		previewSeq++;
		dialogOpen = true;
	}
</script>

<Card>
	<CardHeader>
		<div class="flex items-center gap-2">
			<DatabaseZap class="h-5 w-5 text-muted-foreground" />
			<CardTitle>Migrate data from another tracker</CardTitle>
		</div>
		<CardDescription>
			Moving from another app? Bring your whole history in one go. Export your data from the other
			tracker, then import it here into one of your vehicles. This is a one-time bulk migration —
			re-running it won't create duplicates.
		</CardDescription>
	</CardHeader>
	<CardContent>
		{#if isLoading}
			<div class="flex items-center justify-center py-6" data-testid="migrate-loading">
				<LoaderCircle class="h-6 w-6 animate-spin text-muted-foreground" />
			</div>
		{:else if loadError}
			<div class="space-y-3" data-testid="migrate-error">
				<p class="text-sm text-destructive">{loadError}</p>
				<Button variant="outline" size="sm" onclick={loadVehicles}>Retry</Button>
			</div>
		{:else if vehicles.length === 0}
			<p class="text-sm text-muted-foreground" data-testid="migrate-no-vehicle">
				Add a vehicle first — migrated entries need a vehicle to belong to.
			</p>
		{:else}
			<div data-testid="migrate-card">
				<Button variant="outline" onclick={openDialog} data-testid="migrate-open">
					<Upload class="mr-2 h-4 w-4" />
					Migrate from another tracker
				</Button>
			</div>
		{/if}
	</CardContent>
</Card>

<Dialog.Root bind:open={dialogOpen}>
	<Dialog.Content class="sm:max-w-lg max-h-[90vh] overflow-y-auto">
		<Dialog.Header>
			<Dialog.Title>Migrate from another tracker</Dialog.Title>
			<Dialog.Description>
				Pick the vehicle to import into, then upload your {TRACKER_LABEL} export file. You'll see a
				preview before anything is saved. Units are converted to your vehicle's units automatically,
				and amounts import in your configured currency.
			</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-4">
			<!-- Target vehicle -->
			<div class="space-y-1.5">
				<label for="migrate-vehicle" class="text-xs font-medium text-foreground">
					Import into vehicle *
				</label>
				<Select.Root type="single" value={targetVehicleId} onValueChange={onVehicleChange}>
					<Select.Trigger id="migrate-vehicle" class="w-full" data-testid="migrate-vehicle">
						{targetVehicle ? getVehicleDisplayName(targetVehicle) : 'Select a vehicle'}
					</Select.Trigger>
					<Select.Content>
						{#each vehicles as v (v.id)}
							<Select.Item value={v.id} label={getVehicleDisplayName(v)}>
								{getVehicleDisplayName(v)}
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>

			<!-- File upload -->
			<div class="space-y-2">
				<label
					for="migrate-file"
					class="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-border bg-muted/30 px-4 py-6 text-sm text-muted-foreground transition-colors hover:bg-muted/50"
				>
					<Upload class="h-5 w-5" />
					<span>{fileName ?? `Choose your ${TRACKER_LABEL} export (.csv)`}</span>
				</label>
				<input
					id="migrate-file"
					type="file"
					accept=".csv,text/csv"
					class="sr-only"
					data-testid="migrate-file"
					onchange={handleFileChange}
				/>
			</div>

			<!-- Preview -->
			{#if isPreviewing}
				<div class="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
					<LoaderCircle class="h-4 w-4 animate-spin" />
					Reading your {TRACKER_LABEL} file…
				</div>
			{:else if preview}
				<div class="rounded-lg border bg-card p-4" data-testid="migrate-preview">
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

					{#if unmappedCategories.length > 0}
						<p class="mt-3 border-t pt-3 text-xs text-muted-foreground">
							Imported as <span class="text-foreground">Misc</span> (no matching VROOM category):
							{unmappedCategories.join(', ')}
						</p>
					{/if}
				</div>
			{:else if csvText.trim() && !targetVehicle}
				<p class="text-sm text-muted-foreground">Choose a vehicle above to preview.</p>
			{/if}
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={() => (dialogOpen = false)} disabled={isImporting}>
				Cancel
			</Button>
			<Button
				onclick={handleCommit}
				disabled={isImporting || !preview || preview.readyCount === 0}
				data-testid="migrate-commit"
			>
				{#if isImporting}
					<LoaderCircle class="mr-2 h-4 w-4 animate-spin" />
					Migrating…
				{:else}
					Migrate {preview?.readyCount ?? 0}
					{(preview?.readyCount ?? 0) === 1 ? 'entry' : 'entries'}
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
