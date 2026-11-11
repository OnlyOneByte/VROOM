import type {
	DistanceUnit,
	ExpenseCategory,
	ImportDateFormat,
	NativeImportField,
	Vehicle,
	VolumeUnit
} from '$lib/types';
import type { ImportMappingPreset } from '$lib/types/import-mapping';
import { expenseApi, type ExpenseImportResult } from '$lib/services/expense-api';
import { appStore } from '$lib/stores/app.svelte';
import { handleErrorWithNotification } from '$lib/utils/error-handling';
import { parseCsvHeaders } from '$lib/utils/import-mapping-helpers';
import { detectionOutcome } from './import-detection';
import { buildImportMapping, type ManualColumns } from './import-mapping';

/** Shared state for the import dialog and its sections. The dialog owns one instance per open. */
export class ImportExpensesForm {
	csvText = $state('');
	fileName = $state<string | null>(null);
	preview = $state<ExpenseImportResult | null>(null);
	isPreviewing = $state(false);
	isImporting = $state(false);

	isDetecting = $state(false);
	detectedPreset = $state<ImportMappingPreset | null>(null);
	targetVehicleId = $state('');

	fileHeaders = $state<string[]>([]);
	manualMapping = $state(false);
	manualColumns = $state<ManualColumns>({});
	manualDateFormat = $state<ImportDateFormat>('iso');
	manualDistanceUnit = $state<DistanceUnit>('miles');
	manualVolumeUnit = $state<VolumeUnit>('gallons_us');

	categoryRemap = $state<Record<string, ExpenseCategory>>({});

	readonly #getVehicles: () => Vehicle[];

	targetVehicle = $derived(this.#findTargetVehicle());
	mapping = $derived(
		buildImportMapping({
			preset: this.detectedPreset,
			targetVehicle: this.targetVehicle,
			manual: {
				enabled: this.manualMapping,
				columns: this.manualColumns,
				dateFormat: this.manualDateFormat,
				distanceUnit: this.manualDistanceUnit,
				volumeUnit: this.manualVolumeUnit
			},
			categoryRemap: this.categoryRemap
		})
	);
	needsTargetVehicle = $derived(!!this.detectedPreset && !this.targetVehicle);
	needsManualMapping = $derived(this.manualMapping && !this.mapping);
	errorRows = $derived(this.preview?.rows.filter(r => r.status === 'error') ?? []);
	unmappedCategories = $derived(this.preview?.unmappedCategories ?? []);

	constructor(getVehicles: () => Vehicle[]) {
		this.#getVehicles = getVehicles;
	}

	reset() {
		this.csvText = '';
		this.fileName = null;
		this.preview = null;
		this.isPreviewing = false;
		this.isImporting = false;
		this.isDetecting = false;
		this.detectedPreset = null;
		this.targetVehicleId = '';
		this.fileHeaders = [];
		this.manualMapping = false;
		this.manualColumns = {};
		this.manualDateFormat = 'iso';
		this.manualDistanceUnit = 'miles';
		this.manualVolumeUnit = 'gallons_us';
		this.categoryRemap = {};
	}

	async loadFile(file: File) {
		this.fileName = file.name;
		this.csvText = await file.text();
		await this.detectSource();
		await this.runPreview();
	}

	async handlePasteBlur() {
		await this.detectSource();
		await this.runPreview();
	}

	async detectSource() {
		this.detectedPreset = null;
		this.targetVehicleId = '';
		this.manualMapping = false;
		this.manualColumns = {};
		this.categoryRemap = {};
		this.fileHeaders = [];
		const headers = parseCsvHeaders(this.csvText);
		if (headers.length === 0) return;
		this.fileHeaders = headers;
		this.isDetecting = true;
		try {
			const preset = await expenseApi.detectImportSource(headers);
			this.detectedPreset = preset;
			const outcome = detectionOutcome(
				headers,
				preset,
				this.#getVehicles().map(v => v.id)
			);
			if (outcome.targetVehicleId) this.targetVehicleId = outcome.targetVehicleId;
			if (outcome.manualColumns) {
				this.manualMapping = true;
				this.manualColumns = outcome.manualColumns;
				this.#seedManualUnitsFromTarget();
			}
		} catch {
			// Detection is best-effort — a failure just falls back to the native (manual) path.
			this.detectedPreset = null;
		} finally {
			this.isDetecting = false;
		}
	}

	async runPreview() {
		if (!this.csvText.trim()) {
			this.preview = null;
			return;
		}
		if (this.needsTargetVehicle || this.needsManualMapping) {
			this.preview = null;
			return;
		}
		this.isPreviewing = true;
		this.preview = null;
		try {
			this.preview = await expenseApi.importExpensesCsv(
				this.csvText,
				true,
				this.mapping ?? undefined
			);
		} catch (err) {
			handleErrorWithNotification(err, 'Could not read that CSV');
		} finally {
			this.isPreviewing = false;
		}
	}

	changeTargetVehicle(id: string) {
		this.targetVehicleId = id;
		if (this.manualMapping) this.#seedManualUnitsFromTarget();
		this.runPreview();
	}

	setManualColumn(field: NativeImportField, header: string) {
		this.manualColumns = { ...this.manualColumns, [field]: header };
		this.runPreview();
	}

	setManualDateFormat(format: ImportDateFormat) {
		this.manualDateFormat = format;
		this.runPreview();
	}

	setManualDistanceUnit(unit: DistanceUnit) {
		this.manualDistanceUnit = unit;
		this.runPreview();
	}

	setManualVolumeUnit(unit: VolumeUnit) {
		this.manualVolumeUnit = unit;
		this.runPreview();
	}

	setCategoryRemap(word: string, category: ExpenseCategory) {
		this.categoryRemap = { ...this.categoryRemap, [word]: category };
		this.runPreview();
	}

	/** Resolves true only when the import succeeded, so the caller knows to close the dialog. */
	async commit(onImported: () => void): Promise<boolean> {
		if (!this.preview || this.preview.readyCount === 0) return false;
		this.isImporting = true;
		try {
			const result = await expenseApi.importExpensesCsv(
				this.csvText,
				false,
				this.mapping ?? undefined
			);
			appStore.addNotification({
				type: 'success',
				message: `Imported ${result.imported} expense${result.imported === 1 ? '' : 's'}`
			});
			onImported();
			return true;
		} catch (err) {
			handleErrorWithNotification(err, 'Failed to import expenses');
			return false;
		} finally {
			this.isImporting = false;
		}
	}

	#findTargetVehicle(): Vehicle | undefined {
		return this.#getVehicles().find(v => v.id === this.targetVehicleId);
	}

	#seedManualUnitsFromTarget() {
		const prefs = this.targetVehicle?.unitPreferences;
		if (prefs?.distanceUnit) this.manualDistanceUnit = prefs.distanceUnit;
		if (prefs?.volumeUnit) this.manualVolumeUnit = prefs.volumeUnit;
	}
}
