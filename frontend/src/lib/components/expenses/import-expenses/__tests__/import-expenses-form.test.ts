import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { Vehicle } from '#lib/types/index.ts';
import type { ExpenseImportResult } from '#lib/services/expense-api.ts';
import type { DetectedImportFormat } from '#lib/types/import-mapping.ts';
import { ImportExpensesForm } from '../import-expenses-form.svelte';

const mocks = vi.hoisted(() => ({
	detectImportSource: vi.fn(),
	importExpensesCsv: vi.fn(),
	addNotification: vi.fn()
}));

vi.mock('#lib/services/expense-api.ts', () => ({
	expenseApi: {
		detectImportSource: mocks.detectImportSource,
		importExpensesCsv: mocks.importExpensesCsv
	}
}));

vi.mock('#lib/stores/app.svelte.ts', () => ({
	appStore: {
		addNotification: mocks.addNotification,
		showSuccess: (message: string) => mocks.addNotification({ type: 'success', message })
	}
}));

const CAMRY: Vehicle = {
	id: 'v1',
	year: 2020,
	make: 'Toyota',
	model: 'Camry',
	vehicleType: 'gas',
	trackFuel: true,
	trackCharging: false,
	createdAt: '2026-01-01T00:00:00Z',
	updatedAt: '2026-01-01T00:00:00Z'
};
const RAV4: Vehicle = { ...CAMRY, id: 'v2', model: 'RAV4' };

const FUELLY: DetectedImportFormat = {
	id: 'fuelly',
	label: 'Fuelly'
};

const FUEL_CSV = 'Date,Cost\n01/02/2026,40.00\n01/09/2026,42.50';
const FOREIGN_CSV = 'Transaction Date,Spent,Kind\n2026-01-02,40,gas';
const FUELIO_EXPORT = [
	'"## Vehicle"',
	'"Name","ImportCSVDateFormat","Make","Model","Year"',
	'"Golf","yyyy-MM-dd","Volkswagen","Golf","2018"',
	'',
	'"## Log"',
	'"Data","Odo (km)","Fuel (litres)","Full","Price (optional)"',
	'"2024-01-05","45210","42.10","1","68.90"'
].join('\n');

