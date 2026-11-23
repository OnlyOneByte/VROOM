import type {
	DistanceUnit,
	ExpenseCategory,
	ImportDateFormat,
	NativeImportField,
	Vehicle,
	VolumeUnit
} from '#lib/types/index.ts';
import type { DetectedImportFormat, ImportFormatList } from '#lib/types/import-mapping.ts';
import { expenseApi, type ExpenseImportResult } from '#lib/services/expense-api.ts';
import { appStore } from '#lib/stores/app.svelte.ts';
import { handleErrorWithNotification } from '#lib/utils/error-handling.ts';
import { DETECT_SAMPLE_LENGTH, parseCsvHeaders } from '#lib/utils/import-mapping-helpers.ts';
import { detectionOutcome } from './import-detection';
import { buildImportMapping, type ManualColumns } from './import-mapping';

export interface ImportCopy {
	previewFailed: (format: DetectedImportFormat | null) => string;
	detectFailed: string | null;
	done: (imported: number, format: DetectedImportFormat | null) => string;
	failed: (format: DetectedImportFormat | null) => string;
}

const IMPORT_COPY: ImportCopy = {
	previewFailed: () => "Couldn't read that CSV",
	detectFailed: null,
	done: imported => `Imported ${imported} expense${imported === 1 ? '' : 's'}`,
	failed: () => "Couldn't import the expenses"
};

interface ImportFormOptions {
	presetsOnly?: boolean;
	copy?: Partial<ImportCopy>;
}

export class ImportExpensesForm {
	csvText = $state('');
	fileName = $state<string | null>(null);
	preview = $state<ExpenseImportResult | null>(null);
	isPreviewing = $state(false);
	isImporting = $state(false);

	formats = $state<ImportFormatList | null>(null);
	isDetecting = $state(false);
	detectedPreset = $state<DetectedImportFormat | null>(null);
	unrecognized = $state(false);
	targetVehicleId = $state('');

	fileHeaders = $state<string[]>([]);
	manualMapping = $state(false);
	manualColumns = $state<ManualColumns>({});
	manualDateFormat = $state<ImportDateFormat>('iso');
	manualDistanceUnit = $state<DistanceUnit>('miles');
	manualVolumeUnit = $state<VolumeUnit>('gallons_us');

	categoryRemap = $state<Record<string, ExpenseCategory>>({});
	unmappedCategories = $state<string[]>([]);

	readonly #getVehicles: () => Vehicle[];
	readonly #presetsOnly: boolean;
	readonly #copy: ImportCopy;
	#detectFlow = 0;
	#previewFlow = 0;

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

	constructor(getVehicles: () => Vehicle[], options: ImportFormOptions = {}) {
		this.#getVehicles = getVehicles;
		this.#presetsOnly = options.presetsOnly ?? false;
		this.#copy = { ...IMPORT_COPY, ...options.copy };
	}

	reset() {
		this.#detectFlow++;
		this.#previewFlow++;
		this.unrecognized = false;
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
		this.unmappedCategories = [];
	}

	async loadFormats() {
		if (this.formats) return;
		try {
			this.formats = await expenseApi.getImportFormats();
		} catch {
			this.formats = null;
		}
	}

	async loadFile(file: File) {
		const flow = ++this.#detectFlow;
		this.#previewFlow++;
		this.preview = null;
		this.isPreviewing = false;
		this.unmappedCategories = [];
		this.categoryRemap = {};
		this.fileName = file.name;
		const text = await file.text();
		if (flow !== this.#detectFlow) return;
		this.csvText = text;
		await this.#detect(flow);
		if (flow === this.#detectFlow) await this.runPreview();
	}

	async handlePasteBlur() {
		const flow = ++this.#detectFlow;
		await this.#detect(flow);
		if (flow === this.#detectFlow) await this.runPreview();
	}

	detectSource() {
		return this.#detect(++this.#detectFlow);
	}

	runPreview() {
		return this.#preview(++this.#previewFlow);
	}

	async #detect(flow: number) {
		this.#previewFlow++;
		this.detectedPreset = null;
		this.unrecognized = false;
		if (!this.#presetsOnly) this.targetVehicleId = '';
		this.manualMapping = false;
		this.manualColumns = {};
		this.categoryRemap = {};
		this.unmappedCategories = [];
		this.fileHeaders = [];
		this.preview = null;
		this.isPreviewing = false;
		this.isDetecting = false;
		const sample = this.csvText.slice(0, DETECT_SAMPLE_LENGTH);
		if (!sample.trim()) return;
		const headers = parseCsvHeaders(this.csvText);
		this.fileHeaders = headers;
		this.isDetecting = true;
		try {
			const preset = await expenseApi.detectImportSource(sample);
			if (flow !== this.#detectFlow) return;
			this.detectedPreset = preset;
			this.unrecognized = !preset;
			if (!preset && (this.#presetsOnly || headers.length === 0)) return;
			const outcome = detectionOutcome(
				headers,
				preset,
				this.#getVehicles().map(v => v.id)
			);
			if (!this.#presetsOnly && outcome.targetVehicleId) {
				this.targetVehicleId = outcome.targetVehicleId;
			}
			if (outcome.manualColumns) {
				this.manualMapping = true;
				this.manualColumns = outcome.manualColumns;
				this.#seedManualUnitsFromTarget();
			}
		} catch (err) {
			if (flow !== this.#detectFlow) return;
			this.detectedPreset = null;
			if (this.#copy.detectFailed) handleErrorWithNotification(err, this.#copy.detectFailed);
		} finally {
			if (flow === this.#detectFlow) this.isDetecting = false;
		}
	}

	async #preview(flow: number) {
		this.isPreviewing = false;
		const cannotPreview =
			!this.csvText.trim() ||
			(this.#presetsOnly && !this.detectedPreset) ||
			this.needsTargetVehicle ||
			this.needsManualMapping;
		if (cannotPreview) {
			this.preview = null;
			return;
		}
		this.isPreviewing = true;
		try {
			const preview = await expenseApi.importExpensesCsv(
				this.csvText,
				true,
				this.mapping ?? undefined
			);
			if (flow === this.#previewFlow) {
				this.preview = preview;
				const known = this.unmappedCategories;
				const fresh = (preview.unmappedCategories ?? []).filter(c => !known.includes(c));
				this.unmappedCategories = [...known, ...fresh];
			}
		} catch (err) {
			if (flow === this.#previewFlow) {
				this.preview = null;
				handleErrorWithNotification(err, this.#copy.previewFailed(this.detectedPreset));
			}
		} finally {
			if (flow === this.#previewFlow) this.isPreviewing = false;
		}
	}

	changeTargetVehicle(id: string) {
		this.targetVehicleId = id;
		if (this.manualMapping) this.#seedManualUnitsFromTarget();
		this.runPreview();
	}

	setManualColumn(field: NativeImportField, header: string) {
		this.manualColumns = { ...this.manualColumns, [field]: header };
		if (field === 'category') {
			this.unmappedCategories = [];
			this.categoryRemap = {};
		}
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

	async commit(onImported: () => void): Promise<boolean> {
		if (!this.preview || this.preview.readyCount === 0) return false;
		const format = this.detectedPreset;
		this.isImporting = true;
		try {
			const result = await expenseApi.importExpensesCsv(
				this.csvText,
				false,
				this.mapping ?? undefined
			);
			appStore.showSuccess(this.#copy.done(result.imported, format));
			onImported();
			return true;
		} catch (err) {
			handleErrorWithNotification(err, this.#copy.failed(format));
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
