<script lang="ts">
	import type { ImportMappingPreset } from '$lib/types/import-mapping';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Select from '$lib/components/ui/select';
	import { Button } from '$lib/components/ui/button';
	import {
		Upload,
		LoaderCircle,
		CircleCheck,
		CircleAlert,
		FileText,
		Sparkles
	} from '@lucide/svelte';
	import { expenseApi, type ExpenseImportResult } from '$lib/services/expense-api';
	import { appStore } from '$lib/stores/app.svelte';
	import { handleErrorWithNotification } from '$lib/utils/error-handling';
	import { getVehicleDisplayName } from '$lib/utils/vehicle-helpers';
	import { getDistanceUnitLabel, getVolumeUnitLabel } from '$lib/utils/units';
	import { categoryLabels } from '$lib/utils/expense-helpers';
	import {
		guessManualColumns,
		isNativeImportHeaders,
		parseCsvHeaders
	} from '$lib/utils/import-mapping-helpers';
	import type {
		DistanceUnit,
		ExpenseCategory,
		ImportColumnMapping,
		ImportDateFormat,
		NativeImportField,
		Vehicle,
		VolumeUnit
	} from '$lib/types';

	interface Props {
		open: boolean;
		vehicles: Vehicle[];
		onImported: () => void;
	}

	let { open = $bindable(), vehicles, onImported }: Props = $props();

	let csvText = $state('');
	let fileName = $state<string | null>(null);
	let preview = $state<ExpenseImportResult | null>(null);
	let isPreviewing = $state(false);
	let isImporting = $state(false);

	// Preset files have no vehicle column, so the target vehicle must be chosen or every row fails.
	let isDetecting = $state(false);
	let detectedPreset = $state<ImportMappingPreset | null>(null);
	let targetVehicleId = $state('');

	// Native VROOM exports import as-is; manual mapping only applies to unrecognized foreign files.
	let fileHeaders = $state<string[]>([]);
	let manualMapping = $state(false);
	let manualColumns = $state<Partial<Record<NativeImportField, string>>>({});
	let manualDateFormat = $state<ImportDateFormat>('iso');
	// Defaults to the target vehicle's units; applyMapping converts only when both sides are known.
	let manualDistanceUnit = $state<DistanceUnit>('miles');
	let manualVolumeUnit = $state<VolumeUnit>('gallons_us');

	// Unrecognized category words fall back to misc until remapped; the remap is folded into categoryMap.
	let categoryRemap = $state<Record<string, ExpenseCategory>>({});

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
	const CATEGORY_OPTIONS = Object.entries(categoryLabels) as [ExpenseCategory, string][];

	let targetVehicle = $derived(vehicles.find(v => v.id === targetVehicleId));
	let manualHasVehicle = $derived(!!manualMapping && (!!manualColumns.vehicle || !!targetVehicle));
	let mapping = $derived<ImportColumnMapping | null>(buildMapping());

	function assignedCategoryMap(): Record<string, ExpenseCategory> {
		return Object.fromEntries(Object.entries(categoryRemap).filter(([, v]) => v)) as Record<
			string,
			ExpenseCategory
		>;
	}

	function buildMapping(): ImportColumnMapping | null {
		const remap = assignedCategoryMap();
		const hasRemap = Object.keys(remap).length > 0;
		if (detectedPreset && targetVehicle) {
			return {
				source: detectedPreset.id,
				columns: detectedPreset.columns,
				targetVehicle: getVehicleDisplayName(targetVehicle),
				dateFormat: detectedPreset.dateFormat,
				distanceUnit: detectedPreset.distanceUnit,
				volumeUnit: detectedPreset.volumeUnit,
				categoryMap: { ...detectedPreset.categoryMap, ...remap }
			};
		}
		if (manualMapping && manualColumns.date && manualColumns.amount && manualHasVehicle) {
			const columns = Object.fromEntries(
				Object.entries(manualColumns).filter(([, v]) => v)
			) as Partial<Record<NativeImportField, string>>;
			return {
				columns,
				dateFormat: manualDateFormat,
				...(columns.mileage ? { distanceUnit: manualDistanceUnit } : {}),
				...(columns.volume ? { volumeUnit: manualVolumeUnit } : {}),
				// Sent only once a remap exists; otherwise a manual file's category column passes through verbatim.
				...(hasRemap ? { categoryMap: remap } : {}),
				...(columns.vehicle ? {} : { targetVehicle: getVehicleDisplayName(targetVehicle!) })
			};
		}
		return null;
	}

	let needsTargetVehicle = $derived(!!detectedPreset && !targetVehicle);
	let needsManualMapping = $derived(manualMapping && !mapping);

	let errorRows = $derived(preview?.rows.filter(r => r.status === 'error') ?? []);
	let unmappedCategories = $derived(preview?.unmappedCategories ?? []);

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
			categoryRemap = {};
		}
	});

	async function detectSource() {
		detectedPreset = null;
		targetVehicleId = '';
		manualMapping = false;
		manualColumns = {};
		categoryRemap = {};
		fileHeaders = [];
		const headers = parseCsvHeaders(csvText);
		if (headers.length === 0) return;
		fileHeaders = headers;
		isDetecting = true;
		try {
			detectedPreset = await expenseApi.detectImportSource(headers);
			if (detectedPreset && vehicles.length === 1 && vehicles[0]) {
				targetVehicleId = vehicles[0].id;
			}
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

	function setCategoryRemap(word: string, category: ExpenseCategory): void {
		categoryRemap = { ...categoryRemap, [word]: category };
		runPreview();
	}

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

	function handleTargetVehicleChange(id: string) {
		targetVehicleId = id;
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
			<!-- Shared by the detected-preset and manual-mapping paths -->
			{#snippet targetVehiclePicker(triggerId: string, emptyText: string)}
				<label for={triggerId} class="text-xs font-medium text-foreground">
					Import into vehicle *
				</label>
				{#if vehicles.length === 0}
					<p class="text-sm text-muted-foreground">{emptyText}</p>
				{:else}
					<Select.Root
						type="single"
						value={targetVehicleId}
						onValueChange={handleTargetVehicleChange}
					>
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

			{#if manualMapping}
				<div class="space-y-3 rounded-lg border border-border bg-muted/20 p-4">
					<div class="flex items-center gap-2 text-sm font-medium text-foreground">
						<FileText class="h-4 w-4 text-muted-foreground" />
						Map your columns
					</div>
					<p class="text-xs text-muted-foreground">
						We didn't recognize this format. Match each VROOM field to a column from your file.
						<span class="text-foreground">Date</span> and
						<span class="text-foreground">Amount</span>
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
									onValueChange={v => setManualColumn(f.field, v)}
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

					<div class="flex items-center gap-2">
						<span class="w-28 shrink-0 text-xs text-muted-foreground">Date format</span>
						<Select.Root
							type="single"
							value={manualDateFormat}
							onValueChange={v => {
								manualDateFormat = v as ImportDateFormat;
								runPreview();
							}}
						>
							<Select.Trigger class="h-8 flex-1 text-xs">
								{DATE_FORMATS.find(d => d.value === manualDateFormat)?.label ?? manualDateFormat}
							</Select.Trigger>
							<Select.Content>
								{#each DATE_FORMATS as d (d.value)}
									<Select.Item value={d.value} label={d.label}>{d.label}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</div>

					{#if manualColumns.mileage}
						<div class="flex items-center gap-2">
							<span class="w-28 shrink-0 text-xs text-muted-foreground">Odometer unit</span>
							<Select.Root
								type="single"
								value={manualDistanceUnit}
								onValueChange={v => {
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

					{#if manualColumns.volume}
						<div class="flex items-center gap-2">
							<span class="w-28 shrink-0 text-xs text-muted-foreground">Volume unit</span>
							<Select.Root
								type="single"
								value={manualVolumeUnit}
								onValueChange={v => {
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

					{#if !manualColumns.vehicle}
						<div class="space-y-1.5 border-t pt-3">
							{@render targetVehiclePicker(
								'manual-target-vehicle',
								'Add a vehicle first to import.'
							)}
						</div>
					{/if}
				</div>
			{/if}

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

			{#if preview && unmappedCategories.length > 0}
				<div class="space-y-3 rounded-lg border border-chart-4/40 bg-chart-4/5 p-4">
					<div class="flex items-center gap-2 text-sm font-medium text-foreground">
						<CircleAlert class="h-4 w-4 text-chart-4" />
						Unrecognized categories
					</div>
					<p class="text-xs text-muted-foreground">
						These category names from your file aren't VROOM categories — they'll import as
						<span class="text-foreground">Misc</span> unless you map them.
					</p>
					<div class="space-y-2">
						{#each unmappedCategories as word (word)}
							<div class="flex items-center gap-2">
								<span class="w-28 shrink-0 truncate text-xs text-foreground" title={word}
									>{word}</span
								>
								<Select.Root
									type="single"
									value={categoryRemap[word] ?? ''}
									onValueChange={v => setCategoryRemap(word, v as ExpenseCategory)}
								>
									<Select.Trigger class="h-8 flex-1 text-xs" data-testid="remap-category-{word}">
										{categoryRemap[word] ? categoryLabels[categoryRemap[word]] : 'Map to… (Misc)'}
									</Select.Trigger>
									<Select.Content>
										{#each CATEGORY_OPTIONS as [value, label] (value)}
											<Select.Item {value} {label}>{label}</Select.Item>
										{/each}
									</Select.Content>
								</Select.Root>
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)} disabled={isImporting}>Cancel</Button
			>
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