function previewResult(overrides: Partial<ExpenseImportResult> = {}): ExpenseImportResult {
	return {
		dryRun: true,
		imported: 0,
		readyCount: 2,
		errorCount: 0,
		totalRows: 2,
		rows: [],
		...overrides
	};
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

beforeEach(() => {
	vi.clearAllMocks();
	mocks.detectImportSource.mockResolvedValue(null);
	mocks.importExpensesCsv.mockResolvedValue(previewResult());
});

describe('ImportExpensesForm: loading a file', () => {
	test('a detected fuel-log preset with one vehicle targets it and previews with the preset mapping', async () => {
		mocks.detectImportSource.mockResolvedValue(FUELLY);
		const form = new ImportExpensesForm(() => [CAMRY]);

		await form.loadFile(new File([FUEL_CSV], 'fuel.csv'));

		expect(form.fileName).toBe('fuel.csv');
		expect(mocks.detectImportSource).toHaveBeenCalledWith(FUEL_CSV);
		expect(form.targetVehicleId).toBe('v1');
		expect(mocks.importExpensesCsv).toHaveBeenCalledWith(
			FUEL_CSV,
			true,
			expect.objectContaining({ source: 'fuelly', targetVehicle: 'v1' })
		);
		expect(form.preview?.readyCount).toBe(2);
	});

	test('the status text reads out each result, and says when one is updating', async () => {
		mocks.detectImportSource.mockResolvedValue(FUELLY);
		const form = new ImportExpensesForm(() => [CAMRY]);
		expect(form.previewStatus).toBe('');

		await form.loadFile(new File([FUEL_CSV], 'fuel.csv'));
		expect(form.previewStatus).toBe('Preview: 2 ready.');

		let land: (value: ExpenseImportResult) => void = () => {};
		mocks.importExpensesCsv.mockReturnValue(new Promise(resolve => (land = resolve)));
		form.setCategoryRemap('Tolls', 'maintenance');
		await flush();
		expect(form.previewStatus).toBe('Updating the preview…');

		land(previewResult({ readyCount: 0, errorCount: 2 }));
		await flush();
		expect(form.previewStatus).toBe('Preview: 0 ready, 2 rows need attention.');
	});

	test('the server sees the raw sample even when the first line has no CSV headers', async () => {
		mocks.detectImportSource.mockResolvedValue(FUELLY);
		const form = new ImportExpensesForm(() => [CAMRY]);
		const text = `\n${FUEL_CSV}`;

		await form.loadFile(new File([text], 'fuel.txt'));

		expect(mocks.detectImportSource).toHaveBeenCalledWith(text);
		expect(form.detectedPreset).toEqual(FUELLY);
		expect(form.targetVehicleId).toBe('v1');
		expect(form.manualMapping).toBe(false);
	});

	test('an unrecognised file with no CSV headers gets no guessed columns', async () => {
		const form = new ImportExpensesForm(() => [CAMRY]);

		await form.loadFile(new File(['\n{"log": []}'], 'log.json'));

		expect(mocks.detectImportSource).toHaveBeenCalled();
		expect(form.detectedPreset).toBeNull();
		expect(form.manualMapping).toBe(false);
		expect(form.manualColumns).toEqual({});
	});

	test('a detected preset with several vehicles waits for a target before previewing', async () => {
		mocks.detectImportSource.mockResolvedValue(FUELLY);
		const form = new ImportExpensesForm(() => [CAMRY, RAV4]);

		await form.loadFile(new File([FUEL_CSV], 'fuel.csv'));

		expect(form.needsTargetVehicle).toBe(true);
		expect(mocks.importExpensesCsv).not.toHaveBeenCalled();

		form.changeTargetVehicle('v2');
		await flush();

		expect(mocks.importExpensesCsv).toHaveBeenCalledWith(
			FUEL_CSV,
			true,
			expect.objectContaining({ targetVehicle: 'v2' })
		);
	});

	test('an unrecognized file starts manual mapping and previews only once Date and Amount are mapped', async () => {
		const form = new ImportExpensesForm(() => [CAMRY]);

		await form.loadFile(new File([FOREIGN_CSV], 'bank.csv'));

		expect(form.manualMapping).toBe(true);
		expect(form.manualColumns).toMatchObject({ date: 'Transaction Date', amount: 'Spent' });
		expect(mocks.importExpensesCsv).toHaveBeenCalledWith(
			FOREIGN_CSV,
			true,
			expect.objectContaining({ columns: expect.objectContaining({ amount: 'Spent' }) })
		);
	});

	test('a file with the native VROOM headers imports without manual mapping', async () => {
		const nativeCsv = 'date,vehicle,category,amount\n2026-01-02,Camry,fuel,40';
		const form = new ImportExpensesForm(() => [CAMRY]);

		await form.loadFile(new File([nativeCsv], 'vroom.csv'));

		expect(form.manualMapping).toBe(false);
		expect(mocks.importExpensesCsv).toHaveBeenCalledWith(nativeCsv, true, undefined);
	});

	test('a Fuelio export is detected from its sample and needs no manual mapping', async () => {
		mocks.detectImportSource.mockResolvedValue({ id: 'fuelio', label: 'Fuelio' });
		const form = new ImportExpensesForm(() => [CAMRY]);

		await form.loadFile(new File([FUELIO_EXPORT], 'fuelio.csv'));

		expect(mocks.detectImportSource).toHaveBeenCalledWith(FUELIO_EXPORT);
		expect(form.detectedPreset?.label).toBe('Fuelio');
		expect(form.manualMapping).toBe(false);
		expect(form.targetVehicleId).toBe('v1');
		expect(mocks.importExpensesCsv).toHaveBeenCalledWith(
			FUELIO_EXPORT,
			true,
			expect.objectContaining({ source: 'fuelio', targetVehicle: 'v1' })
		);
	});
});

describe('ImportExpensesForm: committing an import', () => {
	test('commit imports the previewed rows, notifies, and reports success', async () => {
		mocks.detectImportSource.mockResolvedValue(FUELLY);
		const form = new ImportExpensesForm(() => [CAMRY]);
		await form.loadFile(new File([FUEL_CSV], 'fuel.csv'));
		mocks.importExpensesCsv.mockResolvedValueOnce(previewResult({ dryRun: false, imported: 2 }));
		const onImported = vi.fn();

		expect(await form.commit(onImported)).toBe(true);

		expect(mocks.importExpensesCsv).toHaveBeenLastCalledWith(
			FUEL_CSV,
			false,
			expect.objectContaining({ source: 'fuelly' })
		);
		expect(mocks.addNotification).toHaveBeenCalledWith({
			type: 'success',
			message: 'Imported 2 expenses'
		});
		expect(onImported).toHaveBeenCalledOnce();
		expect(form.isImporting).toBe(false);
	});

	test('commit is a no-op when nothing is ready to import', async () => {
		mocks.importExpensesCsv.mockResolvedValue(previewResult({ readyCount: 0, errorCount: 2 }));
		const form = new ImportExpensesForm(() => [CAMRY]);
		await form.loadFile(new File([FOREIGN_CSV], 'bank.csv'));
		form.setColumnField('Transaction Date', 'date');
		await flush();
		const onImported = vi.fn();
		const callsBeforeCommit = mocks.importExpensesCsv.mock.calls.length;

		expect(await form.commit(onImported)).toBe(false);

		expect(mocks.importExpensesCsv).toHaveBeenCalledTimes(callsBeforeCommit);
		expect(onImported).not.toHaveBeenCalled();
	});

	test('a failed commit reports failure, skips onImported, and clears the importing flag', async () => {
		mocks.detectImportSource.mockResolvedValue(FUELLY);
		const form = new ImportExpensesForm(() => [CAMRY]);
		await form.loadFile(new File([FUEL_CSV], 'fuel.csv'));
		mocks.importExpensesCsv.mockRejectedValueOnce(new Error('network down'));
		const onImported = vi.fn();

		expect(await form.commit(onImported)).toBe(false);

		expect(onImported).not.toHaveBeenCalled();
		expect(form.isImporting).toBe(false);
	});
});

describe('ImportExpensesForm: reset', () => {
	test('reset returns every field to its initial value so a reopened dialog starts clean', async () => {
		mocks.detectImportSource.mockResolvedValue(FUELLY);
		const form = new ImportExpensesForm(() => [CAMRY]);
		await form.loadFile(new File([FUEL_CSV], 'fuel.csv'));

		form.reset();

		expect(form.csvText).toBe('');
		expect(form.fileName).toBeNull();
		expect(form.preview).toBeNull();
		expect(form.detectedPreset).toBeNull();
		expect(form.targetVehicleId).toBe('');
		expect(form.fileHeaders).toEqual([]);
		expect(form.manualMapping).toBe(false);
		expect(form.manualColumns).toEqual({});
		expect(form.manualDateFormat).toBe('iso');
		expect(form.manualDistanceUnit).toBe('miles');
		expect(form.manualVolumeUnit).toBe('gallons_us');
		expect(form.categoryRemap).toEqual({});
	});
});

describe('ImportExpensesForm: pasted text and detection failures', () => {
	test('blurring pasted CSV detects the source and previews it', async () => {
		mocks.detectImportSource.mockResolvedValue(FUELLY);
		const form = new ImportExpensesForm(() => [CAMRY]);
		form.csvText = FUEL_CSV;

		await form.handlePasteBlur();

		expect(mocks.detectImportSource).toHaveBeenCalledWith(FUEL_CSV);
		expect(form.detectedPreset).toEqual(FUELLY);
		expect(form.preview?.readyCount).toBe(2);
	});

	test('detection sends only the first 8 KB of a large file', async () => {
		const big = `Date,Cost\n${'01/02/2026,40.00\n'.repeat(1000)}`;
		const form = new ImportExpensesForm(() => [CAMRY]);

		await form.loadFile(new File([big], 'big.csv'));

		expect(mocks.detectImportSource).toHaveBeenCalledWith(big.slice(0, 8192));
		expect(mocks.importExpensesCsv).toHaveBeenCalledWith(big, true, expect.anything());
	});

	test('blank pasted text clears the preview without calling the API', async () => {
		const form = new ImportExpensesForm(() => [CAMRY]);
		form.preview = previewResult();
		form.csvText = '   ';

		await form.handlePasteBlur();

		expect(form.preview).toBeNull();
		expect(form.fileHeaders).toEqual([]);
		expect(mocks.detectImportSource).not.toHaveBeenCalled();
		expect(mocks.importExpensesCsv).not.toHaveBeenCalled();
	});

	test('a failed source detection falls back to no preset and stops detecting', async () => {
		mocks.detectImportSource.mockRejectedValue(new Error('offline'));
		const form = new ImportExpensesForm(() => [CAMRY]);
		form.csvText = FUEL_CSV;

		await form.detectSource();

		expect(form.detectedPreset).toBeNull();
		expect(form.isDetecting).toBe(false);
		expect(form.manualMapping).toBe(false);
		expect(form.fileHeaders).toEqual(['Date', 'Cost']);
	});

	test('a failed preview notifies the user and clears the previewing flag', async () => {
		mocks.importExpensesCsv.mockRejectedValue(new Error('bad csv'));
		const form = new ImportExpensesForm(() => [CAMRY]);

		await form.loadFile(
			new File(['date,vehicle,category,amount\n2026-01-02,Camry,fuel,40'], 'x.csv')
		);

		expect(form.preview).toBeNull();
		expect(form.isPreviewing).toBe(false);
		expect(mocks.addNotification).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'error',
				message: expect.stringContaining("Couldn't read that CSV")
			})
		);
	});

	test('a single imported expense is announced in the singular', async () => {
		mocks.detectImportSource.mockResolvedValue(FUELLY);
		const form = new ImportExpensesForm(() => [CAMRY]);
		await form.loadFile(new File([FUEL_CSV], 'fuel.csv'));
		mocks.importExpensesCsv.mockResolvedValueOnce(previewResult({ dryRun: false, imported: 1 }));

		await form.commit(vi.fn());

		expect(mocks.addNotification).toHaveBeenCalledWith({
			type: 'success',
			message: 'Imported 1 expense'
		});
	});
});

