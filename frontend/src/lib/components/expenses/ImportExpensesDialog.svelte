<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Select from '$lib/components/ui/select';
	import { Button } from '$lib/components/ui/button';
	import { Upload, LoaderCircle, CircleCheck, CircleAlert, FileText, Sparkles } from '@lucide/svelte';
	import { expenseApi, type ExpenseImportResult } from '$lib/services/expense-api';
	import { appStore } from '$lib/stores/app.svelte';
	import { handleErrorWithNotification } from '$lib/utils/error-handling';
	import { getVehicleDisplayName } from '$lib/utils/vehicle-helpers';
	import { getDistanceUnitLabel, getVolumeUnitLabel } from '$lib/utils/units';
	import {
		guessManualColumns,
		isNativeImportHeaders,
		parseCsvHeaders
	} from '$lib/utils/import-mapping-helpers';
	import type {
		DistanceUnit,
		ImportColumnMapping,
		ImportDateFormat,
		ImportMappingPreset,
		NativeImportField,
		Vehicle,
		VolumeUnit
	} from '$lib/types';

	interface Props {
		open: boolean;
		/** The user's vehicles — needed for the target-vehicle picker on a foreign (mapped) import. */
		vehicles: Vehicle[];
		/** Called after a successful commit so the parent can refetch the list. */
		onImported: () => void;
	}

	let { open = $bindable(), vehicles, onImported }: Props = $props();

	// Workflow: pick/paste CSV → detect a known tracker from its headers → (if foreign) pick the target
	// vehicle → auto preview (dryRun) → review → commit (dryRun:false). A native VROOM export carries its
	// own `vehicle` column, so detection returns null and the mapping step is skipped (unchanged path).
	let csvText = $state('');
	let fileName = $state<string | null>(null);
	let preview = $state<ExpenseImportResult | null>(null);
	let isPreviewing = $state(false);
	let isImporting = $state(false);

	// Foreign-tracker mapping step (T4). `detectedPreset` is the auto-matched tracker (Fuelly/Fuelio/
	// Drivvo) or null for a native/unknown file. The built-in presets are all single-vehicle fuel logs
	// (no `vehicle` column), so when one is detected the user MUST choose the target vehicle (D4) or every
	// row errors "vehicle not found".
	let isDetecting = $state(false);
	let detectedPreset = $state<ImportMappingPreset | null>(null);
	let targetVehicleId = $state('');

	// Manual mapping (T4): when no preset is detected AND the file isn't a native VROOM export, the user
	// maps each VROOM field to one of the file's own header columns. The native VROOM headers are the
	// round-trip-export shape — those import directly with NO mapping (unchanged path), so manual mapping
	// is only offered for an unrecognized foreign file.
	let fileHeaders = $state<string[]>([]);
	let manualMapping = $state(false);
	// VROOM field → the chosen foreign header ('' = unmapped). date/amount are required to import a row.
	let manualColumns = $state<Partial<Record<NativeImportField, string>>>({});
	let manualDateFormat = $state<ImportDateFormat>('iso');
	// The FILE's distance/volume units (T4). applyMapping converts mileage/volume INTO the target
	// vehicle's units ONLY when both the file's unit (this) and the target's unit are known — so without
	// these a manually-mapped metric log (km/litres) would import RAW into a miles/gallons vehicle
	// (NORTH_STAR #2 wrong-numbers). Default to the target's own units (= no conversion, the safe
	// baseline); the user overrides when the file is in a different unit. Only relevant when the
	// mileage/volume columns are mapped.
	let manualDistanceUnit = $state<DistanceUnit>('miles');
	let manualVolumeUnit = $state<VolumeUnit>('gallons_us');

	// The VROOM fields the manual editor exposes (the importer-consumed subset; missedFillup is niche).
	const MAPPABLE_FIELDS: { field: NativeImportField; label: string; required?: boolean }[] = [
		{ field: 'date', label: 'Date', required: true },
		{ field: 'amount', label: 'Amount', required: true },
		{ field: 'category', label: 'Category' },
		{ field: 'vehicle', label: 'Vehicle' },
		{ field: 'mileage', label: 'Odometer' },
		{ field: 'volume', label: 'Volume' },
		{ field: 'fuelType', label: 'Fuel type' },
		{ field: 'description', label: 'Description' },
		{ field: 'tags', label: 'Tags' }
	];
	const DATE_FORMATS: { value: ImportDateFormat; label: string }[] = [
		{ value: 'iso', label: 'ISO (YYYY-MM-DD)' },
		{ value: 'mdy', label: 'US (MM/DD/YYYY)' },
		{ value: 'dmy', label: 'EU (DD/MM/YYYY)' },
		{ value: 'epoch', label: 'Unix timestamp' }
	];
	const DISTANCE_UNITS: DistanceUnit[] = ['miles', 'kilometers'];
	const VOLUME_UNITS: VolumeUnit[] = ['gallons_us', 'gallons_uk', 'liters'];

	let targetVehicle = $derived(vehicles.find((v) => v.id === targetVehicleId));
	// A manual mapping needs a vehicle column OR a chosen target vehicle (the same D4 rule as a preset).
	let manualHasVehicle = $derived(!!manualMapping && (!!manualColumns.vehicle || !!targetVehicle));
	// The mapping sent to the server: a detected preset's field map, OR the user's manual column map.
	// Null until the active path is complete (preset: vehicle chosen; manual: date+amount mapped + a vehicle).
	let mapping = $derived<ImportColumnMapping | null>(buildMapping());

	function buildMapping(): ImportColumnMapping | null {
		if (detectedPreset && targetVehicle) {
			return {
				source: detectedPreset.id,
				columns: detectedPreset.columns,
				targetVehicle: getVehicleDisplayName(targetVehicle),
				dateFormat: detectedPreset.dateFormat,
				distanceUnit: detectedPreset.distanceUnit,
				volumeUnit: detectedPreset.volumeUnit,
				categoryMap: detectedPreset.categoryMap
			};
		}
		if (manualMapping && manualColumns.date && manualColumns.amount && manualHasVehicle) {
			// Drop empty selections so only mapped fields reach the server.
			const columns = Object.fromEntries(
				Object.entries(manualColumns).filter(([, v]) => v)
			) as Partial<Record<NativeImportField, string>>;
			return {
				columns,
				dateFormat: manualDateFormat,
				// Send the file's unit only when the matching column is mapped, so applyMapping converts
				// mileage/volume into the target vehicle's units (else a metric log imports raw — #NS2).
				...(columns.mileage ? { distanceUnit: manualDistanceUnit } : {}),
				...(columns.volume ? { volumeUnit: manualVolumeUnit } : {}),
				// No vehicle column → stamp the chosen target vehicle (D4).
				...(columns.vehicle ? {} : { targetVehicle: getVehicleDisplayName(targetVehicle!) })
			};
		}
		return null;
	}

	// A foreign file is detected but the user hasn't picked a vehicle yet — block preview/commit until they do.
	let needsTargetVehicle = $derived(!!detectedPreset && !targetVehicle);
	// Manual mapping is active but incomplete (missing date/amount/vehicle) — block preview until ready.
	let needsManualMapping = $derived(manualMapping && !mapping);

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
			isDetecting = false;
			detectedPreset = null;
			targetVehicleId = '';
			fileHeaders = [];
			manualMapping = false;
			manualColumns = {};
			manualDateFormat = 'iso';
			manualDistanceUnit = 'miles';
			manualVolumeUnit = 'gallons_us';
		}
	});

	/** Parse the header row (first line) and ask the server to match a known tracker preset. */
	async function detectSource() {
		detectedPreset = null;
		targetVehicleId = '';
		manualMapping = false;
		manualColumns = {};
		fileHeaders = [];
		const headers = parseCsvHeaders(csvText);
		if (headers.length === 0) return;
		fileHeaders = headers;
		isDetecting = true;
		try {
			detectedPreset = await expenseApi.detectImportSource(headers);
			// Auto-select the only vehicle so a single-car garage skips the picker.
			if (detectedPreset && vehicles.length === 1 && vehicles[0]) {
				targetVehicleId = vehicles[0].id;
			}
			// No preset AND not already a native VROOM export → offer manual column mapping. (A native
			// file — headers include date/vehicle/category/amount — imports directly, unchanged path.)
			if (!detectedPreset && !isNativeImportHeaders(headers)) {
				manualMapping = true;
				manualColumns = guessManualColumns(headers);
				if (vehicles.length === 1 && vehicles[0]) targetVehicleId = vehicles[0].id;
				seedManualUnitsFromTarget();
			}
		} catch {
			// Detection is best-effort — a failure just falls back to the native (manual) path.
			detectedPreset = null;
		} finally {
			isDetecting = false;
		}
	}

	function setManualColumn(field: NativeImportField, header: string): void {
		manualColumns = { ...manualColumns, [field]: header };
		runPreview();
	}

	/** Default the file's units to the target vehicle's units (= no conversion baseline). The user
	 * overrides when the file is in a different unit; the conversion only runs when they differ. */
	function seedManualUnitsFromTarget(): void {
		const prefs = targetVehicle?.unitPreferences;
		if (prefs?.distanceUnit) manualDistanceUnit = prefs.distanceUnit;
		if (prefs?.volumeUnit) manualVolumeUnit = prefs.volumeUnit;
	}

	async function runPreview() {
		if (!csvText.trim()) {
			preview = null;
			return;
		}
		// A detected foreign file can't preview until the target vehicle is chosen; a manual mapping
		// can't until date+amount+vehicle are mapped.
		if (needsTargetVehicle || needsManualMapping) {
			preview = null;
			return;
		}
		isPreviewing = true;
		preview = null;
		try {
			preview = await expenseApi.importExpensesCsv(csvText, true, mapping ?? undefined);
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
		await detectSource();
		await runPreview();
	}

	/** After the target vehicle is chosen, (re)run the preview now that a mapping exists. */
	function handleTargetVehicleChange(id: string) {
		targetVehicleId = id;
		// Re-baseline the manual unit pickers to the newly-chosen vehicle's units (no conversion default).
		if (manualMapping) seedManualUnitsFromTarget();
		runPreview();
	}

	async function handleCommit() {
		if (!preview || preview.readyCount === 0) return;
		isImporting = true;
		try {
			const result = await expenseApi.importExpensesCsv(csvText, false, mapping ?? undefined);
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
				Upload a VROOM CSV export, or a fuel log from Fuelly, Fuelio, or Drivvo — we'll detect the
				format automatically. You'll see a preview before anything is saved.
			</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-4">
			<!-- Shared target-vehicle picker (D4): used by BOTH the detected-preset path and the manual
			     mapping path — the same bound control, only the trigger id + empty-state copy differ. -->
			{#snippet targetVehiclePicker(triggerId: string, emptyText: string)}
				<label for={triggerId} class="text-xs font-medium text-foreground">
					Import into vehicle *
				</label>
				{#if vehicles.length === 0}
					<p class="text-sm text-muted-foreground">{emptyText}</p>
				{:else}
					<Select.Root type="single" value={targetVehicleId} onValueChange={handleTargetVehicleChange}>
						<Select.Trigger id={triggerId} class="w-full">
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
				{/if}
			{/snippet}

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
					onblur={async () => {
						await detectSource();
						await runPreview();
					}}
					rows="4"
					placeholder="date,vehicle,category,amount,..."
					class="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				></textarea>
			</div>

			<!-- Detected-source banner + target-vehicle picker (foreign tracker file, T4) -->
			{#if isDetecting}
				<div class="flex items-center gap-2 py-1 text-sm text-muted-foreground">
					<LoaderCircle class="h-4 w-4 animate-spin" />
					Detecting format…
				</div>
			{:else if detectedPreset}
				<div class="space-y-3 rounded-lg border border-chart-2/40 bg-chart-2/5 p-4">
					<div class="flex items-center gap-2 text-sm font-medium text-foreground">
						<Sparkles class="h-4 w-4 text-chart-2" />
						Detected a <span class="font-semibold">{detectedPreset.label}</span> fuel log
					</div>
					<p class="text-xs text-muted-foreground">
						Columns, units, and date format are mapped automatically. This file has no vehicle
						column, so choose which vehicle these entries belong to.
					</p>
					<div class="space-y-1.5">
						{@render targetVehiclePicker(
							'import-target-vehicle',
							'Add a vehicle first to import a fuel log.'
						)}
					</div>
				</div>
			{/if}

			<!-- Manual column mapping (unrecognized foreign file, T4) -->
			{#if manualMapping}
				<div class="space-y-3 rounded-lg border border-border bg-muted/20 p-4">
					<div class="flex items-center gap-2 text-sm font-medium text-foreground">
						<FileText class="h-4 w-4 text-muted-foreground" />
						Map your columns
					</div>
					<p class="text-xs text-muted-foreground">
						We didn't recognize this format. Match each VROOM field to a column from your file.
						<span class="text-foreground">Date</span> and <span class="text-foreground">Amount</span>
						are required.
					</p>

					<div class="space-y-2">
						{#each MAPPABLE_FIELDS as f (f.field)}
							<div class="flex items-center gap-2">
								<span class="w-28 shrink-0 text-xs text-muted-foreground">
									{f.label}{f.required ? ' *' : ''}
								</span>
								<Select.Root
									type="single"
									value={manualColumns[f.field] ?? ''}
									onValueChange={(v) => setManualColumn(f.field, v)}
								>
									<Select.Trigger class="h-8 flex-1 text-xs" data-testid="map-field-{f.field}">
										{manualColumns[f.field] || '— not mapped —'}
									</Select.Trigger>
									<Select.Content>
										<Select.Item value="" label="— not mapped —">— not mapped —</Select.Item>
										{#each fileHeaders as h (h)}
											<Select.Item value={h} label={h}>{h}</Select.Item>
										{/each}
									</Select.Content>
								</Select.Root>
							</div>
						{/each}
					</div>

					<!-- Date format -->
					<div class="flex items-center gap-2">
						<span class="w-28 shrink-0 text-xs text-muted-foreground">Date format</span>
						<Select.Root
							type="single"
							value={manualDateFormat}
							onValueChange={(v) => {
								manualDateFormat = v as ImportDateFormat;
								runPreview();
							}}
						>
							<Select.Trigger class="h-8 flex-1 text-xs">
								{DATE_FORMATS.find((d) => d.value === manualDateFormat)?.label ?? manualDateFormat}
							</Select.Trigger>
							<Select.Content>
								{#each DATE_FORMATS as d (d.value)}
									<Select.Item value={d.value} label={d.label}>{d.label}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</div>

					<!-- File's distance unit (only when an Odometer column is mapped) — drives conversion into
					     the target vehicle's unit so a metric log doesn't import raw (#NS2). -->
					{#if manualColumns.mileage}
						<div class="flex items-center gap-2">
							<span class="w-28 shrink-0 text-xs text-muted-foreground">Odometer unit</span>
							<Select.Root
								type="single"
								value={manualDistanceUnit}
								onValueChange={(v) => {
									manualDistanceUnit = v as DistanceUnit;
									runPreview();
								}}
							>
								<Select.Trigger class="h-8 flex-1 text-xs" data-testid="map-distance-unit">
									{getDistanceUnitLabel(manualDistanceUnit)}
								</Select.Trigger>
								<Select.Content>
									{#each DISTANCE_UNITS as u (u)}
										<Select.Item value={u} label={getDistanceUnitLabel(u)}>
											{getDistanceUnitLabel(u)}
										</Select.Item>
									{/each}
								</Select.Content>
							</Select.Root>
						</div>
					{/if}

					<!-- File's volume unit (only when a Volume column is mapped) -->
					{#if manualColumns.volume}
						<div class="flex items-center gap-2">
							<span class="w-28 shrink-0 text-xs text-muted-foreground">Volume unit</span>
							<Select.Root
								type="single"
								value={manualVolumeUnit}
								onValueChange={(v) => {
									manualVolumeUnit = v as VolumeUnit;
									runPreview();
								}}
							>
								<Select.Trigger class="h-8 flex-1 text-xs" data-testid="map-volume-unit">
									{getVolumeUnitLabel(manualVolumeUnit)}
								</Select.Trigger>
								<Select.Content>
									{#each VOLUME_UNITS as u (u)}
										<Select.Item value={u} label={getVolumeUnitLabel(u)}>
											{getVolumeUnitLabel(u)}
										</Select.Item>
									{/each}
								</Select.Content>
							</Select.Root>
						</div>
					{/if}

					<!-- Target vehicle (only when no vehicle column is mapped — D4) -->
					{#if !manualColumns.vehicle}
						<div class="space-y-1.5 border-t pt-3">
							{@render targetVehiclePicker('manual-target-vehicle', 'Add a vehicle first to import.')}
						</div>
					{/if}
				</div>
			{/if}

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