describe('ImportExpensesForm: manual mapping settings', () => {
	const METRIC_RAV4: Vehicle = {
		...RAV4,
		unitPreferences: { distanceUnit: 'kilometers', volumeUnit: 'liters', chargeUnit: 'kwh' }
	};

	test('picking a target vehicle during manual mapping adopts its distance and volume units', async () => {
		const form = new ImportExpensesForm(() => [CAMRY, METRIC_RAV4]);
		await form.loadFile(new File([FOREIGN_CSV], 'bank.csv'));
		expect(form.manualDistanceUnit).toBe('miles');

		form.changeTargetVehicle('v2');
		await flush();

		expect(form.manualDistanceUnit).toBe('kilometers');
		expect(form.manualVolumeUnit).toBe('liters');
	});

	test('a sole metric vehicle seeds the manual units as soon as the file is detected', async () => {
		const form = new ImportExpensesForm(() => [METRIC_RAV4]);

		await form.loadFile(new File([FOREIGN_CSV], 'bank.csv'));

		expect(form.targetVehicleId).toBe('v2');
		expect(form.manualDistanceUnit).toBe('kilometers');
		expect(form.manualVolumeUnit).toBe('liters');
	});

	test('changing the date format, units or a category remap re-previews with the new mapping', async () => {
		const form = new ImportExpensesForm(() => [CAMRY]);
		await form.loadFile(new File([FOREIGN_CSV], 'bank.csv'));

		form.setManualDateFormat('dmy');
		await flush();
		expect(mocks.importExpensesCsv).toHaveBeenLastCalledWith(
			FOREIGN_CSV,
			true,
			expect.objectContaining({ dateFormat: 'dmy' })
		);

		form.setManualDistanceUnit('kilometers');
		form.setManualVolumeUnit('liters');
		form.setCategoryRemap('gas', 'fuel');
		await flush();

		expect(form.manualDistanceUnit).toBe('kilometers');
		expect(form.manualVolumeUnit).toBe('liters');
		expect(form.categoryRemap).toEqual({ gas: 'fuel' });
		expect(mocks.importExpensesCsv).toHaveBeenLastCalledWith(
			FOREIGN_CSV,
			true,
			expect.objectContaining({ categoryMap: expect.objectContaining({ gas: 'fuel' }) })
		);
	});
});

describe('ImportExpensesForm: presets-only mode and stale results', () => {
	const deferred = <T>() => {
		let resolve!: (value: T) => void;
		const promise = new Promise<T>(r => (resolve = r));
		return { promise, resolve };
	};

	test('an unrecognised file is flagged, never guessed or previewed, and keeps the chosen vehicle', async () => {
		const form = new ImportExpensesForm(() => [CAMRY, RAV4], { presetsOnly: true });
		form.targetVehicleId = 'v2';

		await form.loadFile(new File([FOREIGN_CSV], 'other.csv'));

		expect(form.unrecognized).toBe(true);
		expect(form.manualMapping).toBe(false);
		expect(mocks.importExpensesCsv).not.toHaveBeenCalled();
		expect(form.targetVehicleId).toBe('v2');
	});

	test('picking a vehicle while detection runs neither cancels it nor leaves a spinner', async () => {
		const detection = deferred<DetectedImportFormat | null>();
		mocks.detectImportSource.mockReturnValue(detection.promise);
		const form = new ImportExpensesForm(() => [CAMRY, RAV4], { presetsOnly: true });

		const loading = form.loadFile(new File([FUEL_CSV], 'fuel.csv'));
		await flush();
		form.changeTargetVehicle('v2');
		detection.resolve(FUELLY);
		await loading;

		expect(form.isDetecting).toBe(false);
		expect(form.isPreviewing).toBe(false);
		expect(form.detectedPreset).toEqual(FUELLY);
		expect(mocks.importExpensesCsv).toHaveBeenLastCalledWith(
			FUEL_CSV,
			true,
			expect.objectContaining({ source: 'fuelly', targetVehicle: 'v2' })
		);
	});

	test('a preview that cannot run clears the spinner of the one it replaces', async () => {
		mocks.detectImportSource.mockResolvedValue(FUELLY);
		const form = new ImportExpensesForm(() => [CAMRY, RAV4]);
		await form.loadFile(new File([FUEL_CSV], 'fuel.csv'));
		form.changeTargetVehicle('v1');
		mocks.importExpensesCsv.mockReturnValue(new Promise(() => {}));
		void form.runPreview();
		expect(form.isPreviewing).toBe(true);

		form.targetVehicleId = '';
		await form.runPreview();

		expect(form.isPreviewing).toBe(false);
	});

	test('a preview that resolves after a newer one is discarded', async () => {
		mocks.detectImportSource.mockResolvedValue(FUELLY);
		const form = new ImportExpensesForm(() => [CAMRY]);
		await form.loadFile(new File([FUEL_CSV], 'fuel.csv'));
		const slow = deferred<ExpenseImportResult>();
		mocks.importExpensesCsv.mockReturnValueOnce(slow.promise);
		const first = form.runPreview();
		mocks.importExpensesCsv.mockResolvedValueOnce(previewResult({ readyCount: 7 }));
		await form.runPreview();
		slow.resolve(previewResult({ readyCount: 1 }));
		await first;

		expect(form.preview?.readyCount).toBe(7);
		expect(form.isPreviewing).toBe(false);
	});

	test('the caller’s copy is used for success and failure', async () => {
		mocks.detectImportSource.mockResolvedValue(FUELLY);
		const form = new ImportExpensesForm(() => [CAMRY], {
			copy: {
				done: (n, format) => `Moved ${n} from ${format?.label}`,
				failed: format => `No luck with ${format?.label}`
			}
		});
		await form.loadFile(new File([FUEL_CSV], 'fuel.csv'));
		mocks.importExpensesCsv.mockResolvedValueOnce(previewResult({ dryRun: false, imported: 2 }));
		await form.commit(vi.fn());
		expect(mocks.addNotification).toHaveBeenCalledWith({
			type: 'success',
			message: 'Moved 2 from Fuelly'
		});

		mocks.importExpensesCsv.mockRejectedValueOnce(new Error('boom'));
		await form.commit(vi.fn());
		expect(mocks.addNotification).toHaveBeenCalledWith(
			expect.objectContaining({ message: expect.stringContaining('No luck with Fuelly') })
		);
	});
});

describe('ImportExpensesForm: a new file replaces the old preview at once', () => {
	test('the old preview and its category picks are gone before the new file has been read', async () => {
		mocks.detectImportSource.mockResolvedValue(FUELLY);
		mocks.importExpensesCsv.mockResolvedValue(previewResult({ unmappedCategories: ['Tolls'] }));
		const form = new ImportExpensesForm(() => [CAMRY]);
		await form.loadFile(new File([FUEL_CSV], 'fuel.csv'));
		form.setCategoryRemap('Tolls', 'misc');
		await flush();
		expect(form.preview).not.toBeNull();
		expect(form.unmappedCategories).toEqual(['Tolls']);

		let release!: (text: string) => void;
		const slowFile = { name: 'next.csv', text: () => new Promise<string>(r => (release = r)) };
		const loading = form.loadFile(slowFile as unknown as File);

		expect(form.fileName).toBe('next.csv');
		expect(form.preview).toBeNull();
		expect(form.unmappedCategories).toEqual([]);
		expect(form.categoryRemap).toEqual({});
		release(FUEL_CSV);
		await loading;
	});

	test('categories mapped in a later preview stay listed for the same file', async () => {
		mocks.detectImportSource.mockResolvedValue(FUELLY);
		mocks.importExpensesCsv.mockResolvedValueOnce(previewResult({ unmappedCategories: ['Tolls'] }));
		const form = new ImportExpensesForm(() => [CAMRY]);
		await form.loadFile(new File([FUEL_CSV], 'fuel.csv'));
		mocks.importExpensesCsv.mockResolvedValueOnce(previewResult({ unmappedCategories: [] }));

		form.setCategoryRemap('Tolls', 'misc');
		await flush();

		expect(form.unmappedCategories).toEqual(['Tolls']);
		await form.loadFile(new File([FUEL_CSV], 'other.csv'));
		expect(form.unmappedCategories).toEqual([]);
	});

	test('choosing another category column drops the old column’s words and picks', async () => {
		const form = new ImportExpensesForm(() => [CAMRY]);
		const csv = 'Transaction Date,Spent,Kind,Type\n2026-01-02,40,gas,ferry';
		await form.loadFile(new File([csv], 'foreign.csv'));
		form.setColumnField('Transaction Date', 'date');
		form.setColumnField('Spent', 'amount');
		mocks.importExpensesCsv.mockResolvedValueOnce(previewResult({ unmappedCategories: ['gas'] }));
		form.setColumnField('Kind', 'category');
		await flush();
		form.setCategoryRemap('gas', 'fuel');
		await flush();
		expect(form.unmappedCategories).toEqual(['gas']);

		mocks.importExpensesCsv.mockResolvedValueOnce(previewResult({ unmappedCategories: ['ferry'] }));
		form.setColumnField('Type', 'category');
		await flush();

		expect(form.unmappedCategories).toEqual(['ferry']);
		expect(form.categoryRemap).toEqual({});
	});

	test('mapping an unrelated column keeps the category picks', async () => {
		const form = new ImportExpensesForm(() => [CAMRY]);
		const csv = 'Transaction Date,Spent,Kind,Type\n2026-01-02,40,gas,ferry';
		await form.loadFile(new File([csv], 'foreign.csv'));
		form.setColumnField('Transaction Date', 'date');
		form.setColumnField('Spent', 'amount');
		mocks.importExpensesCsv.mockResolvedValueOnce(previewResult({ unmappedCategories: ['gas'] }));
		form.setColumnField('Kind', 'category');
		await flush();
		form.setCategoryRemap('gas', 'fuel');
		await flush();

		form.setColumnField('Type', 'description');
		await flush();

		expect(form.categoryRemap).toEqual({ gas: 'fuel' });
	});

	test('a failed re-preview drops the old result instead of leaving it importable', async () => {
		mocks.detectImportSource.mockResolvedValue(FUELLY);
		const form = new ImportExpensesForm(() => [CAMRY]);
		await form.loadFile(new File([FUEL_CSV], 'fuel.csv'));
		expect(form.preview).not.toBeNull();

		mocks.importExpensesCsv.mockRejectedValueOnce(new Error('boom'));
		await form.runPreview();

		expect(form.preview).toBeNull();
		expect(await form.commit(vi.fn())).toBe(false);
	});

	test('a re-preview that cannot run drops the old result', async () => {
		mocks.detectImportSource.mockResolvedValue(FUELLY);
		const form = new ImportExpensesForm(() => [CAMRY, RAV4]);
		await form.loadFile(new File([FUEL_CSV], 'fuel.csv'));
		form.changeTargetVehicle('v1');
		await flush();
		expect(form.preview).not.toBeNull();

		form.targetVehicleId = '';
		await form.runPreview();

		expect(form.preview).toBeNull();
	});

	test('commit refuses while a re-preview is in flight', async () => {
		mocks.detectImportSource.mockResolvedValue(FUELLY);
		const form = new ImportExpensesForm(() => [CAMRY]);
		await form.loadFile(new File([FUEL_CSV], 'fuel.csv'));
		mocks.importExpensesCsv.mockReturnValueOnce(new Promise(() => {}));
		void form.runPreview();
		expect(form.isPreviewing).toBe(true);
		mocks.importExpensesCsv.mockClear();

		expect(await form.commit(vi.fn())).toBe(false);
		expect(mocks.importExpensesCsv).not.toHaveBeenCalled();
	});
});
